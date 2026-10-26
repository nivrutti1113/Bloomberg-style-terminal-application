"use client";

import React, { useEffect, useRef } from "react";
import { TopBar } from "@/components/common/TopBar";
import { StatusBar } from "@/components/common/StatusBar";
import { TerminalLayout, TerminalLayoutRef } from "@/components/layout/TerminalLayout";
import { wsManager } from "@/lib/ws/wsManager";
import { useTerminalStore } from "@/store/terminalStore";

export default function TerminalPage() {
  const layoutRef = useRef<TerminalLayoutRef | null>(null);
  const { updateTicks, setConnectionStatus, setActivePanelFunction, setActiveSymbol } = useTerminalStore();

  useEffect(() => {
    // Connect WebSocket manager
    wsManager.connect();

    // Subscribe to micro-batched ticks (dispatched inside requestAnimationFrame)
    const unsubTicks = wsManager.subscribeTicks((ticks) => {
      updateTicks(ticks);
    });

    // Subscribe to connection health & latency
    const unsubStatus = wsManager.subscribeStatus((status, latencyMs) => {
      setConnectionStatus(status, latencyMs);
    });

    return () => {
      unsubTicks();
      unsubStatus();
    };
  }, [updateTicks, setConnectionStatus]);

  const handleExecuteCommand = (action: string, symbol?: string, panelType?: string) => {
    setActivePanelFunction(action);
    if (symbol) {
      setActiveSymbol(symbol);
    }

    if (panelType && layoutRef.current) {
      const title = symbol ? `${symbol} ${action}` : action;
      layoutRef.current.openOrFocusTab(panelType, symbol, title);
    }
  };

  return (
    <main className="w-screen h-screen flex flex-col overflow-hidden bg-[#000000] text-[#FFB000] font-mono select-none">
      {/* Top Bloomberg Header & Command Bar */}
      <TopBar onExecuteCommand={handleExecuteCommand} />

      {/* Main Dockable & Resizable Multi-Panel Terminal Space */}
      <div className="flex-1 w-full h-full relative overflow-hidden">
        <TerminalLayout ref={layoutRef} />
      </div>

      {/* Bottom Telemetry & Status Bar */}
      <StatusBar />
    </main>
  );
}
