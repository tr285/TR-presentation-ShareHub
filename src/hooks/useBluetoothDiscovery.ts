"use client";

import { useState, useCallback } from "react";
import {
  getBluetoothPlatformStatus,
  discoverShareHubDeviceViaBluetooth,
  type BluetoothSupportStatus,
  type BluetoothDiscoveryResult,
} from "../utils/bluetooth-discovery";

export function useBluetoothDiscovery() {
  const [platformStatus] = useState<BluetoothSupportStatus>(() =>
    getBluetoothPlatformStatus()
  );
  const [isScanning, setIsScanning] = useState(false);
  const [lastDiscoveredRoomId, setLastDiscoveredRoomId] = useState<string | null>(null);
  const [discoveredDeviceName, setDiscoveredDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearBluetoothError = useCallback(() => {
    setError(null);
  }, []);

  const discoverNearbyRoom = useCallback(async (): Promise<string | null> => {
    setError(null);
    setIsScanning(true);

    try {
      const result: BluetoothDiscoveryResult = await discoverShareHubDeviceViaBluetooth();
      if (result.success && result.roomId) {
        setLastDiscoveredRoomId(result.roomId);
        setDiscoveredDeviceName(result.deviceName || null);
        return result.roomId;
      } else {
        if (result.errorCode !== "USER_CANCELLED") {
          setError(result.errorMessage || "Failed to discover nearby Bluetooth presentation.");
        }
        return null;
      }
    } catch (err: unknown) {
      const message = (err as Error)?.message || "Failed to discover nearby Bluetooth presentation.";
      setError(message);
      return null;
    } finally {
      setIsScanning(false);
    }
  }, []);

  return {
    isSupported: platformStatus.supported,
    platformStatus,
    isScanning,
    lastDiscoveredRoomId,
    discoveredDeviceName,
    error,
    discoverNearbyRoom,
    clearBluetoothError,
  };
}
