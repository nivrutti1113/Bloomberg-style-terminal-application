"use client";

import React, { useEffect, useState } from "react";
import { ServerMetrics } from "@/types/market";
import { wsManager } from "@/lib/ws/wsManager";
import { useTerminalStore } from "@/store/terminalStore";
import { getApiBaseUrl } from "@/config/env";

export const MetricsPanel: React.FC = () => {
  const { connectionStatus, latencyMs, p99LatencyMs } = useTerminalStore();
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string>("");

  useEffect(() => {
    let isMounted = true;

    const fetchMetrics = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/metrics`);
        if (res.ok) {
          const data = (await res.json()) as ServerMetrics;
          if (isMounted) {
            setMetrics(data);
            setError(null);
            setLastFetched(new Date().toLocaleTimeString());
          }
        } else {
          if (isMounted) setError(`Backend status: ${res.status}`);
        }
      } catch {
        if (isMounted) {
          setError("Backend /metrics unreachable (running in direct fallback mode)");
        }
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000); // Poll every 2s per spec

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="w-full h-full bg-[#0A0A0A] flex flex-col font-mono text-[11px] select-none p-3 space-y-4 overflow-y-auto">
      {/* Title */}
      <div className="border-b border-[#2A2A2A] pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#FFB000] font-bold text-[12px]">SYSTEM HEALTH &amp; TELEMETRY</span>
          <span className="text-[#666666] text-[10px]">(POLLING /metrics @ 2s)</span>
        </div>
        <div className="text-[10px] text-[#9A9A9A]">
          UPDATED: <span className="text-[#FFB000]">{lastFetched || "--"}</span>
        </div>
      </div>

      {/* Grid of Key Telemetry Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Ticks Per Second */}
        <div className="border border-[#2A2A2A] bg-[#000000] p-3">
          <div className="text-[#666666] text-[10px]">BACKEND TICKS/SEC</div>
          <div className="text-[#FFB000] text-[20px] font-bold tabular-nums">
            {metrics?.ticks_per_sec !== undefined ? metrics.ticks_per_sec : wsManager.getTicksPerSec()}
          </div>
          <div className="text-[#9A9A9A] text-[9px] mt-1">Throughput Rate</div>
        </div>

        {/* Total Ticks */}
        <div className="border border-[#2A2A2A] bg-[#000000] p-3">
          <div className="text-[#666666] text-[10px]">TOTAL TICKS PROCESSED</div>
          <div className="text-[#2D9CDB] text-[20px] font-bold tabular-nums">
            {metrics?.total_ticks !== undefined ? metrics.total_ticks.toLocaleString() : "--"}
          </div>
          <div className="text-[#9A9A9A] text-[9px] mt-1">Session Ingestion</div>
        </div>

        {/* p50 Latency */}
        <div className="border border-[#2A2A2A] bg-[#000000] p-3">
          <div className="text-[#666666] text-[10px]">p50 LATENCY</div>
          <div className="text-[#00D26A] text-[20px] font-bold tabular-nums">
            {metrics?.p50_latency_ms !== undefined ? `${metrics.p50_latency_ms}ms` : `${latencyMs}ms`}
          </div>
          <div className="text-[#9A9A9A] text-[9px] mt-1">Exchange-to-Terminal</div>
        </div>

        {/* p99 Latency */}
        <div className="border border-[#2A2A2A] bg-[#000000] p-3">
          <div className="text-[#666666] text-[10px]">p99 LATENCY</div>
          <div className="text-[#FF3B30] text-[20px] font-bold tabular-nums">
            {metrics?.p99_latency_ms !== undefined ? `${metrics.p99_latency_ms}ms` : `${p99LatencyMs}ms`}
          </div>
          <div className="text-[#9A9A9A] text-[9px] mt-1">99th Percentile Tail</div>
        </div>
      </div>

      {/* Connection & Architecture Diagnostic Details */}
      <div className="border border-[#2A2A2A] bg-[#050505] p-3 space-y-2">
        <div className="text-[#FFB000] font-bold text-[11px] mb-2">ENGINE ARCHITECTURE STATUS</div>

        <div className="grid grid-cols-2 gap-2 text-[10px] tabular-nums">
          <div className="flex justify-between border-b border-[#1A1A1A] py-1">
            <span className="text-[#666666]">WebSocket Pipeline:</span>
            <span className={connectionStatus === "CONNECTED" ? "text-[#00D26A] font-bold" : "text-[#FFB000]"}>
              {connectionStatus}
            </span>
          </div>

          <div className="flex justify-between border-b border-[#1A1A1A] py-1">
            <span className="text-[#666666]">Backend Feed Status:</span>
            <span className="text-white font-bold">{metrics?.feed_status || (wsManager.isFallbackMode() ? "DIRECT_WS" : "WAITING")}</span>
          </div>

          <div className="flex justify-between border-b border-[#1A1A1A] py-1">
            <span className="text-[#666666]">Active WS Clients:</span>
            <span className="text-white">{metrics?.active_ws_connections ?? 1}</span>
          </div>

          <div className="flex justify-between border-b border-[#1A1A1A] py-1">
            <span className="text-[#666666]">Server Uptime:</span>
            <span className="text-white">{metrics?.uptime_seconds ? `${metrics.uptime_seconds}s` : "--"}</span>
          </div>

          <div className="flex justify-between border-b border-[#1A1A1A] py-1">
            <span className="text-[#666666]">UI Render Strategy:</span>
            <span className="text-[#00D26A]">requestAnimationFrame (Batch Coalesce)</span>
          </div>

          <div className="flex justify-between border-b border-[#1A1A1A] py-1">
            <span className="text-[#666666]">Memory Safety:</span>
            <span className="text-[#00D26A]">Ring Buffer Capped</span>
          </div>
        </div>

        {error && (
          <div className="mt-2 text-[#FFB000] bg-[#1F1700] p-1.5 border border-[#FFB000]/50 text-[10px]">
            NOTE: {error}
          </div>
        )}
      </div>
    </div>
  );
};
