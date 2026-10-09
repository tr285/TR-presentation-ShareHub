import http from "node:http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { RoomManager } from "./room-manager";
import type {
  CreateRoomResponse,
  HealthCheckResponse,
  JoinRoomResponse,
  ParticipantRole,
  SignalAnswerPayload,
  SignalIceCandidatePayload,
  SignalOfferPayload,
} from "../src/types/signaling";

export interface SignalingServerConfig {
  port?: number;
  corsOrigins?: string[];
  autoCleanupIntervalMs?: number;
  serverInstance?: http.Server;
}

export interface SignalingServerInstance {
  httpServer: http.Server;
  io: SocketIOServer;
  roomManager: RoomManager;
  start: (port?: number) => Promise<number>;
  stop: () => Promise<void>;
}

const DEFAULT_PORT = 3001;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

export function createSignalingServer(
  config: SignalingServerConfig = {}
): SignalingServerInstance {
  const allowedOrigins =
    config.corsOrigins && config.corsOrigins.length > 0
      ? config.corsOrigins
      : process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
      : DEFAULT_ALLOWED_ORIGINS;

  const roomManager = new RoomManager(config.autoCleanupIntervalMs ?? 30000);
  const startTime = Date.now();

  const httpServer =
    config.serverInstance ||
    http.createServer((req, res) => {
      // Basic HTTP request handler for health and metrics
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // Set CORS headers for HTTP endpoints
      const origin = req.headers.origin;
      if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        const stats = roomManager.getStats();
        const healthData: HealthCheckResponse = {
          status: "ok",
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          timestamp: new Date().toISOString(),
          activeRooms: stats.activeRooms,
          activeSockets: stats.activeSockets,
          version: "1.0.0",
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(healthData));
        return;
      }

      if (url.pathname === "/stats" || url.pathname === "/api/stats") {
        const stats = roomManager.getStats();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stats));
        return;
      }

      // Root endpoint summary
      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("TR Presentation ShareHub Signaling Server running.\n");
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Check wildcard subdomains or exact matches
        const matches = allowedOrigins.some((allowed) => {
          if (allowed.startsWith("*.")) {
            const domain = allowed.slice(2);
            return origin.endsWith(domain);
          }
          return allowed === origin;
        });

        if (matches) {
          return callback(null, true);
        }
        return callback(new Error(`CORS origin not allowed: ${origin}`));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // Background room expiration notification loop
  const expirationTimer = setInterval(() => {
    const expired = roomManager.cleanupExpiredRooms();
    for (const item of expired) {
      for (const socketId of item.sockets) {
        io.to(socketId).emit("room-expired", {
          reason: "Room lifetime has expired.",
          roomId: item.roomId,
        });
      }
    }
  }, 10000);

  if (expirationTimer.unref) {
    expirationTimer.unref();
  }

  io.on("connection", (socket: Socket) => {
    // 1. Create Room
    socket.on(
      "create-room",
      (
        payload: { maxParticipants?: number; customRoomId?: string } = {},
        callback?: (res: CreateRoomResponse) => void
      ) => {
        try {
          const result = roomManager.createRoom({
            maxParticipants: payload.maxParticipants,
            customRoomId: payload.customRoomId,
          });

          if (!result.success || !result.roomId) {
            const errRes: CreateRoomResponse = {
              success: false,
              code: "CREATE_ROOM_FAILED",
              error: result.error || "Unable to create room.",
            };
            if (callback) callback(errRes);
            return;
          }

          const joinResult = roomManager.joinRoom(result.roomId, socket.id, "presenter");
          if (!joinResult.success) {
            const errRes: CreateRoomResponse = {
              success: false,
              code: joinResult.code || "JOIN_FAILED",
              error: joinResult.error || "Failed to join created room.",
            };
            if (callback) callback(errRes);
            return;
          }

          socket.join(result.roomId);

          const successRes: CreateRoomResponse = {
            success: true,
            roomId: result.roomId,
            role: "presenter",
            expiresAt: result.expiresAt,
          };

          if (callback) callback(successRes);
          socket.emit("room-created", successRes);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Internal error";
          if (callback) {
            callback({ success: false, code: "INTERNAL_ERROR", error: message });
          }
        }
      }
    );

    // 2. Join Room
    socket.on(
      "join-room",
      (
        payload: { roomId: string; role?: ParticipantRole },
        callback?: (res: JoinRoomResponse) => void
      ) => {
        try {
          if (!payload || !payload.roomId || typeof payload.roomId !== "string") {
            const errRes: JoinRoomResponse = {
              success: false,
              code: "INVALID_PAYLOAD",
              error: "A valid Room ID is required.",
            };
            if (callback) callback(errRes);
            return;
          }

          const normalizedRoomId = roomManager.normalizeRoomId(payload.roomId);
          const joinResult = roomManager.joinRoom(
            normalizedRoomId,
            socket.id,
            payload.role
          );

          if (!joinResult.success || !joinResult.room || !joinResult.participant) {
            const errRes: JoinRoomResponse = {
              success: false,
              code: joinResult.code || "JOIN_FAILED",
              error: joinResult.error || "Unable to join room.",
            };
            if (callback) callback(errRes);
            return;
          }

          const room = joinResult.room;
          const assignedRole = joinResult.participant.role;

          socket.join(room.roomId);

          // Build list of existing peers in room (excluding joining socket)
          const existingPeers: Array<{ peerId: string; role: ParticipantRole }> = [];
          for (const [sid, participant] of room.participants.entries()) {
            if (sid !== socket.id) {
              existingPeers.push({ peerId: sid, role: participant.role });
            }
          }

          const response: JoinRoomResponse = {
            success: true,
            roomId: room.roomId,
            role: assignedRole,
            presenterSocketId: room.presenterSocketId,
            isSharing: room.isSharing,
            peers: existingPeers,
            expiresAt: room.expiresAt,
          };

          if (callback) callback(response);
          socket.emit("room-joined", response);

          // Notify existing peers that a new participant joined
          socket.to(room.roomId).emit("peer-joined", {
            peerId: socket.id,
            role: assignedRole,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Internal error";
          if (callback) {
            callback({ success: false, code: "INTERNAL_ERROR", error: message });
          }
        }
      }
    );

    // 3. Leave Room
    socket.on(
      "leave-room",
      (payload?: { roomId?: string }, callback?: (res: { success: boolean }) => void) => {
        try {
          const leaveResult = roomManager.leaveRoom(socket.id);
          if (leaveResult.roomId) {
            socket.leave(leaveResult.roomId);
            socket.to(leaveResult.roomId).emit("peer-left", {
              peerId: socket.id,
              role: leaveResult.participant?.role || "viewer",
            });

            if (leaveResult.wasPresenter) {
              socket.to(leaveResult.roomId).emit("presenter-changed", {
                presenterSocketId: null,
                isSharing: false,
              });
            }
          }
          if (callback) callback({ success: true });
        } catch {
          if (callback) callback({ success: false });
        }
      }
    );

    // 4. WebRTC Offer Relay
    socket.on(
      "signal-offer",
      (
        payload: SignalOfferPayload,
        callback?: (res: { success: boolean; error?: string }) => void
      ) => {
        try {
          if (
            !payload ||
            !payload.targetSocketId ||
            typeof payload.targetSocketId !== "string" ||
            !payload.offer ||
            payload.offer.type !== "offer" ||
            typeof payload.offer.sdp !== "string"
          ) {
            if (callback) {
              callback({ success: false, error: "Invalid offer payload." });
            }
            return;
          }

          const senderRoom = roomManager.getRoomForSocket(socket.id);
          const targetRoom = roomManager.getRoomForSocket(payload.targetSocketId);

          if (!senderRoom || !targetRoom || senderRoom.roomId !== targetRoom.roomId) {
            if (callback) {
              callback({
                success: false,
                error: "Target peer is not in the same room.",
              });
            }
            return;
          }

          io.to(payload.targetSocketId).emit("signal-offer", {
            fromPeerId: socket.id,
            offer: payload.offer,
          });

          if (callback) callback({ success: true });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Relay error";
          if (callback) callback({ success: false, error: message });
        }
      }
    );

    // 5. WebRTC Answer Relay
    socket.on(
      "signal-answer",
      (
        payload: SignalAnswerPayload,
        callback?: (res: { success: boolean; error?: string }) => void
      ) => {
        try {
          if (
            !payload ||
            !payload.targetSocketId ||
            typeof payload.targetSocketId !== "string" ||
            !payload.answer ||
            payload.answer.type !== "answer" ||
            typeof payload.answer.sdp !== "string"
          ) {
            if (callback) {
              callback({ success: false, error: "Invalid answer payload." });
            }
            return;
          }

          const senderRoom = roomManager.getRoomForSocket(socket.id);
          const targetRoom = roomManager.getRoomForSocket(payload.targetSocketId);

          if (!senderRoom || !targetRoom || senderRoom.roomId !== targetRoom.roomId) {
            if (callback) {
              callback({
                success: false,
                error: "Target peer is not in the same room.",
              });
            }
            return;
          }

          io.to(payload.targetSocketId).emit("signal-answer", {
            fromPeerId: socket.id,
            answer: payload.answer,
          });

          if (callback) callback({ success: true });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Relay error";
          if (callback) callback({ success: false, error: message });
        }
      }
    );

    // 6. WebRTC ICE Candidate Relay
    socket.on(
      "signal-ice-candidate",
      (
        payload: SignalIceCandidatePayload,
        callback?: (res: { success: boolean; error?: string }) => void
      ) => {
        try {
          if (
            !payload ||
            !payload.targetSocketId ||
            typeof payload.targetSocketId !== "string" ||
            !payload.candidate ||
            typeof payload.candidate.candidate !== "string"
          ) {
            if (callback) {
              callback({ success: false, error: "Invalid ICE candidate payload." });
            }
            return;
          }

          const senderRoom = roomManager.getRoomForSocket(socket.id);
          const targetRoom = roomManager.getRoomForSocket(payload.targetSocketId);

          if (!senderRoom || !targetRoom || senderRoom.roomId !== targetRoom.roomId) {
            if (callback) {
              callback({
                success: false,
                error: "Target peer is not in the same room.",
              });
            }
            return;
          }

          io.to(payload.targetSocketId).emit("signal-ice-candidate", {
            fromPeerId: socket.id,
            candidate: payload.candidate,
          });

          if (callback) callback({ success: true });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Relay error";
          if (callback) callback({ success: false, error: message });
        }
      }
    );

    // 7. Screen Sharing Status Notification
    socket.on(
      "screen-share-status",
      (
        payload: { isSharing: boolean },
        callback?: (res: { success: boolean; error?: string }) => void
      ) => {
        try {
          if (!payload || typeof payload.isSharing !== "boolean") {
            if (callback) {
              callback({ success: false, error: "isSharing boolean required." });
            }
            return;
          }

          const room = roomManager.getRoomForSocket(socket.id);
          if (!room) {
            if (callback) {
              callback({ success: false, error: "Socket not in a room." });
            }
            return;
          }

          const updated = roomManager.setScreenSharing(socket.id, payload.isSharing);
          if (!updated) {
            if (callback) {
              callback({
                success: false,
                error: "Cannot change screen share status.",
              });
            }
            return;
          }

          io.to(room.roomId).emit("screen-share-changed", {
            isSharing: payload.isSharing,
            presenterId: payload.isSharing ? socket.id : null,
          });

          if (callback) callback({ success: true });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Status error";
          if (callback) callback({ success: false, error: message });
        }
      }
    );

    // 8. Disconnect Cleanup
    socket.on("disconnect", () => {
      try {
        const leaveResult = roomManager.leaveRoom(socket.id);
        if (leaveResult.roomId) {
          socket.to(leaveResult.roomId).emit("peer-left", {
            peerId: socket.id,
            role: leaveResult.participant?.role || "viewer",
          });

          if (leaveResult.wasPresenter) {
            socket.to(leaveResult.roomId).emit("presenter-changed", {
              presenterSocketId: null,
              isSharing: false,
            });
          }
        }
      } catch {
        // Disconnect cleanup error ignored
      }
    });
  });

  return {
    httpServer,
    io,
    roomManager,
    start: (port: number = config.port ?? DEFAULT_PORT): Promise<number> => {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => {
          httpServer.removeListener("error", reject);
          const address = httpServer.address();
          const assignedPort =
            typeof address === "object" && address ? address.port : port;
          resolve(assignedPort);
        });
      });
    },
    stop: (): Promise<void> => {
      return new Promise((resolve) => {
        clearInterval(expirationTimer);
        roomManager.destroy();
        io.close(() => {
          httpServer.close(() => {
            resolve();
          });
        });
      });
    },
  };
}
