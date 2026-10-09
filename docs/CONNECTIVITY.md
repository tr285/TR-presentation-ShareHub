# TR Presentation ShareHub — Connectivity & Network Architecture

This guide explains how **TR Presentation ShareHub** establishes real-time WebRTC screen streaming, how to test devices on the same Wi-Fi versus across different networks, how to configure STUN/TURN relays, and the fundamental requirements for local-only versus internet-routed streaming.

---

## 1. Network Architecture Overview

TR Presentation ShareHub uses a hybrid architecture:
1. **Signaling Tier (Socket.IO over WebSockets / HTTP)**:
   - Handles room creation, participant lifecycle, authentication PIN verification, and SDP/ICE candidate exchange.
   - Video pixels **never** touch the signaling server.
2. **Media Transport Tier (Native WebRTC `RTCPeerConnection`)**:
   - Direct peer-to-peer audio/video streaming via UDP with SRTP encryption.
   - ICE (Interactive Connectivity Establishment) automatically gathers multiple connection candidates:
     - **Host candidates (`host`)**: Direct local network/LAN IP addresses.
     - **Server Reflexive candidates (`srflx`)**: Public IP/port discovered via STUN.
     - **Relay candidates (`relay`)**: Media relayed through an intermediate TURN server.

---

## 2. Testing Devices on the Same Wi-Fi (Local LAN Mode)

When presenter and viewers are connected to the same Wi-Fi router or office Ethernet LAN:

### How it Works
1. WebRTC gathers `host` candidates containing each device's local private IP (e.g. `192.168.1.45` and `192.168.1.82`).
2. The browser prioritizes host-to-host candidate pairs.
3. Media flows directly between devices across the local Wi-Fi switch without consuming external internet bandwidth.
4. Latency is minimal (typically **1ms – 5ms**), delivering crisp 60fps screen streaming.

### Step-by-Step Local Wi-Fi Testing Procedure
1. Find your computer's local Wi-Fi IP address:
   - **macOS / Linux**: `ipconfig getifaddr en0` or `hostname -I`
   - **Windows**: `ipconfig` (IPv4 Address)
   - *Example: `192.168.1.150`*
2. Configure the signaling URL in `.env.local`:
   ```bash
   NEXT_PUBLIC_SIGNALING_URL=http://192.168.1.150:3001
   ```
3. Start the application:
   ```bash
   npm run server   # Starts signaling on port 3001
   npm run dev      # Starts Next.js on port 3000
   ```
4. On your desktop browser, open `http://localhost:3000` and click **Create Presentation Room**.
5. On another device (phone, tablet, or second laptop on the same Wi-Fi), open `http://192.168.1.150:3000` or scan the on-screen QR code.
6. The viewer automatically connects. The top stage badge will display:
   ```
   [🟢 Local Wi-Fi (P2P)  3ms]
   ```

### ⚠️ Local-Only Mode Network Requirements & Limitations
- **Access Point (AP) Client Isolation**:
  Many public, guest, hotel, or corporate Wi-Fi networks enable **AP Isolation** (also called Client Isolation). This setting prevents wireless devices from sending packets directly to one another.
  - *Symptom*: Signaling connects, but video stream stays on "Negotiating..." or fails.
  - *Remedy*: Disable Client Isolation in your router settings, use a dedicated presentation hotspot, or configure a TURN relay fallback.
- **Local Subnet Routability**:
  Presenter and viewer must be on the same subnet (or subnets with enabled inter-VLAN routing).
- **Desktop Host for Presenter**:
  Mobile OS browsers (iOS Safari, Android Chrome) do not expose screen capture APIs (`navigator.mediaDevices.getDisplayMedia`). Mobile devices can participate as viewers, but the presenter must use a desktop browser (macOS, Windows, or Linux).

---

## 3. Testing Across Different Networks (Internet NAT Traversal)

When presenter and viewers are on different networks (e.g. Presenter on Home Wi-Fi, Viewer on Cellular 4G/5G, or remote office workers):

### How it Works
1. Routers use Network Address Translation (NAT) to hide private IPs behind a single public IP.
2. WebRTC contacts the configured **STUN (Session Traversal Utilities for NAT)** servers (by default, Google's public STUN servers: `stun:stun.l.google.com:19302`).
3. STUN discovers the external public IP and port mapped by each router's NAT.
4. WebRTC attempts UDP hole punching. If both NATs are non-symmetric (Full Cone, Restricted Cone, or Port-Restricted Cone), a direct P2P link is established across the internet.
5. In the UI, the badge displays:
   ```
   [🔵 Direct P2P (STUN)  28ms]
   ```

---

## 4. Internet Fallback & Restrictive Firewalls (TURN Relay)

### Why STUN Alone Is Not Always Sufficient
In enterprise networks, universities (such as eduroam), and cellular mobile networks (T-Mobile, AT&T, Verizon), routers use **Symmetric NAT** or strict outbound firewalls:
- A Symmetric NAT maps a different external port for every unique remote IP/port.
- UDP hole punching fails because the port discovered by the STUN server is not the port used when communicating with the peer.
- Strict corporate firewalls may block all non-standard outbound UDP/TCP ports.

### The Role of TURN Relay
When direct P2P cannot be negotiated, WebRTC falls back to **TURN (Traversal Using Relays around NAT)**:
- Both peers establish a connection to an intermediate TURN relay server.
- The presenter streams video packets to the TURN server, which forwards them directly to viewers.
- In the UI, the badge displays:
   ```
   [🟠 Relay (TURN)  65ms]
   ```

### ⚠️ Internet Fallback Requirements
1. **Publicly Reachable Signaling Server**:
   The Socket.IO signaling server must be accessible over the internet with valid TLS certificates (`https://` + `wss://`).
2. **Accessible TURN Relay Service**:
   The TURN service must be reachable on public IP/ports:
   - **Standard TURN**: UDP & TCP port 3478.
   - **TURNS (Secure TLS)**: TCP port 443 (mimics HTTPS traffic to traverse deep packet inspection firewalls).

---

## 5. Configuring STUN and TURN in ShareHub

Configuration is managed via environment variables (in `.env.local` or production deployment environments):

### Environment Variables Reference
| Variable | Description | Example |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SIGNALING_URL` | Signaling server endpoint | `https://signaling.sharehub.io` |
| `NEXT_PUBLIC_STUN_SERVERS` | Comma-separated STUN server URLs | `stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302` |
| `NEXT_PUBLIC_TURN_URL` | Comma-separated TURN/TURNS URLs | `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp` |
| `NEXT_PUBLIC_TURN_USERNAME` | TURN authentication username | `sharehub_user` |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | TURN authentication password/secret | `secure_secret_token` |
| `NEXT_PUBLIC_ICE_TRANSPORT_POLICY` | ICE policy (`all` or `relay`) | `all` (default) or `relay` (forces TURN) |

### Option A: Self-Hosting coTURN on Linux / Cloud VM
You can deploy `coturn` on an Ubuntu VPS (e.g. AWS EC2, DigitalOcean, Hetzner, GCP):

```bash
# 1. Install coturn
sudo apt update && sudo apt install -y coturn

# 2. Configure /etc/turnserver.conf
sudo tee /etc/turnserver.conf > /dev/null <<EOF
listening-port=3478
tls-listening-port=443
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=your_super_secret_key_here
realm=turn.yourdomain.com
total-quota=100
bps-capacity=0
stale-nonce
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
no-stdout-log
log-file=/var/log/turnserver.log
EOF

# 3. Enable and start coturn service
sudo systemctl enable coturn
sudo systemctl restart coturn
```

### Option B: Cloud TURN Services (Zero Infrastructure)
For managed TURN infrastructure with worldwide points of presence:
- **Metered.ca**: Offers free 50GB/month TURN relays with automatic region selection.
- **Twilio Network Traversal**: Global low-latency TURN servers.
- **Cloudflare Calls / Xirsys**: WebRTC relay networks.

### Forcing Relay Mode for Verification
To test your TURN relay configuration and verify fallback behavior under simulated enterprise restrictions:
```bash
NEXT_PUBLIC_ICE_TRANSPORT_POLICY=relay
```
When set to `relay`, WebRTC deliberately ignores host and STUN candidates, forcing all media traffic through your TURN server.

---

## 6. Connectivity Troubleshooting Matrix

| Issue | Probable Cause | Diagnostic Indicator | Resolution |
| :--- | :--- | :--- | :--- |
| Cannot join room from phone | Signaling server bound to `localhost` | Status badge: "Reconnecting" | Change `NEXT_PUBLIC_SIGNALING_URL` to local LAN IP or public domain. |
| Stream hangs on "Negotiating..." on guest Wi-Fi | Router AP Client Isolation enabled | Badge: "Negotiating Route..." | Connect to non-isolated Wi-Fi, or configure TURN credentials in `.env`. |
| Connection works on same Wi-Fi, but fails on Cellular 5G | Symmetric NAT blocks direct P2P; no TURN configured | Badge: "Reconnecting... Click to Retry" | Add `NEXT_PUBLIC_TURN_URL`, `USERNAME`, and `CREDENTIAL` in `.env.local`. |
| Mobile device cannot share screen | Browser API constraint | "Screen capture is not supported by your current browser..." | Screen sharing requires desktop browser. Mobile devices can only view. |
| Temporary Wi-Fi disconnect | Transient packet loss | Badge shows reconnection spinner | ShareHub auto-triggers ICE restart. Click "Retry" button if needed. |
