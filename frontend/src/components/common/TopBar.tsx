"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "@/store/terminalStore";
import { AUTOCOMPLETE_ITEMS, parseCommand } from "@/commands/commandParser";
import { WsConnectionStatus } from "@/types/market";
import { useTimeSync, timeSync } from "@/lib/timeSync";

interface TopBarProps {
  onExecuteCommand: (action: string, symbol?: string, panelType?: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onExecuteCommand }) => {
  const {
    commandInput,
    setCommandInput,
    commandError,
    setCommandError,
    pushCommandHistory,
    navigateHistory,
    connectionStatus,
    latencyMs,
    activeSymbol,
    addSymbol,
    removeSymbol,
  } = useTerminalStore();

  const [utcTime, setUtcTime] = useState<string>("");
  const [istTime, setIstTime] = useState<string>("");
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const timeSyncState = useTimeSync();
  const [showTimeModal, setShowTimeModal] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Clocks: UTC + IST (computed from authoritative timeSync.getAccurateNow())
  useEffect(() => {
    const updateTime = () => {
      const now = timeSync.getAccurateNow();
      setUtcTime(
        now.toLocaleTimeString("en-US", {
          timeZone: "UTC",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }) + " UTC"
      );
      setIstTime(
        now.toLocaleTimeString("en-US", {
          timeZone: "Asia/Kolkata",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }) + " IST"
      );
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Global Keyboard Shortcuts (/ or Ctrl+K to focus command bar, Esc to blur)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "/" || (e.ctrlKey && e.key.toLowerCase() === "k")) && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === "Escape") {
        inputRef.current?.blur();
        setCommandError(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setCommandError]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;

    const parsed = parseCommand(commandInput, activeSymbol);

    if (!parsed.isValid) {
      setCommandError(parsed.errorMessage || "Invalid command");
      return;
    }

    pushCommandHistory(commandInput);
    setCommandError(null);
    setCommandInput("");
    inputRef.current?.blur();

    if (parsed.action === "ADD_SYMBOL" && parsed.symbol) {
      addSymbol(parsed.symbol);
    } else if (parsed.action === "DEL_SYMBOL" && parsed.symbol) {
      removeSymbol(parsed.symbol);
    } else if (parsed.action === "OPEN_PANEL" && parsed.panelType) {
      onExecuteCommand(parsed.panelFunction || "PANEL", parsed.symbol, parsed.panelType);
    }
  };

  const handleKeyDownInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateHistory("up");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navigateHistory("down");
    }
  };

  // Status Indicator formatting
  const getStatusBadge = (status: WsConnectionStatus) => {
    switch (status) {
      case "CONNECTED":
        return <span className="text-[#00D26A] font-bold">● CONNECTED</span>;
      case "DIRECT_FALLBACK":
        return <span className="text-[#FFB000] font-bold">▲ DIRECT FEED (BACKEND DOWN)</span>;
      case "RECONNECTING":
        return <span className="text-[#FFB000] font-bold animate-pulse">◐ RECONNECTING</span>;
      case "STALE":
        return <span className="text-[#FF3B30] font-bold">○ STALE (&gt;5s)</span>;
      case "DISCONNECTED":
      default:
        return <span className="text-[#9A9A9A] font-bold">✕ OFFLINE</span>;
    }
  };

  // Autocomplete suggestions filtered
  const suggestions = commandInput.trim()
    ? AUTOCOMPLETE_ITEMS.filter(
        (item) =>
          item.command.toLowerCase().includes(commandInput.toLowerCase()) ||
          item.description.toLowerCase().includes(commandInput.toLowerCase())
      ).slice(0, 5)
    : [];

  return (
    <>
      {/* Optional Top Warning Bar for Clock Desync */}
      {timeSyncState.isDesynced && (
        <div className="w-full bg-[#2A0800] border-b border-[#FF6D00] text-[#FFB000] px-3 py-1 text-[11px] font-mono flex flex-wrap items-center justify-between gap-2 z-40 select-none">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.2 bg-[#FF3B30] text-black font-bold uppercase text-[9px] animate-pulse">
              CLOCK SKEW WARNING
            </span>
            <span>
              <strong>YOUR LAPTOP TIME IS OUT OF SYNC:</strong> Device clock is <strong>{timeSyncState.driftFormatted}</strong>. Market feeds & candlestick timestamps require synchronized system time.
            </span>
          </div>
          <button
            onClick={() => setShowTimeModal(true)}
            className="px-2 py-0.5 bg-[#FFB000] hover:bg-white text-black font-bold text-[10px] cursor-pointer transition-colors shrink-0"
          >
            HOW TO FIX CLOCK ↗
          </button>
        </div>
      )}

      <header className="w-full bg-[#000000] border-b border-[#2A2A2A] text-[11px] font-mono select-none px-2 py-1.5 flex flex-col gap-1">
        {/* Upper line: Branding, Command bar, Connection, Latency, Clocks */}
        <div className="flex items-center justify-between gap-3">
          {/* Logo / Terminal Title */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="bg-[#FFB000] text-[#000000] px-1.5 py-0.5 font-bold tracking-wider text-[11px]">
              TERMINAL
            </span>
            <span className="text-[#9A9A9A] hidden sm:inline text-[10px]">
              MARKET ANALYTICS
            </span>
          </div>

          {/* Command Bar Input Form */}
          <div className="relative flex-1 max-w-2xl">
            <form onSubmit={handleSubmit} className="relative flex items-center">
              <span className="text-[#FFB000] font-bold mr-1.5 select-none">&gt;</span>
              <input
                ref={inputRef}
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                onKeyDown={handleKeyDownInput}
                placeholder="ENTER COMMAND: <SYMBOL> <FUNC> (e.g. BTC GP, ETH OB, WL, HELP) | [/] or Ctrl+K"
                className="w-full bg-[#0A0A0A] border border-[#2A2A2A] focus:border-[#FFB000] text-[#FFB000] placeholder-[#666666] text-[11px] px-2 py-0.5 outline-none font-mono tracking-tight caret-[#FFB000]"
                spellCheck={false}
                autoComplete="off"
              />
              <span className="text-[#666666] absolute right-2 text-[10px] pointer-events-none">
                ENTER ↵
              </span>
            </form>

            {/* Autocomplete Dropdown */}
            {isFocused && suggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-full bg-[#0A0A0A] border border-[#FFB000] z-50 divide-y divide-[#2A2A2A] shadow-none">
                {suggestions.map((item) => (
                  <div
                    key={item.command}
                    onMouseDown={() => {
                      setCommandInput(item.command);
                      inputRef.current?.focus();
                    }}
                    className="px-2 py-1 flex items-center justify-between hover:bg-[#1A1A1A] cursor-pointer text-[11px]"
                  >
                    <span className="text-[#FFB000] font-bold">{item.command}</span>
                    <span className="text-[#9A9A9A] text-[10px]">{item.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Status Light & Latency & Clocks */}
          <div className="flex items-center gap-3 shrink-0 tabular-nums">
            <div className="flex items-center gap-1.5 text-[11px]">
              {getStatusBadge(connectionStatus)}
            </div>

            <div className="flex items-center gap-1 text-[#9A9A9A] text-[11px]">
              <span>LAT:</span>
              <span className={`font-bold ${latencyMs > 500 ? "text-[#FF3B30]" : latencyMs > 150 ? "text-[#FFB000]" : "text-[#00D26A]"}`}>
                {latencyMs > 0 ? `${latencyMs}ms` : "--"}
              </span>
            </div>

            <div className="flex items-center gap-2 border-l border-[#2A2A2A] pl-3 text-[#9A9A9A] text-[10px]">
              <span className="text-[#FFB000]">{istTime}</span>
              <span>|</span>
              <span>{utcTime}</span>
              {timeSyncState.isDesynced && (
                <button
                  onClick={() => setShowTimeModal(true)}
                  className="ml-1.5 px-1.5 py-0.5 bg-[#330000] hover:bg-[#FF3B30] text-[#FF3B30] hover:text-black border border-[#FF3B30] text-[9px] font-bold animate-pulse flex items-center gap-1 cursor-pointer"
                  title="Your laptop clock is incorrect. Click for sync instructions"
                >
                  <span>⚠️ SKEW ({timeSyncState.driftFormatted})</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Lower line: Function Keys Bar & Inline Errors */}
        <div className="flex items-center justify-between text-[10px] text-[#9A9A9A] border-t border-[#1A1A1A] pt-1">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            <span className="text-[#666666]">QUICK KEYS:</span>
            <button
              onClick={() => onExecuteCommand("WL", undefined, "watchlist")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F1: WL (Watchlist)
            </button>
            <button
              onClick={() => onExecuteCommand("GP", activeSymbol, "chart")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F2: GP (Chart)
            </button>
            <button
              onClick={() => onExecuteCommand("OB", activeSymbol, "orderbook")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F3: OB (Book)
            </button>
            <button
              onClick={() => onExecuteCommand("TS", activeSymbol, "trades")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F4: TS (Trades)
            </button>
            <button
              onClick={() => onExecuteCommand("VOL", activeSymbol, "analytics")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F5: VOL
            </button>
            <button
              onClick={() => onExecuteCommand("BT", activeSymbol, "analytics")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F6: BT
            </button>
            <button
              onClick={() => onExecuteCommand("METRICS", undefined, "metrics")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F7: METRICS
            </button>
            <button
              onClick={() => onExecuteCommand("HELP", undefined, "help")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F8: HELP
            </button>
            <button
              onClick={() => onExecuteCommand("OFI", activeSymbol, "microstructure")}
              className="hover:text-[#FFB000] hover:bg-[#1A1A1A] px-1 border border-[#2A2A2A]"
            >
              F9: OFI
            </button>
            <button
              onClick={() => onExecuteCommand("DES", activeSymbol, "company_des")}
              className="hover:text-black hover:bg-[#FFB000] text-[#FFB000] font-bold px-1.5 border border-[#FFB000]/60 bg-[#1A1500]"
            >
              F10: DES (Profile)
            </button>
          </div>

          {/* Inline Command Error Message */}
          {commandError && (
            <div className="text-[#FF3B30] bg-[#220000] border border-[#FF3B30] px-2 py-0.5 text-[10px] font-bold">
              ERROR: {commandError}
            </div>
          )}
        </div>
      </header>

      {/* Clock Diagnostic & Windows Sync Instructions Modal */}
      {showTimeModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0B0B0B] border-2 border-[#FF6D00] max-w-xl w-full p-5 text-xs font-mono shadow-2xl flex flex-col gap-4 text-[#E0E0E0]">
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-2.5">
              <span className="text-[#FF6D00] font-bold text-sm flex items-center gap-2">
                <span>⚠️</span> SYSTEM CLOCK SKEW & TIMEZONE DIAGNOSTIC
              </span>
              <button
                onClick={() => setShowTimeModal(false)}
                className="text-[#9A9A9A] hover:text-white px-2 py-0.5 bg-[#1A1A1A] border border-[#333333] cursor-pointer"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Diagnostic Box */}
            <div className="bg-[#140800] border border-[#FF6D00]/50 p-3 rounded text-[#FFB000] flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#999999]">Your Laptop Clock Time:</span>
                <strong className="text-[#FF3B30]">{new Date().toLocaleString()}</strong>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#999999]">Authoritative Real Network Time:</span>
                <strong className="text-[#00E676]">{timeSync.getAccurateNow().toLocaleString()}</strong>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#999999]">Calculated Time Skew / Drift:</span>
                <strong className="text-[#FFB000] font-bold">{timeSyncState.driftFormatted}</strong>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#999999]">Detected System Timezone:</span>
                <strong className="text-[#00E5FF]">{timeSyncState.userTimezone}</strong>
              </div>
            </div>

            {/* Step-by-Step Instructions */}
            <div className="flex flex-col gap-2.5 bg-[#0F0F0F] border border-[#222222] p-3 rounded">
              <span className="text-[#FFB000] font-bold border-b border-[#222222] pb-1">
                LAPTOP TIME KAISE SAHI KAREIN (WINDOWS 10 / 11):
              </span>
              <ol className="list-decimal list-inside space-y-1.5 text-[#CCCCCC] text-[11px] leading-relaxed">
                <li>
                  Keyboard par <kbd className="px-1.5 py-0.5 bg-[#222222] border border-[#444444] text-[#FFB000] rounded">Win + I</kbd> dabakar <strong>Windows Settings</strong> kholein.
                </li>
                <li>
                  Left menu me <strong>Time & Language</strong> par click karein, fir <strong>Date & Time</strong> select karein.
                </li>
                <li>
                  Check karein ki <strong>&quot;Set time automatically&quot;</strong> switch <strong>ON</strong> hai.
                </li>
                <li>
                  Niche <em>&quot;Synchronize your clock&quot;</em> ke aage bane <strong>&quot;Sync now&quot;</strong> button par click karein.
                </li>
                <li>
                  Apna Time zone check karein: <em>&quot;(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi&quot;</em> hona chahiye.
                </li>
              </ol>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-[#2A2A2A]">
              <button
                onClick={async () => {
                  await timeSync.checkTimeSync();
                }}
                className="px-3 py-1 bg-[#1A1A1A] hover:bg-[#FFB000] hover:text-black border border-[#333333] font-bold text-[#FFB000] cursor-pointer transition-colors"
              >
                RE-CHECK TIME SYNC ⟳
              </button>
              <button
                onClick={() => setShowTimeModal(false)}
                className="px-4 py-1 bg-[#FFB000] text-black font-bold hover:bg-white cursor-pointer transition-colors"
              >
                THEEK HAI (CLOSE)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
