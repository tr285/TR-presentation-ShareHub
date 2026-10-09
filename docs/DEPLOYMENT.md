# TR Presentation ShareHub — Production Deployment Runbook

This guide details the complete production architecture, deployment topologies, HTTPS/WSS SSL configuration, TURN relay provisioning, structured logging, and health monitoring for **TR Presentation ShareHub**.

---

## 1. Architecture: Decoupled Deployments

TR Presentation ShareHub is architected into two decoupled components:

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

1. **Frontend Service (Next.js)**:
   - Stateless web application serving the user interface, QR code generation, and client WebRTC orchestrator.
   - Can scale horizontally behind any HTTP load balancer or serverless platform (Vercel, AWS Amplify, Cloudflare Pages).
2. **Signaling Service (Node.js + Socket.IO)**:
   - Stateful in-memory room manager maintaining active rooms, participants, rate limiting, and SDP/ICE routing.
   - Requires persistent WebSocket (`wss://`) connectivity with sticky sessions or single-instance routing.
3. **Media Transport (WebRTC + STUN/TURN)**:
   - Video streams travel peer-to-peer over UDP directly between participants.
   - Falls back to TURN relay server only when symmetric NATs or enterprise firewalls prevent direct P2P connectivity.

---

## 2. Environment Variables Matrix

### Frontend Application (.env.production / Vercel Environment)
| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `NEXT_PUBLIC_SIGNALING_URL` | **Yes** | `http://localhost:3001` | Public HTTPS/WSS URL of your signaling server (e.g. `https://signaling.yourdomain.com`). |
| `NEXT_PUBLIC_STUN_SERVERS` | No | Google STUN | Comma-separated custom STUN servers (e.g. `stun:stun.yourdomain.com:3478`). |
| `NEXT_PUBLIC_TURN_URL` | No | None | Comma-separated TURN server URLs (e.g. `turn:turn.yourdomain.com:3478?transport=udp,turns:turn.yourdomain.com:443?transport=tcp`). |
| `NEXT_PUBLIC_TURN_USERNAME` | Conditional | None | Username for TURN authentication (required if `TURN_URL` is set). |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | Conditional | None | Password/token for TURN authentication. |
| `NEXT_PUBLIC_ICE_TRANSPORT_POLICY` | No | `all` | Set to `relay` to force all traffic through TURN servers for compliance testing. |

### Signaling Server (.env / Container Environment)
| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PORT` or `SIGNALING_PORT` | No | `3001` | TCP port the HTTP and Socket.IO server listens on. |
| `SIGNALING_HOST` | No | `0.0.0.0` | Bind address (`0.0.0.0` for all interfaces, `127.0.0.1` for local-only reverse proxy). |
| `CORS_ORIGIN` | **Yes in Prod** | Localhost | Comma-separated list of allowed frontend origins (e.g. `https://sharehub.yourdomain.com`). |
| `RATE_LIMIT_MSGS_PER_10S` | No | `120` | Max socket signaling messages allowed per 10-second sliding window per client. |
| `RATE_LIMIT_CREATES_PER_MIN` | No | `10` | Max rooms a single IP address can create per minute. |
| `LOG_LEVEL` | No | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`). |
| `LOG_FORMAT` | No | `json` in prod | Output format: `json` (single-line JSON for log aggregators) or `pretty`. |

---

## 3. Mandatory HTTPS and WSS Security Requirements

> [!IMPORTANT]
> Modern web browsers restrict `navigator.mediaDevices.getDisplayMedia` and WebRTC APIs strictly to **Secure Contexts** (`https://` or `localhost`).
> If deployed over unencrypted HTTP, browsers will block screen capture and WebRTC connections immediately.

### SSL / WSS Requirements:
1. **Frontend**: Must be served over `https://` with a valid SSL/TLS certificate.
2. **Signaling Server**: Must be accessible over `https://` (HTTP fallback polling) and `wss://` (WebSockets).
3. **Reverse Proxy WebSocket Upgrading**:
   Your reverse proxy (Nginx, Caddy, Cloudflare, Traefik, AWS ALB) must forward the HTTP `Upgrade` header:
   ```nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

---

## 4. Deployment Topology A: Docker Compose (All-in-One)

The fastest self-contained deployment using the provided [`docker-compose.yml`](file:///Users/tukaramgore/Documents/TR%20presentation%20tool/docker-compose.yml):

```bash
# 1. Clone repository
git clone https://github.com/your-org/tr-presentation-sharehub.git
cd tr-presentation-sharehub

# 2. Configure environment
cp .env.example .env.production
# Edit .env.production with your domain names and CORS origins

# 3. Build and launch container stack
docker compose -f docker-compose.yml up -d --build

# 4. Verify running health
docker compose ps
curl http://127.0.0.1:3001/health
```

---

## 5. Deployment Topology B: Cloud Decoupled (Vercel + Railway / Fly.io)

### Step 1: Deploy Signaling Server (Fly.io or Railway)
Because signaling uses stateful WebSockets, deploy it to a container platform that supports WebSockets:

**Deploying to Fly.io:**
```bash
fly launch --dockerfile Dockerfile.signaling
fly secrets set CORS_ORIGIN="https://sharehub.yourdomain.com"
fly deploy
```

### Step 2: Deploy Frontend Application (Vercel)
1. Import repository into Vercel.
2. Set Environment Variables in Vercel Dashboard:
   - `NEXT_PUBLIC_SIGNALING_URL`: `https://your-signaling-app.fly.dev`
   - `NEXT_PUBLIC_STUN_SERVERS`: `stun:stun.l.google.com:19302`
3. Deploy. Vercel automatically builds and deploys the Next.js App Router bundle to global edge CDNs.

---

## 6. Deployment Topology C: Ubuntu VPS with Nginx, PM2, and Certbot

For production hosting on Ubuntu 22.04 / 24.04 (DigitalOcean, AWS EC2, Hetzner, Linode):

### 1. Install Node.js 20+ and PM2
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx

# Install PM2 process manager
sudo npm install -g pm2
```

### 2. Deploy Code and Build
```bash
git clone https://github.com/your-org/tr-presentation-sharehub.git /var/www/sharehub
cd /var/www/sharehub
npm ci
npm run build
```

### 3. Start Services with PM2
```bash
# Start signaling and frontend services using ecosystem configuration
pm2 start ecosystem.config.cjs --env production

# Save process list and enable on system boot
pm2 save
pm2 startup
```

### 4. Configure Nginx Reverse Proxy
```bash
# Copy provided Nginx configuration
sudo cp deploy/nginx/sharehub.conf /etc/nginx/sites-available/sharehub.conf
sudo ln -s /etc/nginx/sites-available/sharehub.conf /etc/nginx/sites-enabled/

# Replace domain names in configuration
sudo sed -i 's/sharehub.example.com/your-frontend-domain.com/g' /etc/nginx/sites-available/sharehub.conf
sudo sed -i 's/signaling.example.com/your-signaling-domain.com/g' /etc/nginx/sites-available/sharehub.conf

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Obtain Let's Encrypt SSL Certificates
```bash
sudo certbot --nginx -d your-frontend-domain.com -d your-signaling-domain.com
```

---

## 7. Production coTURN Server Deployment

When crossing symmetric NATs or restrictive enterprise firewalls, self-host `coturn`:

```bash
# 1. Install coturn
sudo apt update && sudo apt install -y coturn

# 2. Copy production configuration
sudo cp deploy/turn/turnserver.conf /etc/turnserver.conf

# 3. Generate a strong 64-character secret
openssl rand -hex 32
# Paste the generated secret into static-auth-secret in /etc/turnserver.conf

# 4. Open required firewall ports
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 443/tcp
sudo ufw allow 49152:65535/udp

# 5. Enable and start service
sudo systemctl enable coturn
sudo systemctl restart coturn
```

---

## 8. Logging & Health Monitoring

### Health Monitoring Endpoint
The signaling server exposes a lightweight health check at `GET /health`:
```bash
curl -s http://localhost:3001/health | jq .
```

**Response Payload:**
```json
{
  "status": "ok",
  "uptimeSeconds": 14205,
  "timestamp": "2026-10-10T01:20:00.000Z",
  "activeRooms": 3,
  "activeSockets": 8,
  "version": "1.0.0",
  "memoryMb": {
    "rss": 54,
    "heapTotal": 28,
    "heapUsed": 19
  }
}
```

### Monitoring Integration (Prometheus / Uptime Kuma / Datadog)
- Configure an HTTP monitor targeting `https://signaling.yourdomain.com/health`.
- Expect HTTP Status `200` and JSON field `.status == "ok"`.
- Alert if response time exceeds `2000ms` or memory `rss` exceeds `450MB`.

### Structured Production Logs
In production (`NODE_ENV=production` or `LOG_FORMAT=json`), all events are emitted as single-line JSON strings to stdout/stderr:
```json
{"timestamp":"2026-10-10T01:20:00.123Z","level":"info","message":"TR Presentation ShareHub Signaling Server started","context":{"port":3001,"host":"0.0.0.0","nodeEnv":"production"}}
```
Compatible out of the box with Datadog, AWS CloudWatch, Logstash/ELK, and Grafana Loki.
