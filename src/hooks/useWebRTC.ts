"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import {
  getRTCConfiguration,
  parseCandidatePairStats,
  isTurnConfigured,
  type ConnectionDiagnostics,
} from "../utils/webrtc-config";
import type { ParticipantRole } from "../types/signaling";

interface UseWebRTCProps {
  socketRef: React.RefObject<Socket | null>;
  socketId: string | null;
  roomId: string | null;
  isPresenter: boolean;
  presenterToken?: string | null;
  peers: Array<{ peerId: string; role: ParticipantRole }>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isSignalingSharing: boolean;
}

/**
 * Safely add an ICE candidate to RTCPeerConnection.
 * Handles end-of-candidates, empty candidate strings, and type checks.
 */
async function safelyAddIceCandidate(
  pc: RTCPeerConnection,
  candidateInit: RTCIceCandidateInit
): Promise<boolean> {
  if (!pc.remoteDescription || !pc.remoteDescription.type) {
    return false;
  }
  try {
    // If candidate string is empty or falsy, it's an end-of-candidates indicator.
    if (!candidateInit || !candidateInit.candidate || candidateInit.candidate.trim() === "") {
      await pc.addIceCandidate(candidateInit);
      return true;
    }
    // Attempt standard instantiation, fallback to raw init dict
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch {
      await pc.addIceCandidate(candidateInit);
    }
    return true;
  } catch (err) {
    // Non-fatal warning: candidate may have arrived late or been redundant
    console.warn("safelyAddIceCandidate warning:", err);
    return false;
  }
}

/**
 * Safely triggers playback on video element with autoplay error recovery.
 */
function attemptPlayVideo(video: HTMLVideoElement) {
  video.play().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      // Browser blocked unmuted autoplay; mute and retry
      video.muted = true;
      video.play().catch(() => {});
    }
  });
}

export function useWebRTC({
  socketRef,
  socketId,
  roomId,
  isPresenter,
  presenterToken = null,
  peers,
  videoRef,
  isSignalingSharing,
}: UseWebRTCProps) {
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [connectionStates, setConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [iceConnectionStates, setIceConnectionStates] = useState<Record<string, RTCIceConnectionState>>({});
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceCandidateQueuesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Derived state: true when viewer and stream is live
  const hasRemoteStream = !isPresenter && isSignalingSharing;

  const clearError = useCallback(() => setSharingError(null), []);

  /**
   * Helper to clean up a specific peer connection
   */
  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onconnectionstatechange = null;
      try {
        pc.getTransceivers().forEach((transceiver) => {
          try {
            transceiver.stop();
          } catch {
            // Transceiver stop ignored
          }
        });
      } catch {
        // Transceivers access ignored
      }
      try {
        pc.close();
      } catch {
        // Close error ignored
      }
      peerConnectionsRef.current.delete(peerId);
    }
    iceCandidateQueuesRef.current.delete(peerId);
    setConnectionStates((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setIceConnectionStates((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  /**
   * Stops all active media tracks and resets stream references
   */
  const stopScreenShare = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Track stop ignored
        }
      });
      localStreamRef.current = null;
    }

    if (isPresenter && videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsSharingScreen(false);
    setDiagnostics(null);

    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit("screen-share-status", {
        isSharing: false,
        presenterToken: presenterToken || undefined,
      });
    }

    // Close viewer peer connections on presenter stop
    if (isPresenter) {
      const peerIds = Array.from(peerConnectionsRef.current.keys());
      for (const peerId of peerIds) {
        closePeerConnection(peerId);
      }
    }
  }, [isPresenter, presenterToken, socketRef, videoRef, closePeerConnection]);

  /**
   * Re-initiates ICE connection negotiation on demand or after a failure
   */
  const restartConnection = useCallback(
    async (targetPeerId?: string) => {
      const peersToRestart = targetPeerId
        ? [targetPeerId]
        : Array.from(peerConnectionsRef.current.keys());

      for (const peerId of peersToRestart) {
        const pc = peerConnectionsRef.current.get(peerId);
        if (!pc) continue;

        if (isPresenter && pc.restartIce) {
          try {
            pc.restartIce();
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            const socket = socketRef.current;
            if (socket && socket.connected) {
              socket.emit("signal-offer", {
                targetSocketId: peerId,
                offer,
              });
            }
          } catch (err) {
            console.error(`Failed to restart ICE with peer ${peerId}:`, err);
          }
        }
      }
    },
    [isPresenter, socketRef]
  );

  /**
   * Creates or retrieves a peer connection for a given peer
   */
  const getOrCreatePeerConnection = useCallback(
    (targetPeerId: string, isInitiator: boolean): RTCPeerConnection => {
      let pc = peerConnectionsRef.current.get(targetPeerId);
      if (pc) {
        if (
          pc.connectionState === "closed" ||
          pc.connectionState === "failed" ||
          pc.iceConnectionState === "closed" ||
          pc.iceConnectionState === "failed"
        ) {
          closePeerConnection(targetPeerId);
          pc = undefined;
        } else {
          return pc;
        }
      }

      const rtcConfig = getRTCConfiguration();
      pc = new RTCPeerConnection(rtcConfig);
      peerConnectionsRef.current.set(targetPeerId, pc);

      if (!iceCandidateQueuesRef.current.has(targetPeerId)) {
        iceCandidateQueuesRef.current.set(targetPeerId, []);
      }

      // Add local tracks if presenter
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          if (localStreamRef.current) {
            pc?.addTrack(track, localStreamRef.current);
          }
        });
      }

      pc.onicecandidate = (event) => {
        const socket = socketRef.current;
        if (event.candidate && socket && socket.connected) {
          socket.emit("signal-ice-candidate", {
            targetSocketId: targetPeerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc?.connectionState ?? "closed";
        setConnectionStates((prev) => ({
          ...prev,
          [targetPeerId]: state,
        }));
      };

      pc.oniceconnectionstatechange = () => {
        const iceState = pc?.iceConnectionState ?? "closed";
        setIceConnectionStates((prev) => ({
          ...prev,
          [targetPeerId]: iceState,
        }));

        if (iceState === "failed" && isInitiator) {
          // Automatic ICE restart trigger
          restartConnection(targetPeerId);
        }
      };

      // Robust track assignment with fallback for headless/unified plan streams
      pc.ontrack = (event) => {
        let stream: MediaStream;
        if (event.streams && event.streams[0]) {
          stream = event.streams[0];
        } else if (remoteStreamRef.current) {
          if (!remoteStreamRef.current.getTracks().some((t) => t.id === event.track.id)) {
            remoteStreamRef.current.addTrack(event.track);
          }
          stream = remoteStreamRef.current;
        } else {
          stream = new MediaStream([event.track]);
        }

        remoteStreamRef.current = stream;

        // Clean up video when track ends
        event.track.onended = () => {
          if (remoteStreamRef.current) {
            const hasActiveVideo = remoteStreamRef.current
              .getVideoTracks()
              .some((t) => t.readyState === "live");
            if (!hasActiveVideo && videoRef.current) {
              videoRef.current.srcObject = null;
            }
          }
        };

        if (videoRef.current) {
          if (videoRef.current.srcObject !== stream) {
            videoRef.current.srcObject = stream;
          }
          attemptPlayVideo(videoRef.current);
        }
      };

      return pc;
    },
    [socketRef, videoRef, restartConnection, closePeerConnection]
  );

  /**
   * Prompts the browser for screen capture and starts broadcasting to peers
   */
  const startScreenShare = useCallback(async () => {
    setSharingError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== "function"
    ) {
      const err =
        "Screen capture is not supported by your current browser or mobile platform. To share your screen, open this room on Chrome, Edge, Safari, or Firefox on a desktop computer.";
      setSharingError(err);
      return;
    }

    try {
      // Prompt user for display media
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });

      localStreamRef.current = stream;
      setIsSharingScreen(true);

      // Render local preview on video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        attemptPlayVideo(videoRef.current);
      }

      // Listen for browser's native "Stop Sharing" floating bar event
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      // Notify signaling server
      const socket = socketRef.current;
      if (socket && socket.connected) {
        socket.emit("screen-share-status", {
          isSharing: true,
          presenterToken: presenterToken || undefined,
        });
      }

      // Establish connections with currently present peers
      for (const peer of peers) {
        if (peer.peerId !== socketId) {
          const pc = getOrCreatePeerConnection(peer.peerId, true);

          // Add video tracks
          stream.getTracks().forEach((track) => {
            const senders = pc.getSenders();
            const alreadyAdded = senders.some((s) => s.track?.id === track.id);
            if (!alreadyAdded) {
              pc.addTrack(track, stream);
            }
          });

          // Create WebRTC Offer
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            if (socket && socket.connected) {
              socket.emit("signal-offer", {
                targetSocketId: peer.peerId,
                offer,
              });
            }
          } catch (err) {
            console.error(`Failed to initiate offer to peer ${peer.peerId}:`, err);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        // User cancelled the browser screen selection dialog
        setSharingError("Screen capture permission was denied or cancelled.");
      } else {
        const msg = err instanceof Error ? err.message : "Failed to capture screen.";
        setSharingError(`Screen share error: ${msg}`);
      }
      setIsSharingScreen(false);
    }
  }, [peers, presenterToken, socketRef, socketId, videoRef, getOrCreatePeerConnection, stopScreenShare]);

  /**
   * Handle WebRTC signaling messages from server
   */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    // 1. Handle incoming WebRTC offer (Viewer receiving from Presenter)
    const handleOffer = async (payload: {
      fromPeerId: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      try {
        let pc = getOrCreatePeerConnection(payload.fromPeerId, false);

        // Handle glare or non-stable state from previous negotiation
        if (pc.signalingState !== "stable") {
          console.warn(
            `PeerConnection with ${payload.fromPeerId} in non-stable state "${pc.signalingState}", resetting.`
          );
          try {
            await pc.setRemoteDescription({ type: "rollback" });
          } catch {
            closePeerConnection(payload.fromPeerId);
            pc = getOrCreatePeerConnection(payload.fromPeerId, false);
          }
        }

        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));

        // Flush any queued ICE candidates
        const queue = iceCandidateQueuesRef.current.get(payload.fromPeerId) || [];
        for (const candidate of queue) {
          await safelyAddIceCandidate(pc, candidate);
        }
        iceCandidateQueuesRef.current.set(payload.fromPeerId, []);

        // Create WebRTC Answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("signal-answer", {
          targetSocketId: payload.fromPeerId,
          answer,
        });
      } catch (err) {
        console.error("Failed to process WebRTC offer:", err);
      }
    };

    // 2. Handle incoming WebRTC answer (Presenter receiving from Viewer)
    const handleAnswer = async (payload: {
      fromPeerId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      try {
        const pc = peerConnectionsRef.current.get(payload.fromPeerId);
        if (pc) {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));

            // Flush any queued ICE candidates
            const queue = iceCandidateQueuesRef.current.get(payload.fromPeerId) || [];
            for (const candidate of queue) {
              await safelyAddIceCandidate(pc, candidate);
            }
            iceCandidateQueuesRef.current.set(payload.fromPeerId, []);
          } else {
            console.warn(
              `Ignoring answer from ${payload.fromPeerId} in unexpected signalingState: ${pc.signalingState}`
            );
          }
        }
      } catch (err) {
        console.error("Failed to process WebRTC answer:", err);
      }
    };

    // 3. Handle trickle ICE Candidate
    const handleIceCandidate = async (payload: {
      fromPeerId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const pc = peerConnectionsRef.current.get(payload.fromPeerId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await safelyAddIceCandidate(pc, payload.candidate);
      } else {
        // Buffer candidate until remote description is set
        const queue = iceCandidateQueuesRef.current.get(payload.fromPeerId) || [];
        queue.push(payload.candidate);
        iceCandidateQueuesRef.current.set(payload.fromPeerId, queue);
      }
    };

    // 4. When a new peer joins while presenter is already streaming
    const handlePeerJoined = async (payload: { peerId: string }) => {
      if (isPresenter && localStreamRef.current) {
        const stream = localStreamRef.current;
        const pc = getOrCreatePeerConnection(payload.peerId, true);

        stream.getTracks().forEach((track) => {
          const senders = pc.getSenders();
          const alreadyAdded = senders.some((s) => s.track?.id === track.id);
          if (!alreadyAdded) {
            pc.addTrack(track, stream);
          }
        });

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socket.emit("signal-offer", {
            targetSocketId: payload.peerId,
            offer,
          });
        } catch (err) {
          console.error("Failed to send offer to new peer:", err);
        }
      }
    };

    // 5. When a peer leaves
    const handlePeerLeft = (payload: { peerId: string }) => {
      closePeerConnection(payload.peerId);
    };

    socket.on("signal-offer", handleOffer);
    socket.on("signal-answer", handleAnswer);
    socket.on("signal-ice-candidate", handleIceCandidate);
    socket.on("peer-joined", handlePeerJoined);
    socket.on("peer-left", handlePeerLeft);

    return () => {
      socket.off("signal-offer", handleOffer);
      socket.off("signal-answer", handleAnswer);
      socket.off("signal-ice-candidate", handleIceCandidate);
      socket.off("peer-joined", handlePeerJoined);
      socket.off("peer-left", handlePeerLeft);
    };
  }, [socketRef, isPresenter, getOrCreatePeerConnection, closePeerConnection]);

  // Periodic network diagnostics & candidate pair inspection
  useEffect(() => {
    if (!isSharingScreen && !hasRemoteStream) {
      return;
    }

    const interval = setInterval(async () => {
      // Find connected peer connection
      for (const pc of peerConnectionsRef.current.values()) {
        if (
          pc.connectionState === "connected" ||
          pc.iceConnectionState === "connected" ||
          pc.iceConnectionState === "completed"
        ) {
          try {
            const stats = await pc.getStats();
            const diag = parseCandidatePairStats(stats);
            setDiagnostics(diag);
            return;
          } catch {
            // Stats fetch ignored
          }
        }
      }

      if (peerConnectionsRef.current.size > 0) {
        setDiagnostics((prev) => prev ?? {
          transportType: "connecting",
          localCandidateType: null,
          remoteCandidateType: null,
          rttMs: null,
          turnConfigured: isTurnConfigured(),
        });
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isSharingScreen, hasRemoteStream]);

  // Re-bind remote stream if video element mounts after ontrack fired
  useEffect(() => {
    if (!isPresenter && isSignalingSharing && remoteStreamRef.current && videoRef.current) {
      if (videoRef.current.srcObject !== remoteStreamRef.current) {
        videoRef.current.srcObject = remoteStreamRef.current;
      }
      attemptPlayVideo(videoRef.current);
    }
  }, [isPresenter, isSignalingSharing, videoRef]);

  // Handle stream reset and teardown stale peer connections when signaling marks isSharing as false (viewer side)
  useEffect(() => {
    if (!isPresenter && !isSignalingSharing) {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // Track stop ignored
          }
        });
        remoteStreamRef.current = null;
      }
      // Teardown all viewer peer connections so next stream starts clean
      const peerIds = Array.from(peerConnectionsRef.current.keys());
      for (const peerId of peerIds) {
        closePeerConnection(peerId);
      }
      setDiagnostics(null);
    }
  }, [isPresenter, isSignalingSharing, videoRef, closePeerConnection]);

  // Teardown when leaving room or unmounting
  useEffect(() => {
    const peerConnections = peerConnectionsRef.current;
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      for (const peerId of Array.from(peerConnections.keys())) {
        closePeerConnection(peerId);
      }
    };
  }, [roomId, closePeerConnection]);

  // Only expose diagnostics when stream is active
  const activeDiagnostics = isSharingScreen || hasRemoteStream ? diagnostics : null;

  return {
    isSharingScreen,
    sharingError,
    hasRemoteStream,
    connectionStates,
    iceConnectionStates,
    diagnostics: activeDiagnostics,
    startScreenShare,
    stopScreenShare,
    restartConnection,
    clearError,
  };
}
