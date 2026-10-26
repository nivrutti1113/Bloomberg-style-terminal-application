"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTerminalStore } from "@/store/terminalStore";
import { wsManager } from "@/lib/ws/wsManager";
import { Tick } from "@/types/market";

interface TimeAndSalesPanelProps {
  symbol?: string;
}

interface TradeTapeItem extends Tick {
  id: string;
  side: "BUY" | "SELL";
  notional: number;
}

const MAX_TAPE_ITEMS = 500;

export const TimeAndSalesPanel: React.FC<TimeAndSalesPanelProps> = ({ symbol }) => {
  const { activeSymbol, connectionStatus } = useTerminalStore();
  const targetSymbol = (symbol || activeSymbol).toUpperCase();

  const [tradesBySymbol, setTradesBySymbol] = useState<Record<string, TradeTapeItem[]>>({});
  const [sizeFilter, setSizeFilter] = useState<number>(0); // 0 = all, 1000, 10000, 50000
  const lastPriceRef = useRef<number | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);

  // Filter trades based on user-selected threshold
  const filteredTrades = useMemo(() => {
    const raw = tradesBySymbol[targetSymbol] || [];
    if (sizeFilter === 0) return raw;
    return raw.filter((t) => t.notional >= sizeFilter);
  }, [tradesBySymbol, targetSymbol, sizeFilter]);

  // Virtualized row scrolling for smooth 60fps trade ingestion
  const rowVirtualizer = useVirtualizer({
    count: filteredTrades.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20, // High-density row height
    overscan: 10,
  });

  useEffect(() => {
    lastPriceRef.current = null;

    const unsubscribe = wsManager.subscribeTicks((ticks: Tick[]) => {
      const relevant = ticks.filter((t) => t.symbol.toUpperCase() === targetSymbol);
      if (relevant.length === 0) return;

      const newItems: TradeTapeItem[] = [];

      for (const t of relevant) {
        let side: "BUY" | "SELL" = "BUY";
        if (lastPriceRef.current !== null) {
          side = t.price >= lastPriceRef.current ? "BUY" : "SELL";
        }
        lastPriceRef.current = t.price;

        const notional = t.price * t.qty;

        newItems.push({
          ...t,
          id: `${t.exch_ts_ms}-${Math.random()}`,
          side,
          notional,
        });
      }

      setTradesBySymbol((prev) => {
        const current = prev[targetSymbol] || [];
        return {
          ...prev,
          [targetSymbol]: [...newItems, ...current].slice(0, MAX_TAPE_ITEMS),
        };
      });
    });

    return () => unsubscribe();
  }, [targetSymbol]);

  const isStale = connectionStatus === "STALE";

  return (
    <div className={`w-full h-full bg-[#0A0A0A] flex flex-col font-mono text-[11px] select-none ${isStale ? "opacity-50" : ""}`}>
      {/* Tape Header */}
      <div className="bg-[#141414] border-b border-[#2A2A2A] px-2 py-1 flex items-center justify-between text-[#9A9A9A]">
        <div className="flex items-center gap-2">
          <span className="text-[#FFB000] font-bold text-[12px]">{targetSymbol} TS</span>
          <span className="text-[10px] text-[#666666]">[TRADE TAPE]</span>
        </div>

        {/* Size Filter Selector */}
        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-[#666666] text-[9px]">MIN:</span>
          {[
            { label: "ALL", val: 0 },
            { label: ">$1K", val: 1000 },
            { label: ">$10K", val: 10000 },
            { label: ">$50K", val: 50000 },
          ].map((f) => (
            <button
              key={f.val}
              onClick={() => setSizeFilter(f.val)}
              className={`px-1.5 py-0.2 border ${
                sizeFilter === f.val
                  ? "bg-[#FFB000] text-black font-bold border-[#FFB000]"
                  : "bg-[#0A0A0A] text-[#9A9A9A] border-[#2A2A2A] hover:text-[#FFB000]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-12 bg-[#000000] border-b border-[#2A2A2A] text-[#9A9A9A] text-[9px] px-2 py-1 uppercase font-semibold">
        <div className="col-span-3 text-left">TIME (UTC)</div>
        <div className="col-span-3 text-right">PRICE (USD)</div>
        <div className="col-span-3 text-right">QTY</div>
        <div className="col-span-3 text-right">NOTIONAL ($)</div>
      </div>

      {/* Virtualized Tape Body */}
      <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-[#141414]">
        {filteredTrades.length === 0 ? (
          <div className="p-4 text-center text-[#666666]">
            WAITING FOR LIVE EXECUTIONS FOR {targetSymbol}...
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
              const item = filteredTrades[virtualRow.index];
              const timeStr = new Date(item.exch_ts_ms).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              const ms = String(item.exch_ts_ms % 1000).padStart(3, "0");
              const isWhale = item.notional >= 50000;
              const isLarge = item.notional >= 10000;

              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-12 px-2 py-0.5 text-[10px] tabular-nums items-center ${
                    isWhale
                      ? "bg-[#2A2000] font-bold border-l-2 border-[#FFB000]"
                      : isLarge
                      ? "bg-[#181506] font-semibold"
                      : "hover:bg-[#121212]"
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
                  <div className="col-span-3 text-[#9A9A9A] text-[9px]">
                    {timeStr}.{ms}
                  </div>
                  <div
                    className={`col-span-3 text-right font-bold ${
                      item.side === "BUY" ? "text-[#00D26A]" : "text-[#FF3B30]"
                    }`}
                  >
                    {item.price >= 10
                      ? item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : item.price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}
                  </div>
                  <div className="col-span-3 text-right text-white">
                    {item.qty >= 100 ? item.qty.toFixed(2) : item.qty.toFixed(4)}
                  </div>
                  <div className="col-span-3 text-right text-[#9A9A9A]">
                    ${Math.round(item.notional).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tape Footer */}
      <div className="bg-[#141414] border-t border-[#2A2A2A] px-2 py-0.5 flex items-center justify-between text-[#666666] text-[9px] tabular-nums">
        <span>BUFFER: {filteredTrades.length} / {MAX_TAPE_ITEMS} TRADES</span>
        <span className="text-[#FFB000]">AMBER = &gt;$10K | BRIGHT AMBER = &gt;$50K</span>
      </div>
    </div>
  );
};
