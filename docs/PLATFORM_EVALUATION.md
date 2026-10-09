# TR Presentation ShareHub — Platform Evaluation Matrix
## Native Screen Capture, Device Discovery & Bluetooth Implementation

This document provides an engineering evaluation of native screen capture APIs, system audio loopback, OS security permissions, and device discovery mechanisms across all major operating systems and client platforms, along with the Web Bluetooth implementation details integrated into TR Presentation ShareHub.

---

## 1. Executive Summary

TR Presentation ShareHub is built on browser-native WebRTC to provide zero-install, instant screen sharing across devices. To support future native wrappers (Tauri, Electron, Swift, Kotlin) and maximize discovery capabilities without breaking web standards, this evaluation benchmarks:
1. **Screen Capture Capabilities**: Web standards vs. platform-native OS capture pipelines.
2. **Device Discovery Mechanisms**: Web Bluetooth, Native BLE beacons, mDNS/Bonjour, and QR/PIN zero-conf fallbacks.
3. **OS Security & Permission Models**: TCC, MediaProjection, UAC, Wayland portals, and browser sandboxes.

---

## 2. Screen Capture Evaluation Matrix

| Platform | Primary API | Latency & Performance | System Audio Loopback | OS Permissions & User Consent | Sandbox Limitations |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Web (Desktop)** | `getDisplayMedia()` | 30–60 FPS, GPU-accelerated H.264/VP8/VP9 | Chrome/Edge: Yes (Tab/Desktop); Safari: Tab only | Browser dialog + macOS Screen Recording TCC | Cannot capture DRM/HDCP protected video |
| **Web (Mobile)** | `getDisplayMedia()` | Android Chrome: 30 FPS; iOS Safari: Unsupported | Android: Partial; iOS: None | Android system prompt; iOS blocks display capture | WebKit iOS explicitly restricts whole-screen sharing |
| **macOS (Native)** | `ScreenCaptureKit` (macOS 12.3+) | 60–120 FPS (ProMotion), zero-copy Metal/IOSurface | Native per-app & system audio without virtual driver | `System Settings > Privacy & Security > Screen Recording` | Window occlusion filters, requires notarized entitlement |
| **Windows (Native)**| `Windows.Graphics.Capture` / DXGI | 60–144 FPS, direct D3D11 surface sharing | WASAPI loopback capture (`IAudioClient`) | None for standard desktop apps; prompt for UWP/MSIX | HDCP content protection renders black box |
| **Linux (Native)**  | PipeWire (`XDG Desktop Portal`) / X11 | 30–60 FPS, DMA-BUF zero-copy under Wayland | PipeWire audio monitor streams | Interactive session prompt in GNOME Shell / KDE Plasma | Flatpak/Snap isolation mediated by Portal |
| **Android (Native)**| `MediaProjection` (API 21+) | 30–60 FPS, hardware MediaCodec encoder | `AudioPlaybackCaptureConfiguration` (Android 10+) | System warning dialog + Foreground Service notification | Android 14+ introduces single-app capture option |
| **iOS / iPadOS**    | `ReplayKit` (Broadcast Upload Ext) | 30–60 FPS, Hardware H.264 encoder | App audio + microphone via `CMSampleBuffer` | System broadcast picker sheet (`RPSystemBroadcastPickerView`) | **50 MB RAM ceiling** in Broadcast Extension process |

---

## 3. Platform-by-Platform Screen Capture Details

### 3.1 Web Browser (Preserved Implementation)
- **Standard**: W3C Screen Capture specification (`navigator.mediaDevices.getDisplayMedia`).
- **Surface Controls**:
  - `displaySurface`: Allows users to select between entire monitors (`monitor`), application windows (`window`), or browser tabs (`browser`).
  - `selfBrowserSurface`: Prevents infinite picture-in-picture mirror loops by allowing exclusion of the current ShareHub tab.
  - `systemAudio`: Requests system audio stream alongside video track (`systemAudio: "include"`).
- **Region Capture & Element Restriction**:
  - Modern Chromium supports `CropTarget` and `RestrictionTarget` for programmatic window scoping.
- **Constraints**:
  - iOS Safari does not support `getDisplayMedia()` for entire device capture due to Apple security boundaries.
  - Mobile Chrome on Android supports `getDisplayMedia()` by invoking the native `MediaProjection` system prompt.

### 3.2 macOS Native (ScreenCaptureKit)
- **Target OS**: macOS 12.3 (Monterey), 13 (Ventura), 14 (Sonoma), 15 (Sequoia).
- **Framework**: `ScreenCaptureKit.framework`.
- **Key Advantages over Legacy CGDisplayStream**:
  - Direct zero-copy Metal textures passed to GPU.
  - Window exclusion: The presenter can hide the ShareHub controller window from the video stream cleanly (`SCContentFilter`).
  - System audio capture without installing virtual kernel extensions (e.g. BlackHole or Soundflower).
- **Entitlements**: `com.apple.security.device.screen-capture` required in hardened runtime.

### 3.3 Windows Native (Windows.Graphics.Capture)
- **Target OS**: Windows 10 (Build 1803+) and Windows 11.
- **Framework**: Windows Runtime (WinRT) / Direct3D 11 Interop.
- **Key Advantages over Legacy GDI BitBlt**:
  - Direct DXGI surface access with zero CPU readback penalties.
  - `IsCursorCaptureEnabled`: Toggle cursor visibility dynamically.
  - `IsBorderRequired`: Configures yellow capture border introduced in Windows 11 for privacy awareness.
- **Audio Capture**: Windows Core Audio WASAPI Loopback (`AUDCLNT_STREAMFLAGS_LOOPBACK`) records all audio output synchronously.

### 3.4 Linux Native (Wayland / PipeWire)
- **Display Servers**: Wayland (modern default) and X11 (legacy).
- **Wayland Pipeline**:
  - Uses DBus interface `org.freedesktop.portal.ScreenCast`.
  - Portal creates a PipeWire node and shares DMA-BUF file descriptors for hardware-accelerated video buffers without X11 shared memory insecurities.
- **X11 Fallback**: `XShmGetImage` or XComposite extension.

### 3.5 Android Native (MediaProjection)
- **Target OS**: Android 5.0 (API 21) through Android 15.
- **Foreground Service Enforcement**: Android 10+ requires `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` declared in `AndroidManifest.xml`. If the service is destroyed, capture stops immediately.
- **Audio**: Applications targeting API 29+ can capture system audio played by apps that do not explicitly opt out (`android:allowAudioPlaybackCapture="false"`).

### 3.6 iOS / iPadOS Native (ReplayKit Broadcast Extension)
- **Target OS**: iOS 12.0 through iOS 18.
- **Two Components**:
  1. Main Container App: Initiates pairing and signaling.
  2. Broadcast Upload Extension (`RPBroadcastSampleHandler`): Dedicated lightweight process that receives raw video `CMSampleBuffer` frames from SpringBoard.
- **Crucial Memory Constraint**: iOS enforces an operating system ceiling of ~50 MB RAM for App Extensions. The extension must use hardware-accelerated H.264 compression and stream WebRTC RTP packets directly without buffering uncompressed NV12 frames in memory.

---

## 4. Device Discovery Evaluation Matrix

| Discovery Mechanism | Web Browser Support | Native OS Support | User Gesture Required? | Cross-Subnet / Internet? | Security / Privacy Boundary |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Web Bluetooth** | Chromium (Chrome/Edge on Mac, Win, Android) | All desktop & mobile OS via native Bluetooth stack | **Yes** (Strict `onClick` gesture) | No (Short range BLE ~10m) | Explicit browser device picker; rejected by Apple/Mozilla |
| **Native BLE Beacons** | No (Web Bluetooth Peripheral mode is unsupported) | macOS, Windows, Linux, Android, iOS | No (Can broadcast/scan in background) | No (Short range BLE ~10m) | Android requires Location/Scan permission; iOS requires Info.plist string |
| **mDNS / Bonjour** | No (Browsers cannot bind raw UDP multicast sockets) | macOS (Bonjour), Linux (Avahi), Windows (DNS-SD), Android/iOS | No (Background daemon) | Same local Wi-Fi subnet only | Zero-configuration; vulnerable to local spoofing without TLS PIN |
| **QR Code Scan** | Universal (Camera API or Native Phone Camera) | Universal | User points camera | Yes (Encodes room URL + PIN) | Secure; requires physical line of sight |
| **6-Digit Room PIN** | Universal (Standard HTTP/WebSocket Signaling) | Universal | User types 6 characters | Yes (Local LAN + Internet TURN) | Protected by timing-safe hash verification & rate limiting |

---

## 5. Web Bluetooth Implementation Details in ShareHub

### 5.1 Why Conditional & Permitted Implementation?
Web Bluetooth (`navigator.bluetooth`) is only implemented where supported by the browser engine and permitted by the OS:
1. **Chromium Browsers (Supported)**:
   - Google Chrome, Microsoft Edge, Opera, and Brave on macOS, Windows, Android, and ChromeOS support the Central role (`requestDevice()`).
2. **Apple WebKit / Safari (Unsupported)**:
   - Apple WebKit explicitly declined Web Bluetooth due to fingerprinting and hardware exploit attack surfaces.
   - On Safari (macOS, iOS, iPadOS), ShareHub displays a clean status indicator and falls back to QR code scanning and short room PINs.
3. **Mozilla Firefox (Unsupported)**:
   - Mozilla standards position classifies Web Bluetooth as harmful.
   - On Firefox, ShareHub disables the Bluetooth button and guides users to Chrome/Edge or manual room PINs.

### 5.2 Bluetooth Architecture in ShareHub
```
                Audience Device (Chrome / Edge)
                               │
               Clicks "Nearby Bluetooth" Button
                               │
                  navigator.bluetooth.requestDevice({
                    filters: [{ namePrefix: "ShareHub-" }],
                    optionalServices: ["0000fe28-0000-1000-8000-00805f9b34fb"]
                  })
                               │
                     OS Bluetooth Picker
                     ┌───────────────────┐
                     │ ShareHub-TR-842   │ ◄── Discovered
                     └───────────────────┘
                               │
                     Device Selected by User
                               │
                extractRoomIdFromDeviceName()
                               │
                Auto-Fills Room ID: "TR-842"
                               │
               Joins Room via WebRTC Signaling
```

### 5.3 Service & Characteristic Specifications
- **Service UUID**: `0000fe28-0000-1000-8000-00805f9b34fb` (ShareHub Discovery Service)
- **Room ID Characteristic UUID**: `0000fe29-0000-1000-8000-00805f9b34fb` (Read UTF-8 Room ID)
- **Advertised Name Format**: `ShareHub-[ROOM_ID]` (e.g. `ShareHub-TR-842-917`)

---

## 6. Recommendations & Roadmap for Native Companion Apps

For enterprise deployments requiring features beyond the browser sandbox:

1. **Desktop Native Wrapper (Electron / Tauri 2.0)**:
   - Use `ScreenCaptureKit` on macOS and `Windows.Graphics.Capture` on Windows for zero-copy 120 FPS streaming.
   - Use native BLE peripheral advertising (`CoreBluetooth` / `Windows.Devices.Bluetooth`) so presenters broadcast `ShareHub-[ROOM_ID]` continuously without browser prompts.
   - Use local mDNS daemon to advertise `_sharehub._tcp.local` on the conference room network.

2. **Mobile Companion App (iOS & Android)**:
   - iOS: Implement a ReplayKit Broadcast Upload Extension allowing presenters to stream their iPhone/iPad home screen, slides, and apps.
   - Android: Implement a `MediaProjection` foreground service with partial screen sharing (`MediaProjectionConfig.createConfigForUserChoice()`).

3. **Preserved Web Core**:
   - The zero-install web client remains the primary receiver and viewer for all audience members, ensuring zero barriers to entry in any presentation room.
