# TR-presentation-ShareHub

> **High-Performance, Ephemeral WebRTC Screen Sharing & Presentation Streaming**

[![Tests](https://img.shields.io/badge/tests-40%20passing-brightgreen.svg)]()
[![Next.js](https://img.shields.io/badge/Next.js-16.4-black.svg)]()
[![React](https://img.shields.io/badge/React-19.3-blue.svg)]()
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-white.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)]()
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC.svg)]()

**TR Presentation ShareHub** is a secure, cross-device screen-sharing application designed for conference rooms, lectures, team meetings, and instant demos. Presenters can broadcast their desktop screen directly to multiple audience members via WebRTC—with no user accounts, no software installation, and no cloud recording servers.

---

## 🌟 Key Features

- **Instant Ephemeral Rooms**: Generate temporary 6-digit room IDs (`TR-XXX-XXX`) or scannable mobile QR codes with automatic 2-hour lifecycle expiration.
- **Native Browser WebRTC Streaming**: Direct peer-to-peer 60fps presentation video with sub-second latency.
- **Web Bluetooth Device Discovery**: Find nearby active ShareHub presenters using Web Bluetooth (Chrome/Edge on macOS, Windows, Android) with graceful fallbacks on Safari/Firefox/iOS.
- **Local Wi-Fi Priority**: Automatically uses `host` ICE candidates when presenter and viewers share the same Wi-Fi network, using zero external internet upload bandwidth.
- **Enterprise NAT & TURN Fallback**: Seamlessly falls back to STUN NAT traversal or TURN relay servers (UDP 3478 / TLS 443) when crossing symmetric NATs or restrictive corporate firewalls.
- **Passcode PIN Protection**: Optional 4–8 digit PIN protection with SHA-256 hashes, constant-time comparison (`crypto.timingSafeEqual`), and sliding-window brute-force lockout defenses.
- **Explicit Consent**: Native browser display media picker prompt with clear start/stop presentation controls.
- **Live Connection Diagnostics**: Real-time stage badges and modal inspecting the active candidate pair (Local Wi-Fi vs Direct P2P vs TURN Relay) and round-trip latency (RTT).
- **Production-Ready Operations**: Multi-stage Dockerfiles, Docker Compose, Nginx/Caddy reverse proxy configs, PM2 ecosystem, and structured JSON logging.

---

## 🏗️ Architecture

```
                               ┌────────────────────────┐
                               │   Presenter / Viewer   │
                               │     Web Browser        │
                               └───────────┬────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │                                     │
           HTTPS (Port 443)                     WSS (Port 443 / 3001)
                        │                                     │
                        ▼                                     ▼
           ┌─────────────────────────┐           ┌─────────────────────────┐
           │   Frontend Application  │           │    Signaling Server     │
           │   (Next.js App Router)  │           │   (Node.js + Socket.IO) │
           │   Port 3000 (Internal)  │           │   Port 3001 (Internal)  │
           └─────────────────────────┘           └─────────────────────────┘
                                                              │
                                             WebRTC P2P (UDP) │ Fallback
                                                              ▼
                                                 ┌─────────────────────────┐
                                                 │    TURN / STUN Relay    │
                                                 │   (coTURN on Port 443)  │
                                                 └─────────────────────────┘
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js `20.x` or higher (`v26.x` recommended)
- npm `10.x` or higher

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/tr285/TR-presentation-ShareHub.git
cd TR-presentation-ShareHub
npm install
```

### 2. Configure Environment (Optional)
```bash
cp .env.example .env.local
```

### 3. Start Development Server
A single unified command boots both the signaling server (port 3001) and Next.js frontend (port 3000) concurrently:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The status pill will display **Signaling Online** (green).

*(Alternatively, run `npm run server` and `npm run dev:frontend` in separate terminals if preferred).*

---

## 🧪 Testing & Verification

The codebase includes **40 automated tests across 5 test suites**:
- **Bluetooth Discovery Suite**: Web Bluetooth feature detection, platform status, room ID device name parsing, and error mapping.
- **Phase 7 E2E Suite**: Lifecycle flows, screen permissions, disconnections, and cleanup.
- **Security Suite**: Sliding-window rate limiting, PIN brute-force lockout, CORS origin checks, and payload validation.
- **Signaling Suite**: Room manager, participant limits, and WebRTC relay events.
- **WebRTC Config Suite**: ICE servers, candidate pair classification, and transport types.

Run the test suite:
```bash
npm test
```

Run production build validation:
```bash
npm run build
```

---

## 🐳 Docker Deployment

Run the complete multi-container stack with Docker Compose:

```bash
docker compose up -d --build
```

- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Signaling Health Check**: [http://localhost:3001/health](http://localhost:3001/health)

---

## 📖 Documentation

- [Platform Evaluation Matrix](docs/PLATFORM_EVALUATION.md) — Screen capture APIs, system audio loopback, permissions, and device discovery across Web, macOS, Windows, Linux, Android, and iOS.
- [Network Connectivity & STUN/TURN Guide](docs/CONNECTIVITY.md) — Local Wi-Fi conditions, AP client isolation, NAT traversal, and coTURN setup.
- [Production Deployment Runbook](docs/DEPLOYMENT.md) — Decoupled deployments, Nginx/Caddy SSL/WSS reverse proxy, and monitoring.

---

## 📄 License

MIT License. Built with ❤️ for seamless, privacy-respecting presentations.
