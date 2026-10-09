export type ParticipantRole = "presenter" | "viewer";

export interface ParticipantInfo {
  socketId: string;
  role: ParticipantRole;
  joinedAt: number;
}

export interface RoomState {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  presenterSocketId: string | null;
  isSharing: boolean;
  maxParticipants: number;
  participants: Map<string, ParticipantInfo>;
}

export interface SerializedRoomState {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  presenterSocketId: string | null;
  isSharing: boolean;
  maxParticipants: number;
  participantCount: number;
}

export interface BaseResponse {
  success: boolean;
  error?: string;
  code?: string;
}

export interface CreateRoomResponse extends BaseResponse {
  roomId?: string;
  role?: ParticipantRole;
  expiresAt?: number;
}

export interface JoinRoomResponse extends BaseResponse {
  roomId?: string;
  role?: ParticipantRole;
  presenterSocketId?: string | null;
  isSharing?: boolean;
  peers?: Array<{ peerId: string; role: ParticipantRole }>;
  expiresAt?: number;
}

export interface SignalOfferPayload {
  targetSocketId: string;
  offer: {
    type: "offer";
    sdp: string;
  };
}

export interface SignalAnswerPayload {
  targetSocketId: string;
  answer: {
    type: "answer";
    sdp: string;
  };
}

export interface SignalIceCandidatePayload {
  targetSocketId: string;
  candidate: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  };
}

export interface SignalingError {
  code:
    | "ROOM_NOT_FOUND"
    | "ROOM_EXPIRED"
    | "ROOM_FULL"
    | "INVALID_PAYLOAD"
    | "ALREADY_IN_ROOM"
    | "NOT_IN_ROOM"
    | "PEER_NOT_FOUND"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR";
  message: string;
}

export interface HealthCheckResponse {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  timestamp: string;
  activeRooms: number;
  activeSockets: number;
  version: string;
}
