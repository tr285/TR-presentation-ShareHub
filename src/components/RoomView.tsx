"use client";

import React, { useState, useEffect } from "react";
import type { RoomSessionState } from "../hooks/useSignaling";
import { QRCodeModal } from "./QRCodeModal";

interface RoomViewProps {
  roomSession: RoomSessionState;
  socketId: string | null;
  onLeaveRoom: () => void;
  onStartShare?: () => void;
  onStopShare?: () => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  isSharingScreen?: boolean;
  isSharingError?: string | null;
}

export function RoomView({
  roomSession,
  socketId,
  onLeaveRoom,
  onStartShare,
  onStopShare,
  videoRef,
  isSharingScreen = false,
  isSharingError = null,
}: RoomViewProps) {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { roomId, role, presenterSocketId, isSharing, peers, expiresAt } = roomSession;
  const isPresenter: boolean =
    role === "presenter" || Boolean(socketId && presenterSocketId === socketId);

  // Expiration countdown
  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const diff = expiresAt - Date.now();
      if (diff <= 0) {
        setTimeRemaining("Expiring now");
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeRemaining(`${hours}h ${mins}m left`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 30000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleCopyId = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      {/* Room Navigation & Status Bar */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: Room ID & Copy & QR */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-950/80 px-3.5 py-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Room:
              </span>
              <span
                id="display-room-id"
                className="font-mono font-bold text-sm sm:text-base text-cyan-300 tracking-wider"
              >
                {roomId}
              </span>
              <button
                id="btn-copy-room-id"
                onClick={handleCopyId}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
                title="Copy Room ID"
              >
                {copied ? (
                  <span className="text-xs text-emerald-400 font-semibold">Copied!</span>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
            </div>

            <button
              id="btn-open-qr-modal"
              onClick={() => setIsQRModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs font-medium text-slate-200 border border-slate-700 transition-colors"
              title="View QR Code"
            >
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                />
              </svg>
              <span>QR Code</span>
            </button>
          </div>

          {/* Right: Role, Timer, Participants & Leave */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span
              id="badge-user-role"
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider ${
                isPresenter
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
              }`}
            >
              {isPresenter ? "Presenter" : "Viewer"}
            </span>

            {timeRemaining && (
              <span
                id="timer-room-expiration"
                className="hidden md:inline-flex text-xs text-slate-400 bg-slate-950/60 px-2.5 py-1 rounded-lg border border-slate-800"
              >
                {timeRemaining}
              </span>
            )}

            <span
              id="participant-count-pill"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/80 text-slate-300 border border-slate-700"
            >
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
              <span>{peers.length + 1}</span>
            </span>

            <button
              id="btn-leave-room"
              onClick={onLeaveRoom}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold border border-rose-800/60 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Leave</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Presentation Stage */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-6">
        {/* Stream / Video Container */}
        <div className="relative flex-1 min-h-[460px] rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl flex flex-col items-center justify-center overflow-hidden">
          {/* Top Stage Bar */}
          <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-2">
              {isSharing || isSharingScreen ? (
                <span
                  id="badge-stream-live"
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-rose-600 text-white shadow-lg shadow-rose-600/30"
                >
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  LIVE SCREEN STREAM
                </span>
              ) : (
                <span
                  id="badge-stream-idle"
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-slate-950/80 text-slate-400 border border-slate-800"
                >
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  Stream Idle
                </span>
              )}
            </div>

            <div className="pointer-events-auto flex items-center gap-2">
              <button
                id="btn-toggle-fullscreen"
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Actual Video Element */}
          <video
            ref={videoRef}
            id="remote-screen-video"
            autoPlay
            playsInline
            muted={isPresenter}
            className={`w-full h-full object-contain ${
              isSharing || isSharingScreen ? "block" : "hidden"
            }`}
          />

          {/* Empty Stage State */}
          {!(isSharing || isSharingScreen) && (
            <div className="p-8 text-center max-w-lg z-10 flex flex-col items-center">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-xl shadow-cyan-500/10">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div className="absolute inset-0 rounded-3xl bg-cyan-500/20 animate-ping -z-10" />
              </div>

              {isPresenter ? (
                <>
                  <h3 className="text-xl font-bold text-white mb-2">
                    Ready to Present Your Screen
                  </h3>
                  <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                    Click the button below to select the display, application window, or browser
                    tab you wish to share with participants.
                  </p>

                  <div className="bg-slate-950/70 rounded-2xl p-4 border border-slate-800 text-left mb-6 text-xs text-slate-300 space-y-1.5">
                    <div className="font-semibold text-cyan-400 flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Explicit Consent Required
                    </div>
                    <p className="text-slate-400">
                      Your browser will show a permission prompt to confirm what to share. No
                      webcam or background data is captured. You can stop sharing at any second.
                    </p>
                  </div>

                  {isSharingError && (
                    <div id="error-screen-share" className="p-3 mb-4 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs">
                      {isSharingError}
                    </div>
                  )}

                  {onStartShare && (
                    <button
                      id="btn-start-screen-share"
                      onClick={onStartShare}
                      className="py-3.5 px-6 rounded-2xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-cyan-500 text-white font-semibold text-sm shadow-xl shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Share Screen Now</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <h3 className="text-xl font-bold text-white mb-2">
                    Waiting for Presenter
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    The presenter has not started screen streaming yet. As soon as they share
                    their display, it will automatically appear here in real-time.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Presenter Floating Stop Sharing Bar */}
          {isPresenter && (isSharing || isSharingScreen) && onStopShare && (
            <div className="absolute bottom-6 z-20 flex items-center gap-3 bg-slate-950/90 backdrop-blur-xl px-5 py-3 rounded-2xl border border-slate-800 shadow-2xl">
              <span className="text-xs text-slate-300 font-medium">You are sharing your screen</span>
              <button
                id="btn-stop-screen-share"
                onClick={onStopShare}
                className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-lg shadow-rose-600/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Stop Sharing</span>
              </button>
            </div>
          )}
        </div>

        {/* Participants & Connection Information Panel */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Connected Participants ({peers.length + 1})
            </h4>
            <span className="text-[11px] text-slate-400">Direct WebRTC Room</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {/* Self Participant Card */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs">
                  You
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">Your Device</div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {socketId ? `${socketId.slice(0, 6)}...` : "Connected"}
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                {isPresenter ? "Presenter" : "Viewer"}
              </span>
            </div>

            {/* Remote Peers Cards */}
            {peers.map((peer) => (
              <div
                key={peer.peerId}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800"
              >
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-xs">
                    {peer.role === "presenter" ? "P" : "V"}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">Peer Device</div>
                    <div className="text-[10px] font-mono text-slate-400">
                      {peer.peerId.slice(0, 6)}...
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {peer.role === "presenter" ? "Presenter" : "Viewer"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* QR Code Modal */}
      {roomId && (
        <QRCodeModal
          isOpen={isQRModalOpen}
          onClose={() => setIsQRModalOpen(false)}
          roomId={roomId}
        />
      )}
    </div>
  );
}
