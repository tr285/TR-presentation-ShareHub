"use client";

import React from "react";
import type { ConnectionStatus } from "../hooks/useSignaling";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  socketId: string | null;
}

export function Header({ connectionStatus, socketId }: HeaderProps) {
  const getStatusBadge = () => {
    switch (connectionStatus) {
      case "connected":
        return (
          <span
            id="status-connected"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Signaling Online
          </span>
        );
      case "connecting":
        return (
          <span
            id="status-connecting"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-950/70 text-amber-300 border border-amber-500/30"
          >
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            Connecting...
          </span>
        );
      case "error":
        return (
          <span
            id="status-error"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-rose-950/70 text-rose-300 border border-rose-500/30"
          >
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            Signaling Offline
          </span>
        );
      default:
        return (
          <span
            id="status-disconnected"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-900/80 text-slate-400 border border-slate-700"
          >
            <span className="h-2 w-2 rounded-full bg-slate-500" />
            Disconnected
          </span>
        );
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-slate-950/70 border-b border-slate-800/80 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-fuchsia-500 p-[2px] shadow-lg shadow-indigo-500/20">
            <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <svg
                className="w-5 h-5 text-cyan-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg bg-gradient-to-r from-white via-slate-200 to-cyan-300 bg-clip-text text-transparent tracking-tight">
                TR Presentation
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold tracking-wide uppercase">
                ShareHub
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Secure Cross-Device Real-Time Screen Sharing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {socketId && (
            <span
              id="socket-id-pill"
              className="hidden md:inline-flex text-[11px] font-mono text-slate-400 bg-slate-900/90 px-2.5 py-1 rounded-md border border-slate-800"
              title={`Peer ID: ${socketId}`}
            >
              Peer: {socketId.slice(0, 8)}...
            </span>
          )}
          {getStatusBadge()}
        </div>
      </div>
    </header>
  );
}
