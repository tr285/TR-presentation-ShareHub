import test from "node:test";
import assert from "node:assert";
import { getRTCConfiguration } from "../src/utils/webrtc-config";

test("WebRTC Configuration Suite", async (t) => {
  await t.test("Returns default Google STUN servers and policies", () => {
    const originalStun = process.env.NEXT_PUBLIC_STUN_SERVERS;
    const originalTurn = process.env.NEXT_PUBLIC_TURN_URL;
    delete process.env.NEXT_PUBLIC_STUN_SERVERS;
    delete process.env.NEXT_PUBLIC_TURN_URL;

    const config = getRTCConfiguration();

    assert.ok(config.iceServers);
    assert.strictEqual(config.bundlePolicy, "max-bundle");
    assert.strictEqual(config.rtcpMuxPolicy, "require");
    assert.strictEqual(config.iceCandidatePoolSize, 2);

    const defaultStun = config.iceServers[0];
    assert.ok(defaultStun.urls);
    const urls = Array.isArray(defaultStun.urls) ? defaultStun.urls : [defaultStun.urls];
    assert.ok(urls.some((u) => u.includes("stun.l.google.com")));

    if (originalStun) process.env.NEXT_PUBLIC_STUN_SERVERS = originalStun;
    if (originalTurn) process.env.NEXT_PUBLIC_TURN_URL = originalTurn;
  });

  await t.test("Parses custom STUN and TURN configurations from environment", () => {
    process.env.NEXT_PUBLIC_STUN_SERVERS = "stun:custom.stun.relay:3478, stun:backup.stun.relay:3478";
    process.env.NEXT_PUBLIC_TURN_URL = "turn:turn.relay.network:3478?transport=udp";
    process.env.NEXT_PUBLIC_TURN_USERNAME = "tr-test-user";
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = "tr-test-secret-password";

    const config = getRTCConfiguration();
    assert.ok(config.iceServers);
    assert.strictEqual(config.iceServers.length, 3); // Default STUN + Custom STUN + Custom TURN

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

    // Cleanup env
    delete process.env.NEXT_PUBLIC_STUN_SERVERS;
    delete process.env.NEXT_PUBLIC_TURN_URL;
    delete process.env.NEXT_PUBLIC_TURN_USERNAME;
    delete process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  });
});
