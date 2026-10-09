"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  CreateRoomResponse,
  JoinRoomResponse,
  ParticipantRole,
} from "../types/signaling";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface RoomSessionState {
  roomId: string | null;
  role: ParticipantRole | null;
  presenterSocketId: string | null;
  presenterToken: string | null;
  isPasscodeProtected: boolean;
  isSharing: boolean;
  expiresAt: number | null;
  peers: Array<{ peerId: string; role: ParticipantRole }>;
}

export function getSignalingUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
  if (typeof window === "undefined") {
    return envUrl || "http://localhost:3001";
  }

  // If envUrl is set to localhost, but the client is browsing from a LAN IP / hostname,
  // dynamically replace localhost with the actual host so mobile devices & other computers connect properly.
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1"
      ) {
        parsed.hostname = window.location.hostname;
        return parsed.toString().replace(/\/$/, "");
      }
    } catch {
      // fallback to envUrl
    }
    return envUrl;
  }

  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

export function useSignaling() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomSession, setRoomSession] = useState<RoomSessionState>({
    roomId: null,
    role: null,
    presenterSocketId: null,
    presenterToken: null,
    isPasscodeProtected: false,
    isSharing: false,
    expiresAt: null,
    peers: [],
  });

  const socketRef = useRef<Socket | null>(null);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    // Determine signaling server URL
    const signalingUrl = getSignalingUrl();

    const socketInstance = io(signalingUrl, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 15,
      reconnectionDelay: 1500,
      timeout: 10000,
    });

    socketRef.current = socketInstance;

    socketInstance.on("connect", () => {
      setConnectionStatus("connected");
      setSocketId(socketInstance.id || null);
      setError(null);
    });

    socketInstance.on("disconnect", (reason) => {
      setConnectionStatus("disconnected");
      setSocketId(null);
      if (reason === "io server disconnect") {
        socketInstance.connect();
      }
    });

    socketInstance.on("connect_error", (err) => {
      setConnectionStatus("error");
      const url = getSignalingUrl();
      const isPollOrConnError =
        err.message === "xhr poll error" ||
        err.message.includes("websocket error") ||
        err.message.includes("fetch failed");
      const message = isPollOrConnError
        ? `Cannot reach signaling server at ${url}. Please verify both frontend and signaling server are running ('npm run dev').`
        : `Signaling connection error (${err.message}). Retrying...`;
      setError(message);
    });

    socketInstance.on(
      "peer-joined",
      (payload: { peerId: string; role: ParticipantRole }) => {
        setRoomSession((prev) => {
          if (!prev.roomId) return prev;
          const exists = prev.peers.some((p) => p.peerId === payload.peerId);
          if (exists) return prev;
          return {
            ...prev,
            peers: [...prev.peers, { peerId: payload.peerId, role: payload.role }],
          };
        });
      }
    );

    socketInstance.on(
      "peer-left",
      (payload: { peerId: string; role: ParticipantRole }) => {
        setRoomSession((prev) => {
          if (!prev.roomId) return prev;
          return {
            ...prev,
            peers: prev.peers.filter((p) => p.peerId !== payload.peerId),
            presenterSocketId:
              prev.presenterSocketId === payload.peerId ? null : prev.presenterSocketId,
            isSharing: prev.presenterSocketId === payload.peerId ? false : prev.isSharing,
          };
        });
      }
    );

    socketInstance.on(
      "presenter-changed",
      (payload: { presenterSocketId: string | null; isSharing: boolean }) => {
        setRoomSession((prev) => ({
          ...prev,
          presenterSocketId: payload.presenterSocketId,
          isSharing: payload.isSharing,
        }));
      }
    );

    socketInstance.on(
      "screen-share-changed",
      (payload: { isSharing: boolean; presenterId: string | null }) => {
        setRoomSession((prev) => ({
          ...prev,
          isSharing: payload.isSharing,
          presenterSocketId: payload.presenterId ?? prev.presenterSocketId,
        }));
      }
    );

    socketInstance.on("room-expired", (payload: { reason?: string }) => {
      setError(payload.reason || "This room session has expired.");
      setRoomSession({
        roomId: null,
        role: null,
        presenterSocketId: null,
        presenterToken: null,
        isPasscodeProtected: false,
        isSharing: false,
        expiresAt: null,
        peers: [],
      });
    });

    return () => {
      socketInstance.removeAllListeners();
      socketInstance.disconnect();
      socketRef.current = null;
    };
  }, []);

  const createRoom = useCallback(
    async (options?: {
      maxParticipants?: number;
      customRoomId?: string;
      passcode?: string;
    }): Promise<string> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        throw new Error("Not connected to signaling server. Please wait or refresh.");
      }

      setError(null);

      return new Promise<string>((resolve, reject) => {
        socket.emit("create-room", options || {}, (res: CreateRoomResponse) => {
          if (!res.success || !res.roomId) {
            const msg = res.error || "Failed to create room.";
            setError(msg);
            reject(new Error(msg));
            return;
          }

          setRoomSession({
            roomId: res.roomId,
            role: "presenter",
            presenterSocketId: socket.id || null,
            presenterToken: res.presenterToken || null,
            isPasscodeProtected: Boolean(res.isPasscodeProtected),
            isSharing: false,
            expiresAt: res.expiresAt || null,
            peers: [],
          });

          resolve(res.roomId);
        });
      });
    },
    []
  );

  const joinRoom = useCallback(
    async (
      roomId: string,
      requestedRole?: ParticipantRole,
      passcode?: string
    ): Promise<boolean> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        throw new Error("Not connected to signaling server. Please wait or refresh.");
      }

      setError(null);

      return new Promise<boolean>((resolve, reject) => {
        socket.emit(
          "join-room",
          { roomId: roomId.trim(), role: requestedRole, passcode },
          (res: JoinRoomResponse) => {
            if (!res.success || !res.roomId) {
              const msg = res.error || "Failed to join room.";
              setError(msg);
              reject(new Error(msg));
              return;
            }

            setRoomSession({
              roomId: res.roomId,
              role: res.role || "viewer",
              presenterSocketId: res.presenterSocketId || null,
              presenterToken: null,
              isPasscodeProtected: Boolean(res.isPasscodeProtected),
              isSharing: Boolean(res.isSharing),
              expiresAt: res.expiresAt || null,
              peers: res.peers || [],
            });

            resolve(true);
          }
        );
      });
    },
    []
  );

  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    if (socket && socket.connected && roomSession.roomId) {
      socket.emit("leave-room", { roomId: roomSession.roomId });
    }

    setRoomSession({
      roomId: null,
      role: null,
      presenterSocketId: null,
      presenterToken: null,
      isPasscodeProtected: false,
      isSharing: false,
      expiresAt: null,
      peers: [],
    });
  }, [roomSession.roomId]);

  const setScreenSharingStatus = useCallback(
    async (isSharing: boolean): Promise<boolean> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        return false;
      }

      return new Promise<boolean>((resolve) => {
        socket.emit(
          "screen-share-status",
          { isSharing, presenterToken: roomSession.presenterToken },
          (res: { success: boolean; error?: string }) => {
            if (res.success) {
              setRoomSession((prev) => ({
                ...prev,
                isSharing,
                presenterSocketId: isSharing ? socket.id || null : prev.presenterSocketId,
              }));
              resolve(true);
            } else {
              if (res.error) setError(res.error);
              resolve(false);
            }
          }
        );
      });
    },
    [roomSession.presenterToken]
  );

  return {
    connectionStatus,
    socketId,
    socketRef,
    roomSession,
    error,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
    setScreenSharingStatus,
  };
}
