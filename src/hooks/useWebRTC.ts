"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { getRTCConfiguration } from "../utils/webrtc-config";
import type { ParticipantRole } from "../types/signaling";

interface UseWebRTCProps {
  socketRef: React.RefObject<Socket | null>;
  socketId: string | null;
  roomId: string | null;
  isPresenter: boolean;
  peers: Array<{ peerId: string; role: ParticipantRole }>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isSignalingSharing: boolean;
}

export function useWebRTC({
  socketRef,
  socketId,
  roomId,
  isPresenter,
  peers,
  videoRef,
  isSignalingSharing,
}: UseWebRTCProps) {
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [connectionStates, setConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});

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
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    iceCandidateQueuesRef.current.delete(peerId);
    setConnectionStates((prev) => {
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

    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit("screen-share-status", { isSharing: false });
    }

    // Close viewer peer connections on presenter stop
    if (isPresenter) {
      for (const peerId of peerConnectionsRef.current.keys()) {
        closePeerConnection(peerId);
      }
    }
  }, [isPresenter, socketRef, videoRef, closePeerConnection]);

  /**
   * Creates or retrieves a peer connection for a given peer
   */
  const getOrCreatePeerConnection = useCallback(
    (targetPeerId: string, isInitiator: boolean): RTCPeerConnection => {
      let pc = peerConnectionsRef.current.get(targetPeerId);
      if (pc) return pc;

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

        if (state === "failed") {
          // Attempt ICE restart if initiator
          if (isInitiator && pc?.restartIce) {
            try {
              pc.restartIce();
            } catch {
              // Ignore restart error
            }
          }
        }
      };

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          const stream = event.streams[0];
          remoteStreamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        }
      };

      return pc;
    },
    [socketRef, videoRef]
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
        socket.emit("screen-share-status", { isSharing: true });
      }

      // Initiate WebRTC offer to all existing peers in the room
      for (const peer of peers) {
        if (peer.peerId !== socketId) {
          try {
            const pc = getOrCreatePeerConnection(peer.peerId, true);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            if (socket && socket.connected) {
              socket.emit("signal-offer", {
                targetSocketId: peer.peerId,
                offer: {
                  type: "offer",
                  sdp: pc.localDescription?.sdp || offer.sdp || "",
                },
              });
            }
          } catch (err: unknown) {
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
  }, [peers, socketRef, socketId, videoRef, getOrCreatePeerConnection, stopScreenShare]);

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
        const pc = getOrCreatePeerConnection(payload.fromPeerId, false);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));

        // Flush buffered ICE candidates
        const queue = iceCandidateQueuesRef.current.get(payload.fromPeerId) || [];
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        iceCandidateQueuesRef.current.set(payload.fromPeerId, []);

        // Create answer and return to presenter
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("signal-answer", {
          targetSocketId: payload.fromPeerId,
          answer: {
            type: "answer",
            sdp: pc.localDescription?.sdp || answer.sdp || "",
          },
        });
      } catch (err) {
        console.error("Error processing offer:", err);
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
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));

          // Flush buffered ICE candidates
          const queue = iceCandidateQueuesRef.current.get(payload.fromPeerId) || [];
          for (const candidate of queue) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          iceCandidateQueuesRef.current.set(payload.fromPeerId, []);
        }
      } catch (err) {
        console.error("Error processing answer:", err);
      }
    };

    // 3. Handle incoming trickle ICE candidate
    const handleIceCandidate = async (payload: {
      fromPeerId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      try {
        const pc = peerConnectionsRef.current.get(payload.fromPeerId);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          // Queue candidate until remote description is set
          const queue = iceCandidateQueuesRef.current.get(payload.fromPeerId) || [];
          queue.push(payload.candidate);
          iceCandidateQueuesRef.current.set(payload.fromPeerId, queue);
        }
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    };

    // 4. When a new peer joins while presenter is sharing
    const handlePeerJoined = async (payload: { peerId: string; role: ParticipantRole }) => {
      if (isPresenter && localStreamRef.current) {
        try {
          const pc = getOrCreatePeerConnection(payload.peerId, true);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socket.emit("signal-offer", {
            targetSocketId: payload.peerId,
            offer: {
              type: "offer",
              sdp: pc.localDescription?.sdp || offer.sdp || "",
            },
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

  // Handle stream reset when signaling marks isSharing as false (viewer side)
  useEffect(() => {
    if (!isPresenter && !isSignalingSharing) {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  }, [isPresenter, isSignalingSharing, videoRef]);

  // Teardown when leaving room or unmounting
  useEffect(() => {
    const peerConnections = peerConnectionsRef.current;
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      for (const peerId of peerConnections.keys()) {
        closePeerConnection(peerId);
      }
    };
  }, [roomId, closePeerConnection]);

  return {
    isSharingScreen,
    sharingError,
    hasRemoteStream,
    connectionStates,
    startScreenShare,
    stopScreenShare,
    clearError,
  };
}
