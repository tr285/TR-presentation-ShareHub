import test from "node:test";
import assert from "node:assert";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { createSignalingServer } from "../server/signaling-server";
import type {
  CreateRoomResponse,
  JoinRoomResponse,
  ParticipantRole,
} from "../src/types/signaling";

const createClient = (port: number): ClientSocket => {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
};

test("Phase 7 Comprehensive E2E Testing Suite", async (t) => {
  const signalingServer = createSignalingServer({
    corsOrigins: ["*"],
    autoCleanupIntervalMs: 50,
  });

  const testPort = await signalingServer.start(0);

  t.after(async () => {
    await signalingServer.stop();
  });

  // ---------------------------------------------------------------------------
  // 1. Sender / Receiver Flows
  // ---------------------------------------------------------------------------
  await t.test(
    "Sender/Receiver Flow: Room creation, peer roster sync, and screen-sharing toggle",
    async () => {
      const presenter = createClient(testPort);
      const viewer1 = createClient(testPort);
      const viewer2 = createClient(testPort);

      await Promise.all([
        new Promise<void>((r) => presenter.on("connect", r)),
        new Promise<void>((r) => viewer1.on("connect", r)),
        new Promise<void>((r) => viewer2.on("connect", r)),
      ]);

      // 1. Presenter creates room
      const createRes = await new Promise<CreateRoomResponse>((resolve) => {
        presenter.emit("create-room", {}, resolve);
      });
      assert.strictEqual(createRes.success, true);
      assert.ok(createRes.roomId);
      assert.strictEqual(createRes.role, "presenter");
      const roomId = createRes.roomId;
      const presenterToken = createRes.presenterToken;
      assert.ok(presenterToken);

      // 2. Viewer1 joins
      const v1Join = await new Promise<JoinRoomResponse>((resolve) => {
        viewer1.emit("join-room", { roomId, role: "viewer" }, resolve);
      });
      assert.strictEqual(v1Join.success, true);
      assert.strictEqual(v1Join.role, "viewer");
      assert.strictEqual(v1Join.presenterSocketId, presenter.id);
      assert.strictEqual(v1Join.peers?.length, 1);
      assert.strictEqual(v1Join.peers?.[0].peerId, presenter.id);

      // 3. Viewer2 joins and receives updated peer list
      const v2Join = await new Promise<JoinRoomResponse>((resolve) => {
        viewer2.emit("join-room", { roomId, role: "viewer" }, resolve);
      });
      assert.strictEqual(v2Join.success, true);
      assert.strictEqual(v2Join.peers?.length, 2);

      // 4. Presenter starts screen share
      const v1ScreenSharePromise = new Promise<{ isSharing: boolean }>((resolve) => {
        viewer1.on("screen-share-changed", resolve);
      });
      const v2ScreenSharePromise = new Promise<{ isSharing: boolean }>((resolve) => {
        viewer2.on("screen-share-changed", resolve);
      });

      const startShareAck = await new Promise<{ success: boolean }>((resolve) => {
        presenter.emit(
          "screen-share-status",
          { isSharing: true, presenterToken },
          resolve
        );
      });
      assert.strictEqual(startShareAck.success, true);

      const [v1ShareEvent, v2ShareEvent] = await Promise.all([
        v1ScreenSharePromise,
        v2ScreenSharePromise,
      ]);
      assert.strictEqual(v1ShareEvent.isSharing, true);
      assert.strictEqual(v2ShareEvent.isSharing, true);

      // 5. Presenter stops screen share
      const v1StopSharePromise = new Promise<{ isSharing: boolean }>((resolve) => {
        viewer1.on("screen-share-changed", resolve);
      });

      await new Promise<{ success: boolean }>((resolve) => {
        presenter.emit(
          "screen-share-status",
          { isSharing: false, presenterToken },
          resolve
        );
      });

      const v1StopEvent = await v1StopSharePromise;
      assert.strictEqual(v1StopEvent.isSharing, false);

      presenter.disconnect();
      viewer1.disconnect();
      viewer2.disconnect();
    }
  );

  // ---------------------------------------------------------------------------
  // 2. Invalid Room IDs & Payload Validation
  // ---------------------------------------------------------------------------
  await t.test("Invalid IDs: Rejects nonexistent, malformed, and oversized room IDs", async () => {
    const client = createClient(testPort);
    await new Promise<void>((r) => client.on("connect", r));

    // 1. Nonexistent room ID
    const nonexistentRes = await new Promise<JoinRoomResponse>((resolve) => {
      client.emit("join-room", { roomId: "TR-NON-EXIST" }, resolve);
    });
    assert.strictEqual(nonexistentRes.success, false);
    assert.strictEqual(nonexistentRes.code, "ROOM_NOT_FOUND");

    // 2. Empty room ID
    const emptyRes = await new Promise<JoinRoomResponse>((resolve) => {
      client.emit("join-room", { roomId: "" }, resolve);
    });
    assert.strictEqual(emptyRes.success, false);
    assert.strictEqual(emptyRes.code, "INVALID_PAYLOAD");

    // 3. Oversized room ID (> 32 characters)
    const longId = "TR-" + "A".repeat(40);
    const oversizedRes = await new Promise<JoinRoomResponse>((resolve) => {
      client.emit("join-room", { roomId: longId }, resolve);
    });
    assert.strictEqual(oversizedRes.success, false);
    assert.strictEqual(oversizedRes.code, "INVALID_PAYLOAD");

    client.disconnect();
  });

  // ---------------------------------------------------------------------------
  // 3. Full / Expired Rooms
  // ---------------------------------------------------------------------------
  await t.test("Full & Expired Rooms: Enforces bounds and lifecycle expiration", async () => {
    const host = createClient(testPort);
    const viewer1 = createClient(testPort);
    const viewer2 = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => viewer1.on("connect", r)),
      new Promise<void>((r) => viewer2.on("connect", r)),
    ]);

    // Create room with capacity limit of 2 (host + 1 viewer)
    const createRes = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", { maxParticipants: 2 }, resolve);
    });
    assert.ok(createRes.roomId);
    const roomId = createRes.roomId;

    // First viewer joins -> succeeds
    const join1 = await new Promise<JoinRoomResponse>((resolve) => {
      viewer1.emit("join-room", { roomId }, resolve);
    });
    assert.strictEqual(join1.success, true);

    // Second viewer joins -> rejected with ROOM_FULL
    const join2 = await new Promise<JoinRoomResponse>((resolve) => {
      viewer2.emit("join-room", { roomId }, resolve);
    });
    assert.strictEqual(join2.success, false);
    assert.strictEqual(join2.code, "ROOM_FULL");

    // Test expiration
    signalingServer.roomManager.createRoom({
      customRoomId: "TR-FAST-EXP",
      ttlMs: 25, // 25ms TTL
    });

    await new Promise((r) => setTimeout(r, 60));

    const joinExpired = await new Promise<JoinRoomResponse>((resolve) => {
      viewer2.emit("join-room", { roomId: "TR-FAST-EXP" }, resolve);
    });
    assert.strictEqual(joinExpired.success, false);
    assert.ok(
      joinExpired.code === "ROOM_EXPIRED" || joinExpired.code === "ROOM_NOT_FOUND"
    );

    host.disconnect();
    viewer1.disconnect();
    viewer2.disconnect();
  });

  // ---------------------------------------------------------------------------
  // 4. Denied Screen Capture Permission Handling
  // ---------------------------------------------------------------------------
  await t.test("Permission Denial: Verifies browser capture error contracts", () => {
    // Contract test for NotAllowedError (user cancelled native screen picker)
    const simulatePermissionDenial = (err: unknown): string => {
      if (err instanceof Error && err.name === "NotAllowedError") {
        return "Screen capture permission was denied or cancelled.";
      }
      return "Failed to capture screen.";
    };

    const notAllowed = new Error("Permission dismissed by user");
    notAllowed.name = "NotAllowedError";

    const handledMsg = simulatePermissionDenial(notAllowed);
    assert.strictEqual(handledMsg, "Screen capture permission was denied or cancelled.");

    // Contract test for unsupported platform (e.g. mobile browser without getDisplayMedia)
    const checkDisplayMediaSupport = (mediaDevices: { getDisplayMedia?: unknown } | undefined): boolean => {
      return Boolean(mediaDevices && typeof mediaDevices.getDisplayMedia === "function");
    };

    assert.strictEqual(checkDisplayMediaSupport(undefined), false);
    assert.strictEqual(checkDisplayMediaSupport({}), false);
    assert.strictEqual(checkDisplayMediaSupport({ getDisplayMedia: () => {} }), true);
  });

  // ---------------------------------------------------------------------------
  // 5. Disconnections, Graceful Leave, and Cleanup
  // ---------------------------------------------------------------------------
  await t.test("Disconnections & Cleanup: Graceful leave and socket disconnect cleanup", async () => {
    const host = createClient(testPort);
    const viewer = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => host.on("connect", r)),
      new Promise<void>((r) => viewer.on("connect", r)),
    ]);

    const created = await new Promise<CreateRoomResponse>((resolve) => {
      host.emit("create-room", {}, resolve);
    });
    assert.ok(created.roomId);
    const roomId = created.roomId;

    await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId }, resolve);
    });

    // 1. Viewer leaves gracefully via leave-room
    const hostPeerLeftPromise = new Promise<{ peerId: string; role: ParticipantRole }>((resolve) => {
      host.on("peer-left", resolve);
    });

    const leaveAck = await new Promise<{ success: boolean }>((resolve) => {
      viewer.emit("leave-room", { roomId }, resolve);
    });
    assert.strictEqual(leaveAck.success, true);

    const peerLeftData = await hostPeerLeftPromise;
    assert.strictEqual(peerLeftData.peerId, viewer.id);

    // Verify room stats after viewer left
    const roomState = signalingServer.roomManager.getRoom(roomId);
    assert.strictEqual(roomState?.participants.size, 1);

    // 2. Host disconnects abruptly
    host.disconnect();

    // Allow server event loop to process disconnect
    await new Promise((r) => setTimeout(r, 50));

    // Verify room is fully destroyed and cleaned up when last participant drops
    const roomAfterHostDrop = signalingServer.roomManager.getRoom(roomId);
    assert.strictEqual(roomAfterHostDrop, null);

    viewer.disconnect();
  });

  // ---------------------------------------------------------------------------
  // 6. Reconnections & ICE Restart Negotiation
  // ---------------------------------------------------------------------------
  await t.test("Reconnections & ICE Restart: Renegotiation offer relay with iceRestart flag", async () => {
    const presenter = createClient(testPort);
    const viewer = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => presenter.on("connect", r)),
      new Promise<void>((r) => viewer.on("connect", r)),
    ]);

    const created = await new Promise<CreateRoomResponse>((resolve) => {
      presenter.emit("create-room", {}, resolve);
    });
    assert.ok(created.roomId);

    await new Promise<JoinRoomResponse>((resolve) => {
      viewer.emit("join-room", { roomId: created.roomId }, resolve);
    });

    // Simulate ICE restart offer sent by presenter after packet loss or network disruption
    const iceRestartOfferPromise = new Promise<{
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
          offer: {
            type: "offer",
            sdp: "v=0\r\no=mock-restart 789 2 IN IP4 127.0.0.1\r\na=ice-options:restart\r\ns=-\r\n",
          },
        },
        resolve
      );
    });
    assert.strictEqual(offerAck.success, true);

    const receivedRestartOffer = await iceRestartOfferPromise;
    assert.strictEqual(receivedRestartOffer.fromPeerId, presenter.id);
    assert.ok(receivedRestartOffer.offer.sdp.includes("ice-options:restart"));

    presenter.disconnect();
    viewer.disconnect();
  });

  // ---------------------------------------------------------------------------
  // 7. Concurrent Multi-Room Isolation
  // ---------------------------------------------------------------------------
  await t.test("Multi-Room Isolation: Messages in Room A do not leak into Room B", async () => {
    const hostA = createClient(testPort);
    const hostB = createClient(testPort);
    const viewerA = createClient(testPort);
    const viewerB = createClient(testPort);

    await Promise.all([
      new Promise<void>((r) => hostA.on("connect", r)),
      new Promise<void>((r) => hostB.on("connect", r)),
      new Promise<void>((r) => viewerA.on("connect", r)),
      new Promise<void>((r) => viewerB.on("connect", r)),
    ]);

    const roomA = await new Promise<CreateRoomResponse>((resolve) => {
      hostA.emit("create-room", {}, resolve);
    });
    const roomB = await new Promise<CreateRoomResponse>((resolve) => {
      hostB.emit("create-room", {}, resolve);
    });

    assert.ok(roomA.roomId);
    assert.ok(roomB.roomId);
    assert.notStrictEqual(roomA.roomId, roomB.roomId);

    await new Promise<JoinRoomResponse>((resolve) => {
      viewerA.emit("join-room", { roomId: roomA.roomId }, resolve);
    });
    await new Promise<JoinRoomResponse>((resolve) => {
      viewerB.emit("join-room", { roomId: roomB.roomId }, resolve);
    });

    let leakedToViewerB = false;
    viewerB.on("screen-share-changed", () => {
      leakedToViewerB = true;
    });

    // Presenter in Room A toggles screen sharing
    await new Promise<{ success: boolean }>((resolve) => {
      hostA.emit(
        "screen-share-status",
        { isSharing: true, presenterToken: roomA.presenterToken },
        resolve
      );
    });

    // Short wait to ensure no leak occurs
    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(leakedToViewerB, false);

    hostA.disconnect();
    hostB.disconnect();
    viewerA.disconnect();
    viewerB.disconnect();
  });
});
