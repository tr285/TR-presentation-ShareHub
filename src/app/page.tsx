"use client";

import React, { Suspense, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useSignaling } from "../hooks/useSignaling";
import { useWebRTC } from "../hooks/useWebRTC";
import { Header } from "../components/Header";
import { CreateRoomCard } from "../components/CreateRoomCard";
import { JoinRoomCard } from "../components/JoinRoomCard";
import { RoomView } from "../components/RoomView";

function ShareHubContent() {
  const searchParams = useSearchParams();
  const initialRoomQuery = searchParams.get("room") || "";
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const {
    connectionStatus,
    socketId,
    socketRef,
    roomSession,
    error,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
  } = useSignaling();

  const isPresenter: boolean =
    roomSession.role === "presenter" ||
    Boolean(socketId && roomSession.presenterSocketId === socketId);

  const {
    isSharingScreen,
    sharingError,
    diagnostics,
    iceConnectionStates,
    startScreenShare,
    stopScreenShare,
    restartConnection,
  } = useWebRTC({
    socketRef,
    socketId,
    roomId: roomSession.roomId,
    isPresenter,
    presenterToken: roomSession.presenterToken,
    peers: roomSession.peers,
    videoRef,
    isSignalingSharing: roomSession.isSharing,
  });

  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const handleCreateRoom = async (options: {
    maxParticipants: number;
    passcode?: string;
  }) => {
    setIsCreating(true);
    try {
      await createRoom(options);
    } catch {
      // Error handled by useSignaling
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (roomId: string, passcode?: string) => {
    setIsJoining(true);
    try {
      await joinRoom(roomId, "viewer", passcode);
    } catch {
      // Error handled by useSignaling
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Navigation Header */}
      <Header connectionStatus={connectionStatus} socketId={socketId} />

      {/* Main Container */}
      <main className="flex-1 flex flex-col">
        {/* Error notification banner */}
        {error && (
          <div className="bg-rose-950/80 border-b border-rose-800 text-rose-200 px-4 py-3 text-xs sm:text-sm flex items-center justify-between animate-in fade-in">
            <div className="max-w-7xl mx-auto flex items-center gap-2">
              <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error}</span>
            </div>
            <button
              onClick={clearError}
              className="text-rose-400 hover:text-white p-1 rounded-md transition-colors"
              aria-label="Dismiss Error"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Conditional View: Inside Room vs Landing Dashboard */}
        {roomSession.roomId ? (
          <RoomView
            roomSession={roomSession}
            socketId={socketId}
            onLeaveRoom={() => {
              stopScreenShare();
              leaveRoom();
            }}
            onStartShare={startScreenShare}
            onStopShare={stopScreenShare}
            onRestartConnection={restartConnection}
            diagnostics={diagnostics}
            iceConnectionStates={iceConnectionStates}
            videoRef={videoRef}
            isSharingScreen={isSharingScreen}
            isSharingError={sharingError}
          />
        ) : (
          <div className="flex-1 flex flex-col justify-between max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
            {/* Hero Section */}
            <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-semibold uppercase tracking-wider mb-4 shadow-sm shadow-cyan-500/10">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Browser-Native WebRTC Streaming
              </div>

              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white mb-4 leading-tight">
                Stream Your Screen{" "}
                <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
                  Directly to Any Device
                </span>
              </h1>

              <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
                Effortless presentation sharing for meetings, lectures, and quick demos. No
                downloads, accounts, or configurations. Just generate a 6-digit code or scan the QR.
              </p>
            </div>

            {/* Action Cards (Create / Join) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 max-w-5xl mx-auto w-full mb-14">
              <CreateRoomCard
                onCreate={handleCreateRoom}
                isLoading={isCreating}
                disabled={connectionStatus !== "connected"}
              />

              <JoinRoomCard
                onJoin={handleJoinRoom}
                initialRoomId={initialRoomQuery}
                isLoading={isJoining}
                disabled={connectionStatus !== "connected"}
              />
            </div>

            {/* Features Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-10 border-t border-slate-900">
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60">
                <div className="h-9 w-9 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-white mb-1">Peer-to-Peer Video</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Real-time direct WebRTC transport with local Wi-Fi priority for razor-sharp 60fps
                  presentation video.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60">
                <div className="h-9 w-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-white mb-1">Ephemeral & Private</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Rooms automatically expire after 2 hours. Video never touches any recording server
                  or cloud database.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60">
                <div className="h-9 w-9 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-white mb-1">Instant QR Join</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Colleagues on phones or tablets can scan the presenter QR code to immediately tune
                  in without typing.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 text-center text-xs text-slate-400">
        <p>TR Presentation ShareHub &bull; Modern WebRTC Screen Streaming</p>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-sm">
          Loading ShareHub...
        </div>
      }
    >
      <ShareHubContent />
    </Suspense>
  );
}
