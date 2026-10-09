import crypto from "node:crypto";
import type {
  ParticipantInfo,
  ParticipantRole,
  RoomState,
  SerializedRoomState,
} from "../src/types/signaling";

export interface CreateRoomOptions {
  customRoomId?: string;
  maxParticipants?: number;
  ttlMs?: number;
}

export interface JoinRoomResult {
  success: boolean;
  code?: string;
  error?: string;
  room?: RoomState;
  participant?: ParticipantInfo;
}

export interface LeaveRoomResult {
  success: boolean;
  roomId?: string;
  wasPresenter?: boolean;
  participant?: ParticipantInfo;
  remainingCount?: number;
  roomDestroyed?: boolean;
}

const DEFAULT_ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_MAX_PARTICIPANTS = 12;
const MAX_ALLOWED_PARTICIPANTS = 50;
const MIN_ALLOWED_PARTICIPANTS = 2;

// Unambiguous characters for readable room codes (excluding 0/O, 1/I/L)
const CHAR_SET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export class RoomManager {
  private rooms: Map<string, RoomState> = new Map();
  private socketToRoom: Map<string, string> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(autoCleanupIntervalMs: number = 60 * 1000) {
    if (autoCleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpiredRooms();
      }, autoCleanupIntervalMs);
      // Unref interval so it doesn't prevent process shutdown
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.rooms.clear();
    this.socketToRoom.clear();
  }

  /**
   * Generates a clean, readable temporary room ID like "TR-842-917"
   */
  public generateRoomId(): string {
    const generateSegment = (length: number): string => {
      let result = "";
      const randomBytes = crypto.randomBytes(length);
      for (let i = 0; i < length; i++) {
        result += CHAR_SET[randomBytes[i] % CHAR_SET.length];
      }
      return result;
    };

    let attempts = 0;
    while (attempts < 50) {
      const candidate = `TR-${generateSegment(3)}-${generateSegment(3)}`;
      if (!this.rooms.has(candidate)) {
        return candidate;
      }
      attempts++;
    }

    // Fallback if high collision rate
    return `TR-${Date.now().toString(36).toUpperCase()}-${generateSegment(3)}`;
  }

  /**
   * Normalizes room ID format (tr-842-917 -> TR-842-917)
   */
  public normalizeRoomId(roomId: string): string {
    if (!roomId) return "";
    const clean = roomId.trim().toUpperCase();
    // If format is like TR842917 (missing dashes), normalize
    const stripped = clean.replace(/[^A-Z0-9]/g, "");
    if (stripped.startsWith("TR") && stripped.length === 8) {
      return `TR-${stripped.slice(2, 5)}-${stripped.slice(5, 8)}`;
    }
    if (stripped.length === 6) {
      return `TR-${stripped.slice(0, 3)}-${stripped.slice(3, 6)}`;
    }
    return clean;
  }

  /**
   * Validates room ID structure
   */
  public isValidRoomId(roomId: string): boolean {
    if (!roomId || typeof roomId !== "string") return false;
    const trimmed = roomId.trim();
    if (trimmed.length < 4 || trimmed.length > 32) return false;
    // Allow uppercase alphanumeric and dashes
    return /^[A-Z0-9-]+$/i.test(trimmed);
  }

  /**
   * Creates a new temporary room
   */
  public createRoom(options: CreateRoomOptions = {}): {
    success: boolean;
    roomId?: string;
    expiresAt?: number;
    error?: string;
  } {
    const roomId = options.customRoomId
      ? this.normalizeRoomId(options.customRoomId)
      : this.generateRoomId();

    if (!this.isValidRoomId(roomId)) {
      return { success: false, error: "Invalid room ID format." };
    }

    // Check if room already exists and is active
    const existing = this.rooms.get(roomId);
    if (existing) {
      if (existing.expiresAt > Date.now()) {
        return { success: false, error: "Room ID is currently in use." };
      }
      // Overwrite expired room
      this.destroyRoom(roomId);
    }

    const ttl = Math.max(
      10,
      Math.min(options.ttlMs ?? DEFAULT_ROOM_TTL_MS, 24 * 60 * 60 * 1000)
    );
    const maxParticipants = Math.max(
      MIN_ALLOWED_PARTICIPANTS,
      Math.min(
        options.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS,
        MAX_ALLOWED_PARTICIPANTS
      )
    );

    const now = Date.now();
    const roomState: RoomState = {
      roomId,
      createdAt: now,
      expiresAt: now + ttl,
      presenterSocketId: null,
      isSharing: false,
      maxParticipants,
      participants: new Map(),
    };

    this.rooms.set(roomId, roomState);

    return {
      success: true,
      roomId,
      expiresAt: roomState.expiresAt,
    };
  }

  /**
   * Adds a socket to a room with validation
   */
  public joinRoom(
    roomIdInput: string,
    socketId: string,
    requestedRole?: ParticipantRole
  ): JoinRoomResult {
    const roomId = this.normalizeRoomId(roomIdInput);
    const room = this.rooms.get(roomId);

    if (!room) {
      return {
        success: false,
        code: "ROOM_NOT_FOUND",
        error: "Room does not exist or has been closed.",
      };
    }

    if (Date.now() >= room.expiresAt) {
      this.destroyRoom(roomId);
      return {
        success: false,
        code: "ROOM_EXPIRED",
        error: "This room session has expired.",
      };
    }

    // Check if already in another room
    const currentRoomId = this.socketToRoom.get(socketId);
    if (currentRoomId && currentRoomId !== roomId) {
      this.leaveRoom(socketId);
    }

    // Check participant limit (unless re-joining)
    if (!room.participants.has(socketId) && room.participants.size >= room.maxParticipants) {
      return {
        success: false,
        code: "ROOM_FULL",
        error: `Room is full (maximum ${room.maxParticipants} participants).`,
      };
    }

    // Determine role
    let role: ParticipantRole = requestedRole ?? "viewer";
    if (requestedRole === "presenter") {
      // If a presenter already exists and is active, and it's not this socket
      if (room.presenterSocketId && room.presenterSocketId !== socketId) {
        // Demote to viewer
        role = "viewer";
      } else {
        room.presenterSocketId = socketId;
      }
    } else if (!room.presenterSocketId && room.participants.size === 0) {
      // First participant defaults to presenter if none set
      role = "presenter";
      room.presenterSocketId = socketId;
    }

    const participant: ParticipantInfo = {
      socketId,
      role,
      joinedAt: Date.now(),
    };

    room.participants.set(socketId, participant);
    this.socketToRoom.set(socketId, roomId);

    return {
      success: true,
      room,
      participant,
    };
  }

  /**
   * Handles socket leaving room or disconnecting
   */
  public leaveRoom(socketId: string): LeaveRoomResult {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      return { success: false };
    }

    this.socketToRoom.delete(socketId);
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: true, roomId };
    }

    const participant = room.participants.get(socketId);
    room.participants.delete(socketId);

    const wasPresenter = room.presenterSocketId === socketId;
    if (wasPresenter) {
      room.presenterSocketId = null;
      room.isSharing = false;
    }

    let roomDestroyed = false;
    // Destroy room immediately if no participants remain
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
      roomDestroyed = true;
    }

    return {
      success: true,
      roomId,
      wasPresenter,
      participant,
      remainingCount: room.participants.size,
      roomDestroyed,
    };
  }

  public setScreenSharing(socketId: string, isSharing: boolean): boolean {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return false;
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Only current presenter or claiming presenter can set sharing
    if (room.presenterSocketId !== socketId && isSharing) {
      // If no presenter, assign to this socket
      if (!room.presenterSocketId) {
        room.presenterSocketId = socketId;
        const p = room.participants.get(socketId);
        if (p) p.role = "presenter";
      } else {
        return false;
      }
    }

    room.isSharing = isSharing;
    if (!isSharing && room.presenterSocketId === socketId) {
      // Keep presenter assigned or wait until track stops
    }
    return true;
  }

  public getRoom(roomIdInput: string): RoomState | null {
    const roomId = this.normalizeRoomId(roomIdInput);
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (Date.now() >= room.expiresAt) {
      this.destroyRoom(roomId);
      return null;
    }
    return room;
  }

  public getRoomForSocket(socketId: string): RoomState | null {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    return this.getRoom(roomId);
  }

  public destroyRoom(roomIdInput: string): Array<string> {
    const roomId = this.normalizeRoomId(roomIdInput);
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const socketIds = Array.from(room.participants.keys());
    for (const sid of socketIds) {
      this.socketToRoom.delete(sid);
    }
    this.rooms.delete(roomId);
    return socketIds;
  }

  public cleanupExpiredRooms(): Array<{ roomId: string; sockets: string[] }> {
    const now = Date.now();
    const expiredList: Array<{ roomId: string; sockets: string[] }> = [];

    for (const [roomId, room] of this.rooms.entries()) {
      if (now >= room.expiresAt) {
        const sockets = Array.from(room.participants.keys());
        for (const sid of sockets) {
          this.socketToRoom.delete(sid);
        }
        this.rooms.delete(roomId);
        expiredList.push({ roomId, sockets });
      }
    }

    return expiredList;
  }

  public getStats(): {
    activeRooms: number;
    activeSockets: number;
    rooms: SerializedRoomState[];
  } {
    const serializedRooms: SerializedRoomState[] = [];
    for (const room of this.rooms.values()) {
      serializedRooms.push({
        roomId: room.roomId,
        createdAt: room.createdAt,
        expiresAt: room.expiresAt,
        presenterSocketId: room.presenterSocketId,
        isSharing: room.isSharing,
        maxParticipants: room.maxParticipants,
        participantCount: room.participants.size,
      });
    }

    return {
      activeRooms: this.rooms.size,
      activeSockets: this.socketToRoom.size,
      rooms: serializedRooms,
    };
  }
}
