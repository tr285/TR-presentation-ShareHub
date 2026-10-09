/**
 * ==============================================================================
 * TR Presentation ShareHub - Bluetooth Discovery Service
 * ==============================================================================
 *
 * Implements Web Bluetooth API device discovery where supported and permitted
 * by the host OS and browser.
 *
 * Support Matrix:
 * - Chromium Browsers (Google Chrome, Microsoft Edge, Opera, Brave):
 *   - macOS (10.13+): Supported (Requires OS Bluetooth permission)
 *   - Windows (10 build 17063+): Supported
 *   - Android (6.0+ Marshmallow): Supported (Requires OS Bluetooth & Location)
 *   - ChromeOS: Supported
 *   - Linux: Experimental (requires chrome://flags/#enable-web-bluetooth)
 * - Apple WebKit / Safari (macOS, iOS, iPadOS):
 *   - NOT SUPPORTED: WebKit has explicitly declined Web Bluetooth due to
 *     fingerprinting and security attack surface.
 * - Mozilla Firefox:
 *   - NOT SUPPORTED: Mozilla considers Web Bluetooth harmful to user security.
 */

// Custom 128-bit UUIDs for ShareHub Bluetooth Service
export const SHAREHUB_BT_SERVICE_UUID = "0000fe28-0000-1000-8000-00805f9b34fb";
export const SHAREHUB_BT_ROOM_CHAR_UUID = "0000fe29-0000-1000-8000-00805f9b34fb";
export const SHAREHUB_BT_NAME_PREFIX = "ShareHub-";

export interface BluetoothSupportStatus {
  supported: boolean;
  platformName: string;
  browserName: string;
  reason?: string;
}

export type BluetoothDiscoveryErrorCode =
  | "UNSUPPORTED"
  | "NOT_SECURE_CONTEXT"
  | "USER_CANCELLED"
  | "ADAPTER_DISABLED"
  | "PERMISSION_DENIED"
  | "CONNECTION_FAILED"
  | "INVALID_ROOM_DATA"
  | "UNKNOWN_ERROR";

export interface BluetoothDiscoveryResult {
  success: boolean;
  roomId?: string;
  deviceName?: string;
  errorCode?: BluetoothDiscoveryErrorCode;
  errorMessage?: string;
}

export interface WebBluetoothDevice {
  name?: string;
  gatt?: {
    connect: () => Promise<{
      getPrimaryService: (service: string) => Promise<{
        getCharacteristic: (characteristic: string) => Promise<{
          readValue: () => Promise<DataView>;
        }>;
      }>;
    }>;
  };
}

export interface WebBluetoothNavigator {
  bluetooth: {
    requestDevice: (options: {
      filters?: Array<{ namePrefix?: string; services?: string[] }>;
      optionalServices?: string[];
      acceptAllDevices?: boolean;
    }) => Promise<WebBluetoothDevice>;
  };
}

/**
 * Detects whether the current browser and OS environment supports the Web Bluetooth API.
 */
export function isWebBluetoothSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return Boolean(
    "bluetooth" in navigator &&
      typeof (navigator as unknown as { bluetooth: { requestDevice?: unknown } }).bluetooth?.requestDevice === "function"
  );
}

/**
 * Returns detailed evaluation of platform & browser Bluetooth support.
 */
export function getBluetoothPlatformStatus(): BluetoothSupportStatus {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      supported: false,
      platformName: "Server / SSR",
      browserName: "Node.js",
      reason: "Web Bluetooth API is only available in client browser environments.",
    };
  }

  const ua = navigator.userAgent;
  let browserName = "Unknown Browser";
  let platformName = "Unknown OS";

  // Platform detection
  if (/Macintosh|Mac OS X/i.test(ua)) {
    platformName = "macOS";
  } else if (/Windows/i.test(ua)) {
    platformName = "Windows";
  } else if (/Android/i.test(ua)) {
    platformName = "Android";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    platformName = "iOS / iPadOS";
  } else if (/Linux/i.test(ua)) {
    platformName = "Linux";
  } else if (/CrOS/i.test(ua)) {
    platformName = "ChromeOS";
  }

  // Browser detection
  const isFirefox = /Firefox/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua);
  const isEdge = /Edg/i.test(ua);
  const isChrome = /Chrome|Chromium/i.test(ua) && !/Edg|OPR/i.test(ua);

  if (isFirefox) browserName = "Firefox";
  else if (isSafari) browserName = "Safari";
  else if (isEdge) browserName = "Microsoft Edge";
  else if (isChrome) browserName = "Google Chrome";

  if (!window.isSecureContext) {
    return {
      supported: false,
      platformName,
      browserName,
      reason: "Web Bluetooth API requires a Secure Context (HTTPS or localhost).",
    };
  }

  if (isSafari || platformName === "iOS / iPadOS") {
    return {
      supported: false,
      platformName,
      browserName,
      reason:
        "Apple Safari does not support the Web Bluetooth API. Use the 6-digit room PIN or scan the on-screen QR code.",
    };
  }

  if (isFirefox) {
    return {
      supported: false,
      platformName,
      browserName,
      reason:
        "Mozilla Firefox does not support the Web Bluetooth API. Use Google Chrome or Microsoft Edge to use Bluetooth discovery.",
    };
  }

  const supported = isWebBluetoothSupported();
  return {
    supported,
    platformName,
    browserName,
    reason: supported
      ? undefined
      : "Web Bluetooth is not enabled in this browser. Please enable Bluetooth in your browser settings or flags.",
  };
}

/**
 * Extracts a Room ID from a Bluetooth device name (e.g. "ShareHub-TR-842" -> "TR-842").
 */
export function extractRoomIdFromDeviceName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();

  // Match ShareHub-[ROOM_ID]
  if (trimmed.startsWith(SHAREHUB_BT_NAME_PREFIX)) {
    const candidate = trimmed.slice(SHAREHUB_BT_NAME_PREFIX.length).trim();
    if (candidate.length >= 4) {
      return candidate.toUpperCase();
    }
  }

  // Check if the entire name is a valid TR formatted room ID (e.g., TR-123-456)
  if (/^TR-[A-Z0-9]{3,4}-[A-Z0-9]{3,4}$/i.test(trimmed) || /^TR-[A-Z0-9]{4,12}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

/**
 * Format an advertised Bluetooth peripheral name for a given room ID.
 */
export function formatBluetoothAdvertisedName(roomId: string): string {
  return `${SHAREHUB_BT_NAME_PREFIX}${roomId.toUpperCase()}`;
}

/**
 * Prompts the user to select a nearby Bluetooth device broadcasting a ShareHub presentation.
 * Returns the discovered room ID or an error code.
 */
export async function discoverShareHubDeviceViaBluetooth(): Promise<BluetoothDiscoveryResult> {
  const status = getBluetoothPlatformStatus();
  if (!status.supported) {
    return {
      success: false,
      errorCode: "UNSUPPORTED",
      errorMessage: status.reason || "Web Bluetooth is not supported on this platform.",
    };
  }

  try {
    const bluetooth = (navigator as unknown as WebBluetoothNavigator).bluetooth;

    // First try requesting with ShareHub name prefix and optional service UUIDs
    const device = await bluetooth.requestDevice({
      filters: [{ namePrefix: SHAREHUB_BT_NAME_PREFIX }],
      optionalServices: [SHAREHUB_BT_SERVICE_UUID],
    });

    const deviceName = device.name || "Unknown Bluetooth Device";

    // 1. Try extracting room ID directly from device name
    const extractedFromName = extractRoomIdFromDeviceName(device.name);
    if (extractedFromName) {
      return {
        success: true,
        roomId: extractedFromName,
        deviceName,
      };
    }

    // 2. If name didn't contain the room ID, attempt to read GATT Characteristic
    if (device.gatt) {
      try {
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(SHAREHUB_BT_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(SHAREHUB_BT_ROOM_CHAR_UUID);
        const value = await characteristic.readValue();
        const decoder = new TextDecoder("utf-8");
        const gattRoomId = decoder.decode(value).trim();

        if (gattRoomId && gattRoomId.length >= 4) {
          return {
            success: true,
            roomId: gattRoomId.toUpperCase(),
            deviceName,
          };
        }
      } catch {
        // Fall back if GATT reading fails
      }
    }

    return {
      success: false,
      errorCode: "INVALID_ROOM_DATA",
      errorMessage: `Selected device "${deviceName}" did not provide a valid ShareHub room identifier.`,
    };
  } catch (err: unknown) {
    const error = err as Error;

    if (error.name === "NotFoundError") {
      return {
        success: false,
        errorCode: "USER_CANCELLED",
        errorMessage: "Bluetooth discovery cancelled: No device was selected.",
      };
    }

    if (error.name === "SecurityError") {
      return {
        success: false,
        errorCode: "PERMISSION_DENIED",
        errorMessage:
          "Bluetooth access was denied. Please grant Bluetooth permissions in your operating system settings.",
      };
    }

    if (error.name === "NotSupportedError") {
      return {
        success: false,
        errorCode: "ADAPTER_DISABLED",
        errorMessage: "Bluetooth adapter is turned off or not available on this device.",
      };
    }

    return {
      success: false,
      errorCode: "UNKNOWN_ERROR",
      errorMessage: error.message || "An unexpected error occurred during Bluetooth discovery.",
    };
  }
}
