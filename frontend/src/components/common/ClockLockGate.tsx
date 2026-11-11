"use client";

import React, { useEffect, useState } from "react";
import { useTimeSync, timeSync } from "@/lib/timeSync";

interface ClockLockGateProps {
  children: React.ReactNode;
}

export const ClockLockGate: React.FC<ClockLockGateProps> = ({ children }) => {
  const timeSyncState = useTimeSync();
  const [currentDeviceTime, setCurrentDeviceTime] = useState<string>("");
  const [currentNetworkTime, setCurrentNetworkTime] = useState<string>("");
  const [checking, setChecking] = useState<boolean>(false);

  // Live 1-second ticking clock display for the lock screen
  useEffect(() => {
    if (!timeSyncState.isDesynced) return;

    const updateClocks = () => {
      const now = new Date();
      const accurate = timeSync.getAccurateNow();
      setCurrentDeviceTime(now.toLocaleTimeString("en-US", { hour12: false }) + " (" + now.toLocaleDateString() + ")");
      setCurrentNetworkTime(accurate.toLocaleTimeString("en-US", { hour12: false }) + " (" + accurate.toLocaleDateString() + ")");
    };

    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, [timeSyncState.isDesynced]);

  // Frequent auto-polling when desynchronized (every 2.5s) to auto-unlock as soon as device time is fixed
  useEffect(() => {
    if (!timeSyncState.isDesynced) return;

    const pollTimer = setInterval(() => {
      timeSync.checkTimeSync();
    }, 2500);

    return () => clearInterval(pollTimer);
  }, [timeSyncState.isDesynced]);

  // If clock is properly synchronized, render the full terminal application!
  if (!timeSyncState.isDesynced) {
    return <>{children}</>;
  }

  // STRICT BLOCKING SCREEN: Suspends all market panels until clock is synchronized
  return (
    <div className="fixed inset-0 z-50 bg-[#050505] text-[#E0E0E0] font-mono flex flex-col items-center justify-center p-4 md:p-8 select-none">
      <div className="max-w-2xl w-full bg-[#0A0A0A] border-2 border-[#FF3B30] shadow-2xl p-6 flex flex-col gap-5">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
          <div className="flex items-center gap-2.5">
            <span className="w-3.5 h-3.5 rounded-full bg-[#FF3B30] animate-ping shrink-0" />
            <h1 className="text-base font-bold text-[#FF3B30] tracking-wider uppercase">
              CRITICAL NOTICE: SYSTEM ACCESS SUSPENDED
            </h1>
          </div>
          <span className="px-2 py-0.5 bg-[#2A0000] border border-[#FF3B30] text-[#FF3B30] text-[10px] font-bold">
            CLOCK SKEW LOCK
          </span>
        </div>

        {/* Core Notice Message */}
        <div className="text-xs text-[#CCCCCC] leading-relaxed flex flex-col gap-2">
          <p>
            <strong className="text-white">Your computer&apos;s system clock is out of synchronization.</strong> All financial terminal feeds, Level-2 order books, and high-frequency candlestick aggregations are strictly locked until your device time is corrected.
          </p>
          <p className="text-[#999999]">
            Trading on an incorrect system clock corrupts microsecond execution queues and causes invalid market timestamps. Please synchronize your device time now. Once synchronized, <strong className="text-[#00E5FF]">this screen will automatically unlock</strong> and restore the terminal.
          </p>
        </div>

        {/* Live Diagnostics Comparison Table */}
        <div className="bg-[#100500] border border-[#FF6D00]/50 p-4 rounded flex flex-col gap-2.5 text-xs">
          <div className="flex justify-between items-center py-1 border-b border-[#2A1500]">
            <span className="text-[#888888]">YOUR DEVICE CLOCK (INCORRECT):</span>
            <strong className="text-[#FF3B30] font-mono text-sm">{currentDeviceTime || "Detecting..."}</strong>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#2A1500]">
            <span className="text-[#888888]">AUTHORITATIVE NETWORK TIME (REAL):</span>
            <strong className="text-[#00E676] font-mono text-sm">{currentNetworkTime || "Detecting..."}</strong>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#2A1500]">
            <span className="text-[#888888]">MEASURED TIME DRIFT:</span>
            <strong className="text-[#FFB000] font-bold">{timeSyncState.driftFormatted}</strong>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-[#888888]">DETECTED TIMEZONE:</span>
            <span className="text-[#00E5FF] font-semibold">{timeSyncState.userTimezone}</span>
          </div>
        </div>

        {/* Step-by-Step Fix Instructions for Operating Systems */}
        <div className="bg-[#0E0E0E] border border-[#222222] p-4 rounded flex flex-col gap-2 text-xs">
          <span className="text-[#FFB000] font-bold tracking-wide uppercase border-b border-[#1F1F1F] pb-1">
            HOW TO CORRECT YOUR TIME (WINDOWS 10 / 11):
          </span>
          <ol className="list-decimal list-inside space-y-1.5 text-[#B0B0B0] text-[11px] leading-relaxed">
            <li>
              Press <kbd className="px-1.5 py-0.5 bg-[#222222] border border-[#444444] text-[#FFB000] rounded">Win + I</kbd> on your keyboard to open <strong>Settings</strong>.
            </li>
            <li>
              Click on <strong>Time & Language</strong> in the left menu, then select <strong>Date & Time</strong>.
            </li>
            <li>
              Ensure <strong>&quot;Set time automatically&quot;</strong> is toggled <strong>ON</strong>.
            </li>
            <li>
              Under <em>Additional settings</em>, click the <strong>&quot;Sync now&quot;</strong> button.
            </li>
            <li>
              Confirm your Time Zone matches your location (e.g. <em>(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi</em>).
            </li>
          </ol>
        </div>

        {/* Auto-Unlock Status & Manual Recheck */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-[#222222]">
          <div className="flex items-center gap-2 text-[11px] text-[#888888]">
            <span className="w-2 h-2 rounded-full bg-[#00E5FF] animate-ping" />
            <span>Auto-detecting clock sync every 2.5s...</span>
          </div>

          <button
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              await timeSync.checkTimeSync();
              setTimeout(() => setChecking(false), 500);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-[#FFB000] hover:bg-white text-black font-bold text-xs uppercase tracking-wider cursor-pointer transition-colors flex items-center justify-center gap-1.5"
          >
            {checking ? "CHECKING NTP..." : "RE-CHECK TIME SYNC ⟳"}
          </button>
        </div>
      </div>
    </div>
  );
};
