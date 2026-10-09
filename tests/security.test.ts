import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { createSignalingServer, isOriginAllowed } from "../server/signaling-server";
import type {
  CreateRoomResponse,
  JoinRoomResponse,
} from "../src/types/signaling";

const createClient = (port: number): ClientSocket => {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
};

test("Security & Authorization Suite", async (t) => {
  const signalingServer = createSignalingServer({
    corsOrigins: ["*"],
    rateLimitMessagesPer10s: 30, // lower threshold to easily test rate limiting
    rateLimitCreatesPerMin: 5,
  });

  const testPort = await signalingServer.start(0);

  t.after(async () => {
    await signalingServer.stop();
  });

  await t.test("HTTP Security headers are present on health probe", async () => {
    const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      http
        .get(`http://localhost:${testPort}/health`, (res) => {
          resolve(res.headers);
        })
        .on("error", reject);
    });

    assert.strictEqual(headers["x-content-type-options"], "nosniff");
    assert.strictEqual(headers["x-frame-options"], "DENY");
    assert.strictEqual(headers["referrer-policy"], "strict-origin-when-cross-origin");
  });

  await t.test("Passcode protection enforces PIN and provides presenterToken", async () => {
    const host = createClient(testPort);
    const viewer = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => viewer.on("connect", r)),
    ]);

    // Create room with passcode "8492"
    const createRes = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", { passcode: "8492" }, resolve);
    });

    assert.strictEqual(createRes.success, true);
    assert.strictEqual(createRes.isPasscodeProtected, true);
    assert.ok(createRes.presenterToken);
    assert.ok(createRes.roomId);

    // 1. Join without passcode -> fails
    const failNoPasscode = await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: createRes.roomId }, resolve);
    });
    assert.strictEqual(failNoPasscode.success, false);
    assert.strictEqual(failNoPasscode.code, "INVALID_PASSCODE");

    // 2. Join with wrong passcode -> fails
    const failWrongPasscode = await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: createRes.roomId, passcode: "0000" }, resolve);
    });
    assert.strictEqual(failWrongPasscode.success, false);
    assert.strictEqual(failWrongPasscode.code, "INVALID_PASSCODE");

    // 3. Join with correct passcode -> succeeds
    const successJoin = await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: createRes.roomId, passcode: "8492" }, resolve);
    });
    assert.strictEqual(successJoin.success, true);
    assert.strictEqual(successJoin.isPasscodeProtected, true);

    host.disconnect();
    viewer.disconnect();
  });

  await t.test("Excessive passcode attempts trigger lockout (LOCKED_OUT)", async () => {
    const host = createClient(testPort);
    const attacker = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => attacker.on("connect", r)),
    ]);

    const createRes = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", { passcode: "SECRET_PASS" }, resolve);
    });

    assert.ok(createRes.roomId);

    // Make 5 consecutive wrong attempts
    for (let i = 0; i < 4; i++) {
      await new Promise<JoinRoomResponse>((resolve) => {
        attacker.emit("join-room", { roomId: createRes.roomId, passcode: `wrong-${i}` }, resolve);
      });
    }

    // 5th wrong attempt triggers lockout
    const fifthAttempt = await new Promise<JoinRoomResponse>((resolve) => {
      attacker.emit("join-room", { roomId: createRes.roomId, passcode: "wrong-5" }, resolve);
    });

    assert.strictEqual(fifthAttempt.success, false);
    assert.strictEqual(fifthAttempt.code, "LOCKED_OUT");

    // Subsequent attempt even with CORRECT passcode is blocked
    const blockedEvenIfCorrect = await new Promise<JoinRoomResponse>((resolve) => {
      attacker.emit("join-room", { roomId: createRes.roomId, passcode: "SECRET_PASS" }, resolve);
    });
    assert.strictEqual(blockedEvenIfCorrect.success, false);
    assert.strictEqual(blockedEvenIfCorrect.code, "LOCKED_OUT");

    host.disconnect();
    attacker.disconnect();
  });

  await t.test("Rejects oversized SDP payloads (PAYLOAD_TOO_LARGE)", async () => {
    const host = createClient(testPort);
    const viewer = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => viewer.on("connect", r)),
    ]);

    const createRes = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", {}, resolve);
    });

    await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: createRes.roomId }, resolve);
    });

    // Create 70 KB mock SDP payload (above 64 KB limit)
    const oversizedSdp = "a=line:mock\r\n".repeat(6000); // ~78 KB

    const offerResult = await new Promise<{ success: boolean; code?: string }>((resolve) => {
      host.emit(
        "signal-offer",
        {
          targetSocketId: viewer.id,
          offer: { type: "offer", sdp: oversizedSdp },
        },
        resolve
      );
    });

    assert.strictEqual(offerResult.success, false);
    assert.strictEqual(offerResult.code, "PAYLOAD_TOO_LARGE");

    host.disconnect();
    viewer.disconnect();
  });

  await t.test("Rejects unauthorized presenter spoofing", async () => {
    const host = createClient(testPort);
    const viewer = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => viewer.on("connect", r)),
    ]);

    const createRes = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", {}, resolve);
    });

    await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: createRes.roomId }, resolve);
    });

    // Viewer tries to claim screen share status with invalid presenterToken
    const unauthorizedAttempt = await new Promise<{ success: boolean; code?: string }>(
      (resolve) => {
        viewer.emit(
          "screen-share-status",
          { isSharing: true, presenterToken: "fake-unauthorized-token" },
          resolve
        );
      }
    );

    assert.strictEqual(unauthorizedAttempt.success, false);
    assert.strictEqual(unauthorizedAttempt.code, "UNAUTHORIZED");

    host.disconnect();
    viewer.disconnect();
  });

  await t.test("Rate limiter throttles excessive socket messages", async () => {
    const client = createClient(testPort);
    await new Promise<void>((r) => client.on("connect", r));

    let gotRateLimitError = false;
    client.on("error", (err: { code?: string }) => {
      if (err.code === "RATE_LIMITED") {
        gotRateLimitError = true;
      }
    });

    // Emit 40 messages rapidly (configured limit is 30)
    for (let i = 0; i < 40; i++) {
      client.emit("leave-room", {});
    }

    // Brief delay to allow socket event to return
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(gotRateLimitError, true);
    client.disconnect();
  });

  await t.test("isOriginAllowed correctly authorizes local, LAN, wildcard, and production origins", () => {
    const configuredOrigins = ["https://sharehub.example.com", "*.presentation.internal"];

    // No origin (curl, server-to-server)
    assert.strictEqual(isOriginAllowed(undefined, configuredOrigins), true);

    // Loopback localhost origins
    assert.strictEqual(isOriginAllowed("http://localhost:3000", configuredOrigins), true);
    assert.strictEqual(isOriginAllowed("http://127.0.0.1:3000", configuredOrigins), true);

    // LAN IP origins (RFC 1918)
    assert.strictEqual(isOriginAllowed("http://192.168.1.50:3000", configuredOrigins), true);
    assert.strictEqual(isOriginAllowed("http://10.0.0.12:3001", configuredOrigins), true);
    assert.strictEqual(isOriginAllowed("http://172.20.10.5:3000", configuredOrigins), true);

    // Exact configured origin
    assert.strictEqual(isOriginAllowed("https://sharehub.example.com", configuredOrigins), true);

    // Wildcard subdomain
    assert.strictEqual(isOriginAllowed("https://room1.presentation.internal", configuredOrigins), true);

    // Wildcard global
    assert.strictEqual(isOriginAllowed("https://anywhere.org", ["*"]), true);

    // Production mode rejects unauthorized origins
    const envObj = process.env as Record<string, string | undefined>;
    const origEnv = envObj.NODE_ENV;
    try {
      envObj.NODE_ENV = "production";
      assert.strictEqual(isOriginAllowed("https://unauthorized-attacker.com", configuredOrigins), false);
    } finally {
      envObj.NODE_ENV = origEnv;
    }
  });
});
