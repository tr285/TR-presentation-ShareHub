"use client";

import React, { useState } from "react";

interface JoinRoomCardProps {
  onJoin: (roomId: string, passcode?: string) => Promise<void>;
  initialRoomId?: string;
  isLoading: boolean;
  disabled?: boolean;
}

export function JoinRoomCard({
  onJoin,
  initialRoomId = "",
  isLoading,
  disabled = false,
}: JoinRoomCardProps) {
  const [roomId, setRoomId] = useState(initialRoomId.toUpperCase());
  const [prevInitial, setPrevInitial] = useState(initialRoomId);
  const [passcode, setPasscode] = useState("");
  const [showPasscodeInput, setShowPasscodeInput] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);

  if (initialRoomId !== prevInitial) {
    setPrevInitial(initialRoomId);
    setRoomId(initialRoomId.toUpperCase());
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase();
    setRoomId(raw);
    setFormatError(null);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        let extracted = text.trim();
        try {
          const url = new URL(extracted);
          const roomParam = url.searchParams.get("room");
          if (roomParam) extracted = roomParam;
        } catch {
          // not a URL, use raw text
        }
        setRoomId(extracted.toUpperCase());
        setFormatError(null);
      }
    } catch {
      // Clipboard permission denied or unsupported
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = roomId.trim();
    if (!clean) {
      setFormatError("Please enter a room sharing ID.");
      return;
    }
    if (clean.length < 4) {
      setFormatError("Room ID is too short.");
      return;
    }
    if (disabled || isLoading) return;
    await onJoin(clean, passcode.trim() || undefined);
  };

  return (
    <div className="relative group rounded-3xl p-[1px] bg-gradient-to-b from-purple-500/40 via-indigo-500/20 to-transparent shadow-xl shadow-purple-950/20">
      <div className="relative h-full rounded-3xl bg-slate-900/90 backdrop-blur-xl p-6 sm:p-8 flex flex-col justify-between border border-slate-800">
        <div>
          {/* Top icon and badge */}
          <div className="flex items-center justify-between mb-5">
            <div className="h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-md shadow-purple-500/10">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
              Audience / Viewer
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2">
            Join Presentation
          </h2>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Enter the 6-character room ID provided by the presenter to watch real-time screen
            sharing on any screen.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="input-room-id"
                  className="block text-xs font-semibold text-slate-300 uppercase tracking-wider"
                >
                  Sharing Room ID
                </label>
                <button
                  type="button"
                  id="btn-paste-room-id"
                  onClick={handlePaste}
                  className="text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  <span>Paste ID</span>
                </button>
              </div>

              <div className="relative">
                <input
                  type="text"
                  id="input-room-id"
                  name="roomId"
                  value={roomId}
                  onChange={handleInputChange}
                  placeholder="e.g. TR-842-917"
                  maxLength={24}
                  autoComplete="off"
                  spellCheck="false"
                  disabled={disabled || isLoading}
                  className="w-full px-4 py-3.5 rounded-2xl bg-slate-950/80 border border-slate-700/80 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 text-white placeholder-slate-500 font-mono text-base tracking-wider transition-all disabled:opacity-50"
                />
              </div>

              {formatError && (
                <p id="error-format-room" className="mt-2 text-xs text-rose-400 font-medium">
                  {formatError}
                </p>
              )}
            </div>

            {/* Optional PIN Field / Toggle */}
            <div className="pt-1">
              {!showPasscodeInput ? (
                <button
                  type="button"
                  id="btn-toggle-passcode"
                  onClick={() => setShowPasscodeInput(true)}
                  className="text-xs text-slate-400 hover:text-purple-300 flex items-center gap-1.5 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <span>Room requires a Passcode PIN? Click here</span>
                </button>
              ) : (
                <div>
                  <label
                    htmlFor="input-join-passcode"
                    className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5"
                  >
                    Room PIN / Passcode
                  </label>
                  <input
                    type="password"
                    id="input-join-passcode"
                    name="passcode"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Enter Room PIN"
                    maxLength={16}
                    autoComplete="off"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-white placeholder-slate-500 font-mono text-sm tracking-wider"
                  />
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                id="btn-join-room"
                disabled={disabled || isLoading || !roomId.trim()}
                className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 bg-size-200 bg-pos-0 hover:bg-pos-100 text-white font-semibold text-sm shadow-lg shadow-purple-600/25 transition-all duration-300 hover:shadow-purple-600/40 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Connecting to Room...</span>
                  </>
                ) : (
                  <>
                    <span>Join Room</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Feature Pills */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span>Works on Any Device</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>Sub-Second Latency</span>
          </div>
        </div>
      </div>
    </div>
  );
}
