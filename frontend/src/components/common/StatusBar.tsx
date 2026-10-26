"use client";

import React, { useEffect, useState } from "react";
import { useTerminalStore } from "@/store/terminalStore";
import { wsManager } from "@/lib/ws/wsManager";

export const StatusBar: React.FC = () => {
  const { connectionStatus, latencyMs, p99LatencyMs, symbols, activeSymbol } = useTerminalStore();
  const [ticksPerSec, setTicksPerSec] = useState<number>(0);
  const [isFallback, setIsFallback] = useState<boolean>(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setTicksPerSec(wsManager.getTicksPerSec());
      setIsFallback(wsManager.isFallbackMode());
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="w-full bg-[#000000] border-t border-[#2A2A2A] text-[10px] font-mono select-none px-2 py-1 flex items-center justify-between tabular-nums text-[#9A9A9A]">
      {/* Left side: Engine status, Ticks/Sec, Latency */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[#666666]">FEED:</span>
          <span className={isFallback ? "text-[#2D9CDB]" : "text-[#FFB000]"}>
            {isFallback ? "BINANCE_PUBLIC_DIRECT" : "FASTAPI_REDIS_STREAM"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[#666666]">STATUS:</span>
          <span
            className={
              connectionStatus === "CONNECTED"
                ? "text-[#00D26A] font-bold"
                : connectionStatus === "STALE"
                ? "text-[#FF3B30] font-bold"
                : "text-[#FFB000] font-bold"
            }
          >
            {connectionStatus}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[#666666]">THROUGHPUT:</span>
          <span className="text-[#FFB000] font-bold">{ticksPerSec}</span>
          <span className="text-[#666666]">ticks/s</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[#666666]">p50:</span>
          <span className="text-[#00D26A]">{latencyMs}ms</span>
          <span className="text-[#666666]">| p99:</span>
          <span className={p99LatencyMs > 400 ? "text-[#FF3B30]" : "text-[#FFB000]"}>
            {p99LatencyMs}ms
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1.5">
          <span className="text-[#666666]">ACTIVE:</span>
          <span className="text-[#FFB000] font-bold">{activeSymbol}</span>
          <span className="text-[#666666]">({symbols.length} watched)</span>
        </div>
      </div>

      {/* Right side: Honest Data Label & Keyboard Help Hint */}
      <div className="flex items-center gap-3">
        <span className="text-[#666666] hidden lg:inline">
          [ESC: Close Panel | /: Command Bar | F1-F8: Quick Panels]
        </span>
        <span className="text-[#FFB000] bg-[#1A1A1A] px-1.5 py-0.2 border border-[#2A2A2A] text-[9px]">
          INTERNET_STREAM (NON-COLOCATED)
        </span>
      </div>
    </footer>
  );
};
