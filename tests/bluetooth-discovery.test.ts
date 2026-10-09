import test from "node:test";
import assert from "node:assert";
import {
  extractRoomIdFromDeviceName,
  formatBluetoothAdvertisedName,
  getBluetoothPlatformStatus,
  isWebBluetoothSupported,
  discoverShareHubDeviceViaBluetooth,
  SHAREHUB_BT_SERVICE_UUID,
  SHAREHUB_BT_ROOM_CHAR_UUID,
  SHAREHUB_BT_NAME_PREFIX,
} from "../src/utils/bluetooth-discovery";

test("Bluetooth Discovery & Platform Support Suite", async (t) => {
  await t.test("Validates constants and UUID specifications", () => {
    assert.strictEqual(SHAREHUB_BT_NAME_PREFIX, "ShareHub-");
    assert.match(SHAREHUB_BT_SERVICE_UUID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.match(SHAREHUB_BT_ROOM_CHAR_UUID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  await t.test("extractRoomIdFromDeviceName extracts valid ShareHub room codes", () => {
    assert.strictEqual(
      extractRoomIdFromDeviceName("ShareHub-TR-842-917"),
      "TR-842-917"
    );
    assert.strictEqual(
      extractRoomIdFromDeviceName("ShareHub-DEMO-001"),
      "DEMO-001"
    );
    assert.strictEqual(
      extractRoomIdFromDeviceName("TR-999-111"),
      "TR-999-111"
    );
    assert.strictEqual(
      extractRoomIdFromDeviceName("ShareHub-tr1234"),
      "TR1234"
    );
  });

  await t.test("extractRoomIdFromDeviceName rejects non-ShareHub or malformed device names", () => {
    assert.strictEqual(extractRoomIdFromDeviceName(""), null);
    assert.strictEqual(extractRoomIdFromDeviceName(null), null);
    assert.strictEqual(extractRoomIdFromDeviceName(undefined), null);
    assert.strictEqual(extractRoomIdFromDeviceName("AirPods Pro"), null);
    assert.strictEqual(extractRoomIdFromDeviceName("Bose QC35"), null);
    assert.strictEqual(extractRoomIdFromDeviceName("ShareHub-"), null);
    assert.strictEqual(extractRoomIdFromDeviceName("ShareHub-12"), null); // under 4 chars
  });

  await t.test("formatBluetoothAdvertisedName formats standard BLE peripheral name", () => {
    assert.strictEqual(
      formatBluetoothAdvertisedName("TR-123-456"),
      "ShareHub-TR-123-456"
    );
    assert.strictEqual(
      formatBluetoothAdvertisedName("room99"),
      "ShareHub-ROOM99"
    );
  });

  await t.test("getBluetoothPlatformStatus handles SSR / non-browser gracefully", () => {
    const status = getBluetoothPlatformStatus();
    assert.strictEqual(status.supported, false);
    assert.strictEqual(typeof status.platformName, "string");
    assert.strictEqual(typeof status.browserName, "string");
    assert.ok(status.reason && status.reason.length > 0);
  });

  await t.test("isWebBluetoothSupported returns false when navigator.bluetooth is absent", () => {
    assert.strictEqual(isWebBluetoothSupported(), false);
  });

  await t.test("discoverShareHubDeviceViaBluetooth returns UNSUPPORTED when Web Bluetooth is missing", async () => {
    const res = await discoverShareHubDeviceViaBluetooth();
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, "UNSUPPORTED");
    assert.ok(res.errorMessage && res.errorMessage.length > 0);
  });
});
