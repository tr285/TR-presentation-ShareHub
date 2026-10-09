import test from "node:test";
import assert from "node:assert";
import {
  getRTCConfiguration,
  isTurnConfigured,
  parseCandidatePairStats,
} from "../src/utils/webrtc-config";

test("WebRTC Configuration & Connectivity Suite", async (t) => {
  await t.test("Returns default Google STUN servers and policies", () => {
    const originalStun = process.env.NEXT_PUBLIC_STUN_SERVERS;
    const originalTurn = process.env.NEXT_PUBLIC_TURN_URL;
    const originalPolicy = process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY;
    delete process.env.NEXT_PUBLIC_STUN_SERVERS;
    delete process.env.NEXT_PUBLIC_TURN_URL;
    delete process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY;

    const config = getRTCConfiguration();

    assert.ok(config.iceServers);
    assert.strictEqual(config.bundlePolicy, "max-bundle");
    assert.strictEqual(config.rtcpMuxPolicy, "require");
    assert.strictEqual(config.iceCandidatePoolSize, 2);
    assert.strictEqual(config.iceTransportPolicy, "all");

    const defaultStun = config.iceServers[0];
    assert.ok(defaultStun.urls);
    const urls = Array.isArray(defaultStun.urls) ? defaultStun.urls : [defaultStun.urls];
    assert.ok(urls.some((u) => u.includes("stun.l.google.com")));

    if (originalStun) process.env.NEXT_PUBLIC_STUN_SERVERS = originalStun;
    if (originalTurn) process.env.NEXT_PUBLIC_TURN_URL = originalTurn;
    if (originalPolicy) process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY = originalPolicy;
  });

  await t.test("Parses custom STUN and TURN configurations from environment", () => {
    process.env.NEXT_PUBLIC_STUN_SERVERS = "stun:custom.stun.relay:3478, stun:backup.stun.relay:3478";
    process.env.NEXT_PUBLIC_TURN_URL = "turn:turn.relay.network:3478?transport=udp";
    process.env.NEXT_PUBLIC_TURN_USERNAME = "tr-test-user";
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = "tr-test-secret-password";
    process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY = "relay";

    const config = getRTCConfiguration();
    assert.ok(config.iceServers);
    assert.strictEqual(config.iceServers.length, 3); // Default STUN + Custom STUN + Custom TURN
    assert.strictEqual(config.iceTransportPolicy, "relay");

    const customStun = config.iceServers[1];
    assert.deepStrictEqual(customStun.urls, [
      "stun:custom.stun.relay:3478",
      "stun:backup.stun.relay:3478",
    ]);

    const customTurn = config.iceServers[2];
    assert.deepStrictEqual(customTurn.urls, [
      "turn:turn.relay.network:3478?transport=udp",
    ]);
    assert.strictEqual(customTurn.username, "tr-test-user");
    assert.strictEqual(customTurn.credential, "tr-test-secret-password");

    assert.strictEqual(isTurnConfigured(), true);

    // Cleanup env
    delete process.env.NEXT_PUBLIC_STUN_SERVERS;
    delete process.env.NEXT_PUBLIC_TURN_URL;
    delete process.env.NEXT_PUBLIC_TURN_USERNAME;
    delete process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
    delete process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY;

    assert.strictEqual(isTurnConfigured(), false);
  });

  await t.test("parseCandidatePairStats identifies local Wi-Fi LAN connection (host + host)", () => {
    const statsMap = new Map<string, Record<string, unknown>>();

    statsMap.set("pair-1", {
      type: "candidate-pair",
      state: "succeeded",
      selected: true,
      localCandidateId: "cand-local-1",
      remoteCandidateId: "cand-remote-1",
      currentRoundTripTime: 0.003, // 3ms
      bytesReceived: 1048576,
      bytesSent: 2097152,
    });

    statsMap.set("cand-local-1", {
      type: "local-candidate",
      candidateType: "host",
      protocol: "udp",
    });

    statsMap.set("cand-remote-1", {
      type: "remote-candidate",
      candidateType: "host",
      protocol: "udp",
    });

    const diagnostics = parseCandidatePairStats(statsMap as unknown as RTCStatsReport);

    assert.strictEqual(diagnostics.transportType, "local-lan");
    assert.strictEqual(diagnostics.localCandidateType, "host");
    assert.strictEqual(diagnostics.remoteCandidateType, "host");
    assert.strictEqual(diagnostics.rttMs, 3);
    assert.strictEqual(diagnostics.bytesReceived, 1048576);
    assert.strictEqual(diagnostics.bytesSent, 2097152);
  });

  await t.test("parseCandidatePairStats identifies Internet P2P via STUN (srflx)", () => {
    const statsMap = new Map<string, Record<string, unknown>>();

    statsMap.set("pair-2", {
      type: "candidate-pair",
      state: "succeeded",
      nominated: true,
      localCandidateId: "cand-local-srflx",
      remoteCandidateId: "cand-remote-host",
      currentRoundTripTime: 0.028, // 28ms
    });

    statsMap.set("cand-local-srflx", {
      type: "local-candidate",
      candidateType: "srflx",
      protocol: "udp",
    });

    statsMap.set("cand-remote-host", {
      type: "remote-candidate",
      candidateType: "host",
      protocol: "udp",
    });

    const diagnostics = parseCandidatePairStats(statsMap as unknown as RTCStatsReport);

    assert.strictEqual(diagnostics.transportType, "direct-p2p");
    assert.strictEqual(diagnostics.localCandidateType, "srflx");
    assert.strictEqual(diagnostics.remoteCandidateType, "host");
    assert.strictEqual(diagnostics.rttMs, 28);
  });

  await t.test("parseCandidatePairStats identifies TURN relay fallback (relay)", () => {
    const statsMap = new Map<string, Record<string, unknown>>();

    statsMap.set("pair-3", {
      type: "candidate-pair",
      state: "succeeded",
      selected: true,
      localCandidateId: "cand-local-relay",
      remoteCandidateId: "cand-remote-srflx",
      roundTripTime: 0.065, // 65ms
    });

    statsMap.set("cand-local-relay", {
      type: "local-candidate",
      candidateType: "relay",
      protocol: "udp",
    });

    statsMap.set("cand-remote-srflx", {
      type: "remote-candidate",
      candidateType: "srflx",
      protocol: "udp",
    });

    const diagnostics = parseCandidatePairStats(statsMap as unknown as RTCStatsReport);

    assert.strictEqual(diagnostics.transportType, "turn-relay");
    assert.strictEqual(diagnostics.localCandidateType, "relay");
    assert.strictEqual(diagnostics.remoteCandidateType, "srflx");
    assert.strictEqual(diagnostics.rttMs, 65);
  });

  await t.test("parseCandidatePairStats returns unknown when report is null or empty", () => {
    const nullReport = parseCandidatePairStats(null);
    assert.strictEqual(nullReport.transportType, "unknown");
    assert.strictEqual(nullReport.rttMs, null);

    const emptyMap = new Map<string, Record<string, unknown>>();
    const emptyReport = parseCandidatePairStats(emptyMap as unknown as RTCStatsReport);
    assert.strictEqual(emptyReport.transportType, "unknown");
    assert.strictEqual(emptyReport.rttMs, null);
  });
});
