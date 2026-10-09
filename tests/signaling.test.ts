import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { createSignalingServer } from "../server/signaling-server";
import type {
  CreateRoomResponse,
  HealthCheckResponse,
  JoinRoomResponse,
} from "../src/types/signaling";

const createClient = (port: number): ClientSocket => {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
};

test("Signaling Server Suite", async (t) => {
  const signalingServer = createSignalingServer({
    corsOrigins: ["*"],
    autoCleanupIntervalMs: 500,
  });

  const testPort = await signalingServer.start(0); // Port 0 binds to a random free OS port

  t.after(async () => {
    await signalingServer.stop();
  });

  await t.test("Health check endpoint /health returns 200 and valid metrics", async () => {
    const res = await new Promise<{ statusCode: number; data: HealthCheckResponse }>(
      (resolve, reject) => {
        http
          .get(`http://localhost:${testPort}/health`, (response) => {
            let body = "";
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => {
              try {
                resolve({
                  statusCode: response.statusCode || 0,
                  data: JSON.parse(body),
                });
              } catch (e) {
                reject(e);
              }
            });
          })
          .on("error", reject);
      }
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.status, "ok");
    assert.strictEqual(typeof res.data.uptimeSeconds, "number");
    assert.strictEqual(res.data.activeRooms, 0);
    assert.strictEqual(res.data.activeSockets, 0);
  });

  await t.test("Room creation generates valid temporary room ID and joins creator", async () => {
    const client = createClient(testPort);

    await new Promise<void>((resolve) => client.on("connect", resolve));

    const createRes = await new Promise<CreateRoomResponse>((resolve) => {
      client.emit("create-room", {}, (res: CreateRoomResponse) => {
        resolve(res);
      });
    });

    assert.strictEqual(createRes.success, true);
    assert.ok(createRes.roomId);
    assert.match(createRes.roomId, /^TR-[A-Z0-9]+-[A-Z0-9]+$/);
    assert.strictEqual(createRes.role, "presenter");

    client.disconnect();
  });

  await t.test("Joining a room adds participant and notifies existing members", async () => {
    const host = createClient(testPort);
    const peer = createClient(testPort);

    await Promise.all([
      new Promise<void>((res) => host.on("connect", res)),
      new Promise<void>((res) => peer.on("connect", res)),
    ]);

    const created = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", {}, resolve);
    });

    assert.ok(created.roomId);

    // Host listens for peer-joined
    const peerJoinedPromise = new Promise<{ peerId: string; role: string }>((resolve) => {
      host.on("peer-joined", resolve);
    });

    // Peer joins
    const joinRes = await new Promise<JoinRoomResponse>((resolve) => {
      peer.emit("join-room", { roomId: created.roomId }, resolve);
    });

    assert.strictEqual(joinRes.success, true);
    assert.strictEqual(joinRes.role, "viewer");
    assert.strictEqual(joinRes.presenterSocketId, host.id);
    assert.strictEqual(joinRes.peers?.length, 1);
    assert.strictEqual(joinRes.peers?.[0].peerId, host.id);

    const peerJoinedData = await peerJoinedPromise;
    assert.strictEqual(peerJoinedData.peerId, peer.id);
    assert.strictEqual(peerJoinedData.role, "viewer");

    host.disconnect();
    peer.disconnect();
  });

  await t.test("Enforces participant limit (ROOM_FULL)", async () => {
    const host = createClient(testPort);
    const peer1 = createClient(testPort);
    const peer2 = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => peer1.on("connect", r)),
      new Promise<void>((r) => peer2.on("connect", r)),
    ]);

    // Create room with limit of 2 participants
    const created = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", { maxParticipants: 2 }, resolve);
    });

    assert.ok(created.roomId);

    // 2nd participant joins -> should succeed
    const join1 = await new Promise<JoinRoomResponse>((resolve) => {
      peer1.emit("join-room", { roomId: created.roomId }, resolve);
    });
    assert.strictEqual(join1.success, true);

    // 3rd participant joins -> should be rejected with ROOM_FULL
    const join2 = await new Promise<JoinRoomResponse>((resolve) => {
      peer2.emit("join-room", { roomId: created.roomId }, resolve);
    });
    assert.strictEqual(join2.success, false);
    assert.strictEqual(join2.code, "ROOM_FULL");

    host.disconnect();
    peer1.disconnect();
    peer2.disconnect();
  });

  await t.test("Returns ROOM_NOT_FOUND when joining nonexistent room", async () => {
    const client = createClient(testPort);
    await new Promise<void>((r) => client.on("connect", r));

    const joinRes = await new Promise<JoinRoomResponse>((resolve) => {
      client.emit("join-room", { roomId: "TR-999-999" }, resolve);
    });

    assert.strictEqual(joinRes.success, false);
    assert.strictEqual(joinRes.code, "ROOM_NOT_FOUND");

    client.disconnect();
  });

  await t.test("Relays WebRTC offer, answer, and ICE candidate between peers", async () => {
    const presenter = createClient(testPort);
    const viewer = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => presenter.on("connect", r)),
      new Promise<void>((r) => viewer.on("connect", r)),
    ]);

    const created = await new Promise<CreateRoomResponse>((resolve) => {
      presenter.emit("create-room", {}, resolve);
    });

    await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: created.roomId }, resolve);
    });

    // 1. Offer relay: presenter -> viewer
    const offerPromise = new Promise<{
      fromPeerId: string;
      offer: { type: string; sdp: string };
    }>((resolve) => {
      viewer.on("signal-offer", resolve);
    });

    const offerAck = await new Promise<{ success: boolean }>((resolve) => {
      presenter.emit(
        "signal-offer",
        {
          targetSocketId: viewer.id,
          offer: { type: "offer", sdp: "v=0\r\no=mock 123 2 IN IP4 127.0.0.1\r\ns=-\r\n" },
        },
        resolve
      );
    });
    assert.strictEqual(offerAck.success, true);

    const receivedOffer = await offerPromise;
    assert.strictEqual(receivedOffer.fromPeerId, presenter.id);
    assert.strictEqual(receivedOffer.offer.type, "offer");

    // 2. Answer relay: viewer -> presenter
    const answerPromise = new Promise<{
      fromPeerId: string;
      answer: { type: string; sdp: string };
    }>((resolve) => {
      presenter.on("signal-answer", resolve);
    });

    const answerAck = await new Promise<{ success: boolean }>((resolve) => {
      viewer.emit(
        "signal-answer",
        {
          targetSocketId: presenter.id,
          answer: { type: "answer", sdp: "v=0\r\no=mock 456 2 IN IP4 127.0.0.1\r\ns=-\r\n" },
        },
        resolve
      );
    });
    assert.strictEqual(answerAck.success, true);

    const receivedAnswer = await answerPromise;
    assert.strictEqual(receivedAnswer.fromPeerId, viewer.id);
    assert.strictEqual(receivedAnswer.answer.type, "answer");

    // 3. ICE candidate relay: presenter -> viewer
    const icePromise = new Promise<{
      fromPeerId: string;
      candidate: { candidate: string };
    }>((resolve) => {
      viewer.on("signal-ice-candidate", resolve);
    });

    const iceAck = await new Promise<{ success: boolean }>((resolve) => {
      presenter.emit(
        "signal-ice-candidate",
        {
          targetSocketId: viewer.id,
          candidate: { candidate: "candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host" },
        },
        resolve
      );
    });
    assert.strictEqual(iceAck.success, true);

    const receivedIce = await icePromise;
    assert.strictEqual(receivedIce.fromPeerId, presenter.id);
    assert.ok(receivedIce.candidate.candidate.includes("192.168.1.100"));

    presenter.disconnect();
    viewer.disconnect();
  });

  await t.test("Disconnect cleanup notifies peers and updates presenter status", async () => {
    const host = createClient(testPort);
    const viewer = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => viewer.on("connect", r)),
    ]);

    const created = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", {}, resolve);
    });

    await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: created.roomId }, resolve);
    });

    const peerLeftPromise = new Promise<{ peerId: string; role: string }>((resolve) => {
      viewer.on("peer-left", resolve);
    });

    const presenterChangedPromise = new Promise<{ presenterSocketId: string | null }>(
      (resolve) => {
        viewer.on("presenter-changed", resolve);
      }
    );

    const hostId = host.id;
    // Host disconnects
    host.disconnect();

    const peerLeft = await peerLeftPromise;
    assert.strictEqual(peerLeft.peerId, hostId);

    const presenterChanged = await presenterChangedPromise;
    assert.strictEqual(presenterChanged.presenterSocketId, null);

    viewer.disconnect();
  });

  await t.test("Room expiration rejects join with ROOM_EXPIRED", async () => {
    const client = createClient(testPort);
    await new Promise<void>((r) => client.on("connect", r));

    // Create room with minimal TTL (1000ms)
    signalingServer.roomManager.createRoom({
      customRoomId: "TR-EXP-001",
      ttlMs: 50, // 50ms TTL for quick test
    });

    // Wait 100ms for expiration
    await new Promise((r) => setTimeout(r, 100));

    const joinRes = await new Promise<JoinRoomResponse>((resolve) => {
      client.emit("join-room", { roomId: "TR-EXP-001" }, resolve);
    });

    assert.strictEqual(joinRes.success, false);
    assert.strictEqual(joinRes.code, "ROOM_EXPIRED");

    client.disconnect();
  });
});
