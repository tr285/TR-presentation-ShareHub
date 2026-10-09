import http from "node:http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { RoomManager } from "./room-manager";
import { RateLimiter } from "./rate-limiter";
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
  host?: string;
  corsOrigins?: string[];
  autoCleanupIntervalMs?: number;
  serverInstance?: http.Server;
  rateLimitMessagesPer10s?: number;
  rateLimitCreatesPerMin?: number;
}

export interface SignalingServerInstance {
  httpServer: http.Server;
  io: SocketIOServer;
  roomManager: RoomManager;
  rateLimiter: RateLimiter;
  start: (port?: number, host?: string) => Promise<number>;
  stop: () => Promise<void>;
}

const DEFAULT_PORT = 3001;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

const MAX_SDP_LENGTH = 65536; // 64 KB
const MAX_CANDIDATE_LENGTH = 2048; // 2 KB
const MAX_ROOM_ID_LENGTH = 32;
const MAX_PASSCODE_LENGTH = 64;

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[]
): boolean {
  // Allow requests without Origin header (e.g. curl, native clients, server-to-server)
  if (!origin) return true;

  // In non-production/development mode, allow all origins for seamless local Wi-Fi & LAN testing
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  // Explicit wildcard
  if (allowedOrigins.includes("*")) {
    return true;
  }

  // Exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    // Allow loopback & local addresses
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".local")
    ) {
      return true;
    }

    // Allow RFC 1918 private LAN IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    if (
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return true;
    }

    // Pattern matching in allowedOrigins (e.g. *.domain.com)
    for (const allowed of allowedOrigins) {
      if (allowed === "*") return true;
      if (allowed.startsWith("*.")) {
        const domain = allowed.slice(2);
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return true;
        }
      }
      try {
        const allowedUrl = new URL(allowed);
        if (allowedUrl.origin === url.origin) {
          return true;
        }
      } catch {
        if (allowed === hostname) return true;
      }
    }
  } catch {
    return allowedOrigins.includes(origin);
  }

  return false;
}

export function createSignalingServer(
  config: SignalingServerConfig = {}
): SignalingServerInstance {
  const allowedOrigins =
    config.corsOrigins && config.corsOrigins.length > 0
      ? config.corsOrigins
      : process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
      : process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : DEFAULT_ALLOWED_ORIGINS;

  const roomManager = new RoomManager(config.autoCleanupIntervalMs ?? 30000);
  const rateLimiter = new RateLimiter(60000);
  const startTime = Date.now();

  const maxMessagesPer10s = config.rateLimitMessagesPer10s ?? 120;
  const maxCreatesPerMin = config.rateLimitCreatesPerMin ?? 10;

  const httpServer =
    config.serverInstance ||
    http.createServer((req, res) => {
      // Security headers
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

      if (process.env.NODE_ENV === "production") {
        res.setHeader(
          "Strict-Transport-Security",
          "max-age=31536000; includeSubDomains"
        );
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // Set CORS headers for HTTP endpoints
      const origin = req.headers.origin;
      if (isOriginAllowed(origin, allowedOrigins)) {
        if (origin) {
          res.setHeader("Access-Control-Allow-Origin", origin);
        } else if (allowedOrigins.includes("*")) {
          res.setHeader("Access-Control-Allow-Origin", "*");
        }
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Requested-With"
        );
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        const stats = roomManager.getStats();
        const mem = process.memoryUsage();
        const healthData: HealthCheckResponse = {
          status: "ok",
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
          timestamp: new Date().toISOString(),
          activeRooms: stats.activeRooms,
          activeSockets: stats.activeSockets,
          version: "1.0.0",
          memoryMb: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          },
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
        if (isOriginAllowed(origin, allowedOrigins)) {
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
    maxHttpBufferSize: 1e6, // 1 MB max socket payload
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
    // Middleware-like rate check helper
    const checkMessageRate = (): boolean => {
      const rate = rateLimiter.isAllowed(socket.id, maxMessagesPer10s, 10000);
      if (!rate.allowed) {
        socket.emit("error", {
          code: "RATE_LIMITED",
          message: "Too many messages sent. Please slow down.",
        });
        return false;
      }
      return true;
    };

    // 1. Create Room
    socket.on(
      "create-room",
      (
        payload: {
          maxParticipants?: number;
          customRoomId?: string;
          passcode?: string;
        } = {},
        callback?: (res: CreateRoomResponse) => void
      ) => {
        try {
          if (!checkMessageRate()) return;

          // Rate limit room creation specifically
          const createRate = rateLimiter.isAllowed(
            `create:${socket.handshake.address || socket.id}`,
            maxCreatesPerMin,
            60000
          );
          if (!createRate.allowed) {
            const errRes: CreateRoomResponse = {
              success: false,
              code: "RATE_LIMITED",
              error: "Too many rooms created recently. Please wait a minute.",
            };
            if (callback) callback(errRes);
            return;
          }

          // Input size validation
          if (
            payload.customRoomId &&
            (typeof payload.customRoomId !== "string" ||
              payload.customRoomId.length > MAX_ROOM_ID_LENGTH)
          ) {
            const errRes: CreateRoomResponse = {
              success: false,
              code: "INVALID_PAYLOAD",
              error: "Room ID is too long.",
            };
            if (callback) callback(errRes);
            return;
          }

          if (
            payload.passcode &&
            (typeof payload.passcode !== "string" ||
              payload.passcode.length > MAX_PASSCODE_LENGTH)
          ) {
            const errRes: CreateRoomResponse = {
              success: false,
              code: "PAYLOAD_TOO_LARGE",
              error: "Passcode cannot exceed 64 characters.",
            };
            if (callback) callback(errRes);
            return;
          }

          const result = roomManager.createRoom({
            maxParticipants: payload.maxParticipants,
            customRoomId: payload.customRoomId,
            passcode: payload.passcode,
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

          const joinResult = roomManager.joinRoom(
            result.roomId,
            socket.id,
            "presenter",
            payload.passcode
          );
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
            presenterToken: result.presenterToken,
            isPasscodeProtected: result.isPasscodeProtected,
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
        payload: { roomId: string; role?: ParticipantRole; passcode?: string },
        callback?: (res: JoinRoomResponse) => void
      ) => {
        try {
          if (!checkMessageRate()) return;

          if (
            !payload ||
            !payload.roomId ||
            typeof payload.roomId !== "string" ||
            payload.roomId.length > MAX_ROOM_ID_LENGTH
          ) {
            const errRes: JoinRoomResponse = {
              success: false,
              code: "INVALID_PAYLOAD",
              error: "A valid Room ID is required.",
            };
            if (callback) callback(errRes);
            return;
          }

          const normalizedRoomId = roomManager.normalizeRoomId(payload.roomId);
          const lockoutKey = `${socket.id}:${normalizedRoomId}`;

          // Check if socket is locked out due to excessive wrong passcode attempts
          if (rateLimiter.isLockedOut(lockoutKey)) {
            const errRes: JoinRoomResponse = {
              success: false,
              code: "LOCKED_OUT",
              error: "Too many incorrect passcode attempts. Locked out for 5 minutes.",
            };
            if (callback) callback(errRes);
            return;
          }

          const joinResult = roomManager.joinRoom(
            normalizedRoomId,
            socket.id,
            payload.role,
            payload.passcode
          );

          if (!joinResult.success || !joinResult.room || !joinResult.participant) {
            if (joinResult.code === "INVALID_PASSCODE") {
              const lockout = rateLimiter.recordFailedAttempt(lockoutKey, 5, 5 * 60 * 1000);
              const errMsg = lockout.locked
                ? "Too many incorrect passcode attempts. Locked out for 5 minutes."
                : `Incorrect passcode (${lockout.remainingAttempts} attempts remaining).`;

              const errRes: JoinRoomResponse = {
                success: false,
                code: lockout.locked ? "LOCKED_OUT" : "INVALID_PASSCODE",
                error: errMsg,
              };
              if (callback) callback(errRes);
              return;
            }

            const errRes: JoinRoomResponse = {
              success: false,
              code: joinResult.code || "JOIN_FAILED",
              error: joinResult.error || "Unable to join room.",
            };
            if (callback) callback(errRes);
            return;
          }

          // Successful join -> reset failed passcode attempts
          rateLimiter.resetAttempts(lockoutKey);

          const room = joinResult.room;
          const assignedRole = joinResult.participant.role;

          socket.join(room.roomId);

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
            isPasscodeProtected: Boolean(room.passcodeHash),
            peers: existingPeers,
            expiresAt: room.expiresAt,
          };

          if (callback) callback(response);
          socket.emit("room-joined", response);

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
          if (!checkMessageRate()) return;

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

    // 4. WebRTC Offer Relay with Payload Size & Scope Check
    socket.on(
      "signal-offer",
      (
        payload: SignalOfferPayload,
        callback?: (res: { success: boolean; error?: string; code?: string }) => void
      ) => {
        try {
          if (!checkMessageRate()) return;

          if (
            !payload ||
            !payload.targetSocketId ||
            typeof payload.targetSocketId !== "string" ||
            !payload.offer ||
            payload.offer.type !== "offer" ||
            typeof payload.offer.sdp !== "string"
          ) {
            if (callback) {
              callback({ success: false, code: "INVALID_PAYLOAD", error: "Invalid offer payload." });
            }
            return;
          }

          if (payload.offer.sdp.length > MAX_SDP_LENGTH) {
            if (callback) {
              callback({
                success: false,
                code: "PAYLOAD_TOO_LARGE",
                error: "SDP offer exceeds size limit.",
              });
            }
            return;
          }

          const senderRoom = roomManager.getRoomForSocket(socket.id);
          const targetRoom = roomManager.getRoomForSocket(payload.targetSocketId);

          if (!senderRoom || !targetRoom || senderRoom.roomId !== targetRoom.roomId) {
            if (callback) {
              callback({
                success: false,
                code: "PEER_NOT_FOUND",
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
          if (callback) callback({ success: false, code: "INTERNAL_ERROR", error: message });
        }
      }
    );

    // 5. WebRTC Answer Relay with Payload Size & Scope Check
    socket.on(
      "signal-answer",
      (
        payload: SignalAnswerPayload,
        callback?: (res: { success: boolean; error?: string; code?: string }) => void
      ) => {
        try {
          if (!checkMessageRate()) return;

          if (
            !payload ||
            !payload.targetSocketId ||
            typeof payload.targetSocketId !== "string" ||
            !payload.answer ||
            payload.answer.type !== "answer" ||
            typeof payload.answer.sdp !== "string"
          ) {
            if (callback) {
              callback({ success: false, code: "INVALID_PAYLOAD", error: "Invalid answer payload." });
            }
            return;
          }

          if (payload.answer.sdp.length > MAX_SDP_LENGTH) {
            if (callback) {
              callback({
                success: false,
                code: "PAYLOAD_TOO_LARGE",
                error: "SDP answer exceeds size limit.",
              });
            }
            return;
          }

          const senderRoom = roomManager.getRoomForSocket(socket.id);
          const targetRoom = roomManager.getRoomForSocket(payload.targetSocketId);

          if (!senderRoom || !targetRoom || senderRoom.roomId !== targetRoom.roomId) {
            if (callback) {
              callback({
                success: false,
                code: "PEER_NOT_FOUND",
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
          if (callback) callback({ success: false, code: "INTERNAL_ERROR", error: message });
        }
      }
    );

    // 6. WebRTC ICE Candidate Relay with Payload Size & Scope Check
    socket.on(
      "signal-ice-candidate",
      (
        payload: SignalIceCandidatePayload,
        callback?: (res: { success: boolean; error?: string; code?: string }) => void
      ) => {
        try {
          if (!checkMessageRate()) return;

          if (
            !payload ||
            !payload.targetSocketId ||
            typeof payload.targetSocketId !== "string" ||
            !payload.candidate ||
            typeof payload.candidate.candidate !== "string"
          ) {
            if (callback) {
              callback({
                success: false,
                code: "INVALID_PAYLOAD",
                error: "Invalid ICE candidate payload.",
              });
            }
            return;
          }

          if (payload.candidate.candidate.length > MAX_CANDIDATE_LENGTH) {
            if (callback) {
              callback({
                success: false,
                code: "PAYLOAD_TOO_LARGE",
                error: "Candidate string exceeds size limit.",
              });
            }
            return;
          }

          const senderRoom = roomManager.getRoomForSocket(socket.id);
          const targetRoom = roomManager.getRoomForSocket(payload.targetSocketId);

          if (!senderRoom || !targetRoom || senderRoom.roomId !== targetRoom.roomId) {
            if (callback) {
              callback({
                success: false,
                code: "PEER_NOT_FOUND",
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
          if (callback) callback({ success: false, code: "INTERNAL_ERROR", error: message });
        }
      }
    );

    // 7. Screen Sharing Status with Presenter Token Verification
    socket.on(
      "screen-share-status",
      (
        payload: { isSharing: boolean; presenterToken?: string },
        callback?: (res: { success: boolean; error?: string; code?: string }) => void
      ) => {
        try {
          if (!checkMessageRate()) return;

          if (!payload || typeof payload.isSharing !== "boolean") {
            if (callback) {
              callback({
                success: false,
                code: "INVALID_PAYLOAD",
                error: "isSharing boolean required.",
              });
            }
            return;
          }

          const room = roomManager.getRoomForSocket(socket.id);
          if (!room) {
            if (callback) {
              callback({
                success: false,
                code: "NOT_IN_ROOM",
                error: "Socket not in a room.",
              });
            }
            return;
          }

          const updated = roomManager.setScreenSharing(
            socket.id,
            payload.isSharing,
            payload.presenterToken
          );

          if (!updated) {
            if (callback) {
              callback({
                success: false,
                code: "UNAUTHORIZED",
                error: "Unauthorized: presenter permission denied.",
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
          if (callback) callback({ success: false, code: "INTERNAL_ERROR", error: message });
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
    rateLimiter,
    start: (
      port: number = config.port ?? DEFAULT_PORT,
      host?: string
    ): Promise<number> => {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        const listenHost = host || config.host;
        const listenCallback = () => {
          httpServer.removeListener("error", reject);
          const address = httpServer.address();
          const assignedPort =
            typeof address === "object" && address ? address.port : port;
          resolve(assignedPort);
        };

        if (listenHost) {
          httpServer.listen(port, listenHost, listenCallback);
        } else {
          httpServer.listen(port, listenCallback);
        }
      });
    },
    stop: (): Promise<void> => {
      return new Promise((resolve) => {
        clearInterval(expirationTimer);
        roomManager.destroy();
        rateLimiter.destroy();
        io.close(() => {
          httpServer.close(() => {
            resolve();
          });
        });
      });
    },
  };
}
