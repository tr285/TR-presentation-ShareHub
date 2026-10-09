"use client";

import React, { useState } from "react";

interface CreateRoomCardProps {
  onCreate: (options: { maxParticipants: number }) => Promise<void>;
  isLoading: boolean;
  disabled?: boolean;
}

export function CreateRoomCard({
  onCreate,
  isLoading,
  disabled = false,
}: CreateRoomCardProps) {
  const [maxParticipants, setMaxParticipants] = useState(12);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || isLoading) return;
    await onCreate({ maxParticipants });
  };

  return (
    <div className="relative group rounded-3xl p-[1px] bg-gradient-to-b from-cyan-500/40 via-indigo-500/20 to-transparent shadow-xl shadow-cyan-950/20">
      <div className="relative h-full rounded-3xl bg-slate-900/90 backdrop-blur-xl p-6 sm:p-8 flex flex-col justify-between border border-slate-800">
        <div>
          {/* Top icon and badge */}
          <div className="flex items-center justify-between mb-5">
            <div className="h-12 w-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-md shadow-cyan-500/10">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              Host / Presenter
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2">
            Start Presenting
          </h2>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Create an instant presentation room. You will receive a unique temporary sharing ID
            and QR code for viewers to connect.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="select-participant-limit"
                className="block text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wider"
              >
                Participant Limit
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[5, 12, 25].map((count) => (
                  <button
                    key={count}
                    type="button"
                    id={`btn-limit-${count}`}
                    onClick={() => setMaxParticipants(count)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      maxParticipants === count
                        ? "bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                        : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300"
                    }`}
                  >
                    {count} Viewers
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                id="btn-create-room"
                disabled={disabled || isLoading}
                className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-cyan-500 via-indigo-600 to-cyan-500 bg-size-200 bg-pos-0 hover:bg-pos-100 text-white font-semibold text-sm shadow-lg shadow-cyan-500/25 transition-all duration-300 hover:shadow-cyan-500/40 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Generating Room...</span>
                  </>
                ) : (
                  <>
                    <span>Create Presentation Room</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
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
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Direct P2P Stream</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>2-Hour Disposable Room</span>
          </div>
        </div>
      </div>
    </div>
  );
}
