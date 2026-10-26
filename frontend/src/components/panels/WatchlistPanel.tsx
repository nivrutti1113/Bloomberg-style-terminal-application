"use client";

import React, { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTerminalStore } from "@/store/terminalStore";
import { Sparkline } from "@/components/common/Sparkline";

export const WatchlistPanel: React.FC = () => {
  const {
    symbols,
    marketPrices,
    activeSymbol,
    setActiveSymbol,
    removeSymbol,
    connectionStatus,
  } = useTerminalStore();

  const [marketFilter, setMarketFilter] = useState<"ALL" | "CRYPTO" | "NSE">("ALL");
  const parentRef = useRef<HTMLDivElement | null>(null);

  const isNseSymbol = (s: string) => !s.endsWith("USDT") && !s.includes("/");

  const filteredSymbols = symbols.filter((s) => {
    if (marketFilter === "CRYPTO") return !isNseSymbol(s);
    if (marketFilter === "NSE") return isNseSymbol(s);
    return true;
  });

  const rowVirtualizer = useVirtualizer({
    count: filteredSymbols.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24, // High-density row height
    overscan: 5,
  });

  const isStale = connectionStatus === "STALE";

  return (
    <div
      className={`w-full h-full bg-[#0A0A0A] flex flex-col font-mono text-[11px] select-none ${
        isStale ? "opacity-50 transition-opacity" : ""
      }`}
    >
      {/* Watchlist Header */}
      <div className="bg-[#141414] border-b border-[#2A2A2A] px-2 py-1 flex items-center justify-between text-[#9A9A9A] text-[10px] tracking-wider uppercase">
        <div className="flex items-center gap-2">
          <span className="text-[#FFB000] font-bold">WATCHLIST (WL)</span>
          <span>[{filteredSymbols.length} ASSETS]</span>
        </div>

        {/* Market Filter */}
        <div className="flex items-center gap-1">
          {(["ALL", "CRYPTO", "NSE"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMarketFilter(m)}
              className={`px-1.5 py-0.2 border text-[9px] ${
                marketFilter === m
                  ? "bg-[#FFB000] text-black font-bold border-[#FFB000]"
                  : "bg-[#0A0A0A] text-[#9A9A9A] border-[#2A2A2A] hover:text-white"
              }`}
            >
              {m}
            </button>
          ))}
          {isStale && (
            <span className="text-[#FF3B30] font-bold bg-[#330000] px-1 border border-[#FF3B30] ml-2">
              STALE
            </span>
          )}
        </div>
      </div>

      {/* Table Column Headers */}
      <div className="grid grid-cols-12 bg-[#000000] border-b border-[#2A2A2A] text-[#9A9A9A] text-[10px] px-2 py-1 font-semibold uppercase">
        <div className="col-span-3 text-left">SYMBOL / VENUE</div>
        <div className="col-span-2 text-right">LAST</div>
        <div className="col-span-2 text-right">CHG (24H)</div>
        <div className="col-span-1 text-right">CHG %</div>
        <div className="col-span-2 text-right">24H HIGH / LOW</div>
        <div className="col-span-2 text-center">TREND (30T)</div>
      </div>

      {/* Virtualized Table Body */}
      <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-[#1A1A1A]">
        {filteredSymbols.length === 0 ? (
          <div className="p-4 text-center text-[#9A9A9A]">
            WATCHLIST EMPTY. TYPE <span className="text-[#FFB000]">ADD &lt;SYMBOL&gt;</span> IN COMMAND BAR TO ADD.
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const symbol = filteredSymbols[virtualRow.index];
              const data = marketPrices[symbol];
              const isSelected = symbol === activeSymbol;
              const isNse = isNseSymbol(symbol);

              // Calculate tick flash classes
              const now = Date.now();
              const isFlashing = data?.flashTimestamp && now - data.flashTimestamp < 350;
              let flashBg = "";
              if (isFlashing) {
                flashBg =
                  data?.flashDirection === "up"
                    ? "bg-[#00D26A]/30 text-[#00D26A]"
                    : "bg-[#FF3B30]/30 text-[#FF3B30]";
              }

              const isPositive = (data?.change_24h ?? 0) >= 0;

              return (
                <div
                  key={symbol}
                  onClick={() => setActiveSymbol(symbol)}
                  className={`grid grid-cols-12 items-center px-2 py-0.5 cursor-pointer text-[11px] tabular-nums transition-colors duration-150 ${
                    isSelected ? "bg-[#1C1A0E] border-l-2 border-[#FFB000]" : "hover:bg-[#141414]"
                  }`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {/* Symbol & Venue Badge */}
                  <div className="col-span-3 flex items-center gap-1.5 pr-2">
                    <span className="font-bold text-[#FFB000]">{symbol}</span>
                    <span
                      className={`text-[8px] px-1 py-0.2 border ${
                        isNse
                          ? "bg-[#1B1705] text-[#FFB000] border-[#FFB000]/40"
                          : "bg-[#0E1520] text-[#2D9CDB] border-[#2D9CDB]/40"
                      }`}
                    >
                      {isNse ? "NSE" : "BINANCE"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSymbol(symbol);
                      }}
                      title="Remove from watchlist"
                      className="opacity-20 hover:opacity-100 text-[#9A9A9A] hover:text-[#FF3B30] text-[9px] px-1 ml-auto"
                    >
                      ×
                    </button>
                  </div>

                  {/* Last Price (with Flash or NO DATA) */}
                  <div className={`col-span-2 text-right pr-2 font-bold ${flashBg}`}>
                    {data?.price !== undefined ? (
                      data.price >= 10
                        ? data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : data.price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 })
                    ) : (
                      <span className="text-[#666666] text-[9px]">{isNse ? "NO DATA (OFFLINE)" : "NO DATA"}</span>
                    )}
                  </div>

                  {/* 24h Change */}
                  <div
                    className={`col-span-2 text-right pr-2 ${
                      isPositive ? "text-[#00D26A]" : "text-[#FF3B30]"
                    }`}
                  >
                    {data?.change_24h !== undefined ? (
                      `${isPositive ? "+" : ""}${data.change_24h.toFixed(2)}`
                    ) : (
                      <span className="text-[#666666]">--</span>
                    )}
                  </div>

                  {/* 24h Change % */}
                  <div
                    className={`col-span-1 text-right pr-2 font-semibold ${
                      isPositive ? "text-[#00D26A]" : "text-[#FF3B30]"
                    }`}
                  >
                    {data?.change_pct_24h !== undefined ? (
                      `${isPositive ? "+" : ""}${data.change_pct_24h.toFixed(2)}%`
                    ) : (
                      <span className="text-[#666666]">--</span>
                    )}
                  </div>

                  {/* High / Low */}
                  <div className="col-span-2 text-right pr-2 text-[#9A9A9A] text-[10px]">
                    {data?.high_24h !== undefined && data?.low_24h !== undefined ? (
                      <span>
                        <span className="text-[#00D26A]">{data.high_24h.toFixed(1)}</span> /{" "}
                        <span className="text-[#FF3B30]">{data.low_24h.toFixed(1)}</span>
                      </span>
                    ) : (
                      <span className="text-[#666666]">-- / --</span>
                    )}
                  </div>

                  {/* Sparkline Canvas */}
                  <div className="col-span-2 flex justify-center items-center">
                    <Sparkline
                      data={data?.priceHistory || []}
                      width={70}
                      height={16}
                      isPositive={isPositive}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Watchlist Footer Summary */}
      <div className="bg-[#141414] border-t border-[#2A2A2A] px-2 py-0.5 flex items-center justify-between text-[#9A9A9A] text-[10px]">
        <span>SELECT ROW TO SET ACTIVE TERMINAL SYMBOL</span>
        <span className="text-[#FFB000]">ACTIVE: {activeSymbol}</span>
      </div>
    </div>
  );
};
