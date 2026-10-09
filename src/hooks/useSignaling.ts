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
  isSharing: boolean;
  expiresAt: number | null;
  peers: Array<{ peerId: string; role: ParticipantRole }>;
}

export function useSignaling() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomSession, setRoomSession] = useState<RoomSessionState>({
    roomId: null,
    role: null,
    presenterSocketId: null,
    isSharing: false,
    expiresAt: null,
    peers: [],
  });

  const socketRef = useRef<Socket | null>(null);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    // Determine signaling server URL
    const signalingUrl =
      process.env.NEXT_PUBLIC_SIGNALING_URL ||
      (typeof window !== "undefined"
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : "http://localhost:3001");

    const socketInstance = io(signalingUrl, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 10000,
    });

    socketRef.current = socketInstance;

    socketInstance.on("connect", () => {
      setConnectionStatus("connected");
      setSocketId(socketInstance.id || null);
      setError(null);
    });

    socketInstance.on("disconnect", () => {
      setConnectionStatus("disconnected");
      setSocketId(null);
    });

    socketInstance.on("connect_error", (err) => {
      setConnectionStatus("error");
      setError(`Signaling connection error: ${err.message}`);
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
    async (options?: { maxParticipants?: number; customRoomId?: string }): Promise<string> => {
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
    async (roomId: string, requestedRole?: ParticipantRole): Promise<boolean> => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        throw new Error("Not connected to signaling server. Please wait or refresh.");
      }

      setError(null);

      return new Promise<boolean>((resolve, reject) => {
        socket.emit(
          "join-room",
          { roomId: roomId.trim(), role: requestedRole },
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
          { isSharing },
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
    []
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
