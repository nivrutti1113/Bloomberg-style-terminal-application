"use client";

import React, { useEffect, useState } from "react";
import { useTerminalStore } from "@/store/terminalStore";
import { wsManager } from "@/lib/ws/wsManager";
import { OrderBookData } from "@/types/market";

interface OrderBookPanelProps {
  symbol?: string;
}

export const OrderBookPanel: React.FC<OrderBookPanelProps> = ({ symbol }) => {
  const { activeSymbol, connectionStatus } = useTerminalStore();
  const targetSymbol = (symbol || activeSymbol).toUpperCase();

  const [bookData, setBookData] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    // Fetch initial REST snapshot for instant data
    const fetchSnapshot = async () => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${targetSymbol}&limit=20`);
        if (res.ok && isMounted) {
          const raw = await res.json();
          let cumBid = 0;
          const bids: [number, number, number][] = (raw.bids || []).map((b: [string, string]) => {
            const p = parseFloat(b[0]);
            const q = parseFloat(b[1]);
            cumBid += q;
            return [p, q, cumBid];
          });

          let cumAsk = 0;
          const asks: [number, number, number][] = (raw.asks || []).map((a: [string, string]) => {
            const p = parseFloat(a[0]);
            const q = parseFloat(a[1]);
            cumAsk += q;
            return [p, q, cumAsk];
          });

          const bestBid = bids[0]?.[0] || 0;
          const bestAsk = asks[0]?.[0] || 0;
          const spread = bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
          const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
          const spreadBps = mid > 0 ? (spread / mid) * 10000 : 0;
          const totalVol = cumBid + cumAsk;
          const imbalance = totalVol > 0 ? ((cumBid - cumAsk) / totalVol) * 100 : 0;

          setBookData({
            symbol: targetSymbol,
            last_update_id: raw.lastUpdateId,
            bids,
            asks,
            spread: Number(spread.toFixed(4)),
            spread_bps: Number(spreadBps.toFixed(2)),
            mid_price: Number(mid.toFixed(4)),
            imbalance_pct: Number(imbalance.toFixed(2)),
            timestamp_ms: Date.now(),
          });
          setLoading(false);
        }
      } catch {
        // Fallback continues
      }
    };

    fetchSnapshot();

    // Subscribe to live 100ms depth stream via wsManager
    const unsubscribe = wsManager.subscribeOrderBook(targetSymbol, (data) => {
      if (isMounted) {
        setBookData(data);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [targetSymbol]);

  const isStale = connectionStatus === "STALE";

  // Compute maximum cumulative volume for depth percentage bars
  const maxBidDepth = bookData?.bids.length ? bookData.bids[bookData.bids.length - 1][2] : 1;
  const maxAskDepth = bookData?.asks.length ? bookData.asks[bookData.asks.length - 1][2] : 1;
  const maxTotalDepth = Math.max(maxBidDepth, maxAskDepth, 1);

  // Asks are displayed in reverse order (highest ask at top down to lowest/best ask near mid)
  const displayAsks = bookData?.asks ? [...bookData.asks].reverse().slice(0, 15) : [];
  const displayBids = bookData?.bids ? bookData.bids.slice(0, 15) : [];

  const bidRatio = bookData
    ? Math.max(5, Math.min(95, 50 + (bookData.imbalance_pct / 2)))
    : 50;

  return (
    <div className={`w-full h-full bg-[#0A0A0A] flex flex-col font-mono text-[11px] select-none ${isStale ? "opacity-50" : ""}`}>
      {/* Header Bar */}
      <div className="bg-[#141414] border-b border-[#2A2A2A] px-2 py-1 flex items-center justify-between text-[#9A9A9A]">
        <div className="flex items-center gap-2">
          <span className="text-[#FFB000] font-bold text-[12px]">{targetSymbol} OB</span>
          <span className="text-[10px] text-[#666666]">[TOP 20 LADDER]</span>
          {loading && <span className="text-[#FFB000] text-[10px] animate-pulse">[SYNCING...]</span>}
        </div>

        {/* Spread & Mid Info */}
        <div className="flex items-center gap-3 text-[10px] tabular-nums">
          <div>
            <span className="text-[#666666]">SPREAD: </span>
            <span className="text-[#00D26A] font-bold">
              {bookData ? (bookData.spread >= 10 ? bookData.spread.toFixed(2) : bookData.spread.toFixed(4)) : "--"}
            </span>
            <span className="text-[#9A9A9A] ml-1">
              ({bookData ? `${bookData.spread_bps.toFixed(1)} bps` : "--"})
            </span>
          </div>

          <div>
            <span className="text-[#666666]">MID: </span>
            <span className="text-[#FFB000] font-bold">
              {bookData ? (bookData.mid_price >= 10 ? bookData.mid_price.toFixed(2) : bookData.mid_price.toFixed(4)) : "--"}
            </span>
          </div>
        </div>
      </div>

      {/* Imbalance Meter */}
      <div className="bg-[#000000] border-b border-[#2A2A2A] px-2 py-0.5 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-2 w-full">
          <span className="text-[#666666] shrink-0 text-[9px]">IMBALANCE:</span>
          <div className="flex-1 h-2 bg-[#1A1A1A] relative overflow-hidden flex">
            <div
              style={{ width: `${bidRatio}%` }}
              className="h-full bg-[#00D26A]/70 transition-all duration-100"
            />
            <div
              style={{ width: `${100 - bidRatio}%` }}
              className="h-full bg-[#FF3B30]/70 transition-all duration-100"
            />
          </div>
          <span
            className={`font-bold tabular-nums shrink-0 text-[9px] ${
              (bookData?.imbalance_pct || 0) >= 0 ? "text-[#00D26A]" : "text-[#FF3B30]"
            }`}
          >
            {bookData ? `${bookData.imbalance_pct >= 0 ? "+" : ""}${bookData.imbalance_pct.toFixed(1)}%` : "--"}
          </span>
        </div>
      </div>

      {/* Table Column Header */}
      <div className="grid grid-cols-12 bg-[#000000] border-b border-[#2A2A2A] text-[#9A9A9A] text-[9px] px-2 py-0.5 uppercase font-semibold">
        <div className="col-span-4 text-left">PRICE (USD)</div>
        <div className="col-span-4 text-right">SIZE</div>
        <div className="col-span-4 text-right">TOTAL</div>
      </div>

      {/* Main Order Ladder */}
      <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col justify-between divide-y divide-[#161616]">
        {/* ASKS (Sells) */}
        <div className="flex flex-col justify-end">
          {displayAsks.map(([price, qty, total]) => {
            const depthPct = Math.min(100, Math.max(2, (total / maxTotalDepth) * 100));

            return (
              <div
                key={`ask-${price}`}
                className="grid grid-cols-12 px-2 py-0.5 text-[10px] tabular-nums relative hover:bg-[#1A1A1A]"
              >
                {/* Horizontal Depth Bar */}
                <div
                  style={{ width: `${depthPct}%` }}
                  className="absolute right-0 top-0 bottom-0 bg-[#FF3B30]/15 pointer-events-none transition-all duration-75"
                />

                <div className="col-span-4 text-left font-bold text-[#FF3B30] relative z-10">
                  {price >= 10 ? price.toFixed(2) : price.toFixed(4)}
                </div>
                <div className="col-span-4 text-right text-white relative z-10">
                  {qty.toFixed(4)}
                </div>
                <div className="col-span-4 text-right text-[#9A9A9A] relative z-10">
                  {total.toFixed(3)}
                </div>
              </div>
            );
          })}
        </div>

        {/* SPREAD / MID BAR (Centered Separator) */}
        <div className="bg-[#141414] border-y border-[#2A2A2A] px-2 py-1 flex items-center justify-between text-[11px] tabular-nums font-bold">
          <div className="flex items-center gap-2">
            <span className="text-[#666666] text-[10px]">MID:</span>
            <span className="text-[#FFB000]">
              {bookData ? (bookData.mid_price >= 10 ? bookData.mid_price.toFixed(2) : bookData.mid_price.toFixed(4)) : "--"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[#9A9A9A]">
            <span>SPREAD:</span>
            <span className="text-white">
              {bookData ? (bookData.spread >= 10 ? bookData.spread.toFixed(2) : bookData.spread.toFixed(4)) : "--"}
            </span>
          </div>
        </div>

        {/* BIDS (Buys) */}
        <div className="flex flex-col justify-start">
          {displayBids.map(([price, qty, total]) => {
            const depthPct = Math.min(100, Math.max(2, (total / maxTotalDepth) * 100));

            return (
              <div
                key={`bid-${price}`}
                className="grid grid-cols-12 px-2 py-0.5 text-[10px] tabular-nums relative hover:bg-[#1A1A1A]"
              >
                {/* Horizontal Depth Bar */}
                <div
                  style={{ width: `${depthPct}%` }}
                  className="absolute right-0 top-0 bottom-0 bg-[#00D26A]/15 pointer-events-none transition-all duration-75"
                />

                <div className="col-span-4 text-left font-bold text-[#00D26A] relative z-10">
                  {price >= 10 ? price.toFixed(2) : price.toFixed(4)}
                </div>
                <div className="col-span-4 text-right text-white relative z-10">
                  {qty.toFixed(4)}
                </div>
                <div className="col-span-4 text-right text-[#9A9A9A] relative z-10">
                  {total.toFixed(3)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Status */}
      <div className="bg-[#141414] border-t border-[#2A2A2A] px-2 py-0.5 flex items-center justify-between text-[#666666] text-[9px] tabular-nums">
        <span>UPDATE_ID: {bookData?.last_update_id || "--"}</span>
        <span>DEPTH_LEVELS: {bookData ? `${bookData.bids.length}B / ${bookData.asks.length}A` : "0"}</span>
      </div>
    </div>
  );
};
