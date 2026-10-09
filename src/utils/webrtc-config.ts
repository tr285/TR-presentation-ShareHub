/**
 * WebRTC configuration and network diagnostics utilities for TR Presentation ShareHub.
 */

export type NetworkTransportType =
  | "local-lan" // Direct connection on the same local network/Wi-Fi (host candidate)
  | "direct-p2p" // Direct P2P across NAT via STUN server (srflx/prflx candidate)
  | "turn-relay" // Relayed via TURN server (relay candidate)
  | "connecting" // Connection is being established or gathered
  | "unknown"; // Statistics not yet available

export interface ConnectionDiagnostics {
  transportType: NetworkTransportType;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  localProtocol?: string | null;
  rttMs: number | null;
  bytesReceived?: number;
  bytesSent?: number;
  turnConfigured: boolean;
}

/**
 * Checks whether TURN relay server credentials are configured in the environment
 */
export function isTurnConfigured(): boolean {
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  return Boolean(
    turnUrl &&
      turnUrl.trim().length > 0 &&
      turnUsername &&
      turnUsername.trim().length > 0 &&
      turnCredential &&
      turnCredential.trim().length > 0
  );
}

/**
 * Builds the RTCConfiguration object with default STUN, custom STUN, and optional TURN
 */
export function getRTCConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
      ],
    },
  ];

  // Optional custom STUN servers from env (comma-separated)
  const customStun = process.env.NEXT_PUBLIC_STUN_SERVERS;
  if (customStun) {
    const urls = customStun
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length > 0) {
      iceServers.push({ urls });
    }
  }

  // Optional TURN servers from env
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  // Optional iceTransportPolicy ('all' | 'relay')
  const rawPolicy = process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY?.toLowerCase();
  const iceTransportPolicy: RTCIceTransportPolicy =
    rawPolicy === "relay" ? "relay" : "all";

  return {
    iceServers,
    iceTransportPolicy,
    iceCandidatePoolSize: 2,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}

/**
 * Inspects WebRTC stats to determine active candidate pair and network route
 */
export function parseCandidatePairStats(
  stats: RTCStatsReport | null
): ConnectionDiagnostics {
  const baseResult: ConnectionDiagnostics = {
    transportType: "unknown",
    localCandidateType: null,
    remoteCandidateType: null,
    localProtocol: null,
    rttMs: null,
    bytesReceived: 0,
    bytesSent: 0,
    turnConfigured: isTurnConfigured(),
  };

  if (!stats) return baseResult;

  interface CandidatePairReport {
    type: string;
    state?: string;
    selected?: boolean;
    nominated?: boolean;
    localCandidateId?: string;
    remoteCandidateId?: string;
    currentRoundTripTime?: number;
    roundTripTime?: number;
    protocol?: string;
    bytesReceived?: number;
    bytesSent?: number;
  }

  interface CandidateReport {
    candidateType?: string;
    protocol?: string;
  }

  let activeCandidatePair: CandidatePairReport | null = null;

  for (const report of stats.values()) {
    const r = report as CandidatePairReport;
    if (
      r.type === "candidate-pair" &&
      (r.selected === true || r.nominated === true || r.state === "succeeded")
    ) {
      activeCandidatePair = r;
      if (r.selected) break;
    }
  }

  if (!activeCandidatePair) {
    return baseResult;
  }

  const localCandidate = (
    activeCandidatePair.localCandidateId
      ? stats.get(activeCandidatePair.localCandidateId)
      : null
  ) as CandidateReport | null;

  const remoteCandidate = (
    activeCandidatePair.remoteCandidateId
      ? stats.get(activeCandidatePair.remoteCandidateId)
      : null
  ) as CandidateReport | null;

  const localType = localCandidate?.candidateType || null;
  const remoteType = remoteCandidate?.candidateType || null;
  const protocol = localCandidate?.protocol || activeCandidatePair.protocol || null;

  let rttMs: number | null = null;
  if (typeof activeCandidatePair.currentRoundTripTime === "number") {
    rttMs = Math.round(activeCandidatePair.currentRoundTripTime * 1000);
  } else if (typeof activeCandidatePair.roundTripTime === "number") {
    rttMs = Math.round(activeCandidatePair.roundTripTime * 1000);
  }

  // Determine transport classification
  let transportType: NetworkTransportType = "unknown";
  if (localType === "relay" || remoteType === "relay") {
    transportType = "turn-relay";
  } else if (localType === "host" && remoteType === "host") {
    transportType = "local-lan";
  } else if (localType || remoteType) {
    transportType = "direct-p2p";
  }

  return {
    transportType,
    localCandidateType: localType,
    remoteCandidateType: remoteType,
    localProtocol: protocol,
    rttMs,
    bytesReceived: activeCandidatePair.bytesReceived ?? 0,
    bytesSent: activeCandidatePair.bytesSent ?? 0,
    turnConfigured: isTurnConfigured(),
  };
}
