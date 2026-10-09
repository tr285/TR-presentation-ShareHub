"use client";

import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
}

export function QRCodeModal({ isOpen, onClose, roomId }: QRCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/?room=${encodeURIComponent(roomId)}`
      : `/?room=${encodeURIComponent(roomId)}`;

  useEffect(() => {
    if (!isOpen || !canvasRef.current || !roomId) return;

    QRCode.toCanvas(
      canvasRef.current,
      joinUrl,
      {
        width: 256,
        margin: 2,
        color: {
          dark: "#0f172a", // Slate 900
          light: "#ffffff",
        },
        errorCorrectionLevel: "M",
      },
      (err) => {
        if (err) console.error("Error generating QR code:", err);
      }
    );
  }, [isOpen, roomId, joinUrl]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `sharehub-qr-${roomId}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  return (
    <div
      id="qr-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="qr-modal-container"
        className="relative w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl shadow-cyan-950/50 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          id="btn-close-qr-modal"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          aria-label="Close QR Modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="inline-flex p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 mb-3 border border-cyan-500/20">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
            />
          </svg>
        </div>

        <h3 className="text-lg font-bold text-white mb-1">Scan to Join Presentation</h3>
        <p className="text-xs text-slate-400 mb-4">
          Point camera from iPhone, iPad, Android or another laptop
        </p>

        {/* QR Code Canvas Card */}
        <div className="flex justify-center p-4 bg-white rounded-xl shadow-inner mb-4">
          <canvas ref={canvasRef} className="rounded-md max-w-full h-auto" />
        </div>

        <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 mb-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">
            Sharing Room ID
          </div>
          <div className="text-xl font-mono font-bold text-cyan-300 tracking-wider">
            {roomId}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[11px] text-cyan-400/90 font-mono">
            <svg className="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v20l6-5-6-5 6-5-6-5zM6 7l12 10M6 17l12-10" />
            </svg>
            <span>BLE Beacon: ShareHub-{roomId}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            id="btn-copy-join-link"
            onClick={handleCopyLink}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy Link</span>
              </>
            )}
          </button>
          <button
            id="btn-download-qr"
            onClick={handleDownload}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white shadow-lg shadow-cyan-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>Save QR</span>
          </button>
        </div>
      </div>
    </div>
  );
}
