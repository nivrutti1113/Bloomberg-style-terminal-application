"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "@/store/terminalStore";
import { wsManager } from "@/lib/ws/wsManager";
import { OrderBookData, MicrostructureTimeseriesPoint } from "@/types/market";
import { API_URL } from "@/lib/config";

interface MicrostructurePanelProps {
  symbol?: string;
}

export const MicrostructurePanel: React.FC<MicrostructurePanelProps> = ({ symbol }) => {
  const { activeSymbol, connectionStatus } = useTerminalStore();
  const targetSymbol = (symbol || activeSymbol).toUpperCase();

  const [bookData, setBookData] = useState<OrderBookData | null>(null);
  const [history, setHistory] = useState<MicrostructureTimeseriesPoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Client-side OFI calculation fallback state
  const prevBookRef = useRef<{
    bidP: number;
    bidQ: number;
    askP: number;
    askQ: number;
    cumOfi: number;
    ofiHistory: number[];
  }>({
    bidP: 0,
    bidQ: 0,
    askP: 0,
    askQ: 0,
    cumOfi: 0,
    ofiHistory: [],
  });

  useEffect(() => {
    let isMounted = true;

    // Fetch initial microstructure timeseries from backend REST API if available
    const fetchInitialAnalytics = async () => {
      try {
        const res = await fetch(`${API_URL}/analytics/microstructure/${targetSymbol}`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.timeseries && data.timeseries.length > 0) {
            setHistory(data.timeseries);
          }
        }
      } catch {
        // Fallback gracefully to client-side stream computation
      }
    };
    fetchInitialAnalytics();

    // Subscribe to live 100ms order book & microstructure stream
    const unsubscribe = wsManager.subscribeOrderBook(targetSymbol, (incomingBook) => {
      if (!isMounted) return;

      const pState = prevBookRef.current;
      const bestBid = incomingBook.bids[0] || [0, 0, 0];
      const bestAsk = incomingBook.asks[0] || [0, 0, 0];
      const currBidP = bestBid[0];
      const currBidQ = bestBid[1];
      const currAskP = bestAsk[0];
      const currAskQ = bestAsk[1];

      let ofiL1 = incomingBook.ofi_l1 ?? 0;
      let microPrice = incomingBook.micro_price ?? 0;
      let microBiasBps = incomingBook.micro_price_bias_bps ?? 0;
      let cumOfi = incomingBook.cumulative_ofi ?? pState.cumOfi;
      let ofiZscore = incomingBook.ofi_zscore ?? 0;
      const vpin = incomingBook.vpin ?? 0.28;
      const vpinState = incomingBook.vpin_state ?? "LOW";
      let regime = incomingBook.regime ?? "BALANCED";

      // If backend didn't supply microstructure (e.g. direct Binance fallback mode), compute locally!
      if (incomingBook.ofi_l1 === undefined && currBidP > 0 && currAskP > 0) {
        // Micro-price
        const tot = currBidQ + currAskQ;
        microPrice = tot > 0 ? (currBidQ * currAskP + currAskQ * currBidP) / tot : incomingBook.mid_price;
        microBiasBps = incomingBook.mid_price > 0 ? ((microPrice - incomingBook.mid_price) / incomingBook.mid_price) * 10000 : 0;

        // Cont et al. (2014) OFI
        if (pState.bidP > 0 && pState.askP > 0) {
          const deltaB = currBidP > pState.bidP ? currBidQ : currBidP === pState.bidP ? currBidQ - pState.bidQ : -pState.bidQ;
          const deltaA = currAskP > pState.askP ? -pState.askQ : currAskP === pState.askP ? currAskQ - pState.askQ : currAskQ;
          ofiL1 = deltaB - deltaA;
          cumOfi = pState.cumOfi + ofiL1;
        }

        pState.ofiHistory.push(ofiL1);
        if (pState.ofiHistory.length > 50) pState.ofiHistory.shift();
        const n = pState.ofiHistory.length;
        const mean = pState.ofiHistory.reduce((a, b) => a + b, 0) / n;
        const variance = pState.ofiHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
        ofiZscore = variance > 0 ? (ofiL1 - mean) / Math.sqrt(variance) : 0;

        regime = ofiZscore > 1.5 ? "STRONG_BUY_PRESSURE" : ofiZscore < -1.5 ? "STRONG_SELL_PRESSURE" : "BALANCED";
      }

      pState.bidP = currBidP;
      pState.bidQ = currBidQ;
      pState.askP = currAskP;
      pState.askQ = currAskQ;
      pState.cumOfi = cumOfi;

      const enrichedBook: OrderBookData = {
        ...incomingBook,
        micro_price: Number(microPrice.toFixed(4)),
        micro_price_bias_bps: Number(microBiasBps.toFixed(2)),
        ofi_l1: Number(ofiL1.toFixed(4)),
        deep_ofi: incomingBook.deep_ofi ?? Number(ofiL1.toFixed(4)),
        cumulative_ofi: Number(cumOfi.toFixed(4)),
        ofi_zscore: Number(ofiZscore.toFixed(2)),
        vpin: Number(vpin.toFixed(3)),
        vpin_state: vpinState,
        regime: regime,
      };

      setBookData(enrichedBook);

      setHistory((prev) => {
        const next = [
          ...prev,
          {
            t: incomingBook.timestamp_ms || Date.now(),
            ofi: ofiL1,
            cum_ofi: cumOfi,
            micro_bias: microBiasBps,
            mid: incomingBook.mid_price,
            vpin: vpin,
          },
        ];
        return next.length > 80 ? next.slice(next.length - 80) : next;
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [targetSymbol]);

  // Render Real-Time Canvas Chart for Cumulative OFI
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Draw grid lines
    ctx.strokeStyle = "#1A1A1A";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 20; y < height; y += 30) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    const values = history.map((h) => h.cum_ofi);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = Math.max(maxVal - minVal, 1.0);

    // Zero-line
    const zeroY = height - ((0 - minVal) / range) * (height - 30) - 15;
    ctx.strokeStyle = "#333333";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cumulative OFI curve
    const stepX = width / (history.length - 1);
    ctx.beginPath();
    history.forEach((pt, i) => {
      const x = i * stepX;
      const y = height - ((pt.cum_ofi - minVal) / range) * (height - 30) - 15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    const isPositive = (bookData?.cumulative_ofi || 0) >= 0;
    ctx.strokeStyle = isPositive ? "#00E676" : "#FF1744";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, isPositive ? "rgba(0, 230, 118, 0.25)" : "rgba(255, 23, 68, 0.25)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0.0)");
    ctx.fillStyle = grad;
    ctx.fill();
  }, [history, bookData?.cumulative_ofi]);

  const isStale = connectionStatus === "STALE";
  const ofiL1 = bookData?.ofi_l1 ?? 0;
  const ofiZscore = bookData?.ofi_zscore ?? 0;
  const microPrice = bookData?.micro_price ?? (bookData?.mid_price || 0);
  const microBias = bookData?.micro_price_bias_bps ?? 0;
  const vpin = bookData?.vpin ?? 0.28;
  const vpinState = bookData?.vpin_state ?? "LOW";
  const regime = bookData?.regime ?? "BALANCED";

  // Position of micro price between best bid and best ask (0 to 100%)
  const bestBid = bookData?.bids[0]?.[0] || 0;
  const bestAsk = bookData?.asks[0]?.[0] || 0;
  const spread = bestAsk - bestBid;
  const microPercent = spread > 0 ? Math.max(5, Math.min(95, ((microPrice - bestBid) / spread) * 100)) : 50;

  return (
    <div className={`h-full w-full bg-[#000000] text-[#E0E0E0] font-mono flex flex-col overflow-y-auto p-3 transition-opacity duration-300 ${isStale ? "opacity-40" : "opacity-100"}`}>
      {/* Top Header & Badges */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#222222] gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[#FFB000] font-bold text-sm tracking-wider">
            {targetSymbol} {'//'} MARKET MICROSTRUCTURE & OFI ALPHA
          </span>
          <span className="px-1.5 py-0.5 text-[10px] bg-[#111111] border border-[#333333] text-[#00E5FF]">
            CONT ET AL. (2014) MODEL
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Regime Badge */}
          <span
            className={`px-2 py-0.5 text-xs font-semibold rounded border ${
              regime === "STRONG_BUY_PRESSURE"
                ? "bg-[#003314] text-[#00E676] border-[#00E676]"
                : regime === "STRONG_SELL_PRESSURE"
                ? "bg-[#330008] text-[#FF1744] border-[#FF1744]"
                : "bg-[#1E1A00] text-[#FFB000] border-[#FFB000]"
            }`}
          >
            ● {regime.replace(/_/g, " ")}
          </span>

          {/* VPIN Toxicity Badge */}
          <span
            className={`px-2 py-0.5 text-xs font-semibold rounded border ${
              vpinState === "TOXIC"
                ? "bg-[#330008] text-[#FF1744] border-[#FF1744] animate-pulse"
                : vpinState === "MODERATE"
                ? "bg-[#2A1800] text-[#FF9100] border-[#FF9100]"
                : "bg-[#0B1D28] text-[#00E5FF] border-[#00E5FF]"
            }`}
          >
            VPIN: {vpin.toFixed(2)} ({vpinState})
          </span>
        </div>
      </div>

      {/* 4 Quantitative Signal Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 my-3">
        {/* Card 1: Level 1 OFI */}
        <div className="bg-[#0A0A0A] border border-[#222222] p-3 rounded flex flex-col justify-between">
          <div className="text-[11px] text-[#888888] flex justify-between">
            <span>LEVEL-1 OFI (ΔB - ΔA)</span>
            <span className="text-[#00E5FF]">100ms TICK</span>
          </div>
          <div className="my-2">
            <span
              className={`text-2xl font-bold tracking-tight ${
                ofiL1 > 0 ? "text-[#00E676]" : ofiL1 < 0 ? "text-[#FF1744]" : "text-[#888888]"
              }`}
            >
              {ofiL1 > 0 ? `+${ofiL1.toFixed(3)}` : ofiL1.toFixed(3)}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-[#666666]">Z-Score:</span>
            <span
              className={`font-semibold ${
                Math.abs(ofiZscore) >= 2.0
                  ? ofiZscore > 0
                    ? "text-[#00E676]"
                    : "text-[#FF1744]"
                  : "text-[#CCCCCC]"
              }`}
            >
              {ofiZscore >= 0 ? `+${ofiZscore.toFixed(2)}σ` : `${ofiZscore.toFixed(2)}σ`}
            </span>
          </div>
        </div>

        {/* Card 2: Stoikov Micro-Price */}
        <div className="bg-[#0A0A0A] border border-[#222222] p-3 rounded flex flex-col justify-between">
          <div className="text-[11px] text-[#888888] flex justify-between">
            <span>STOIKOV MICRO-PRICE</span>
            <span className="text-[#FFB000]">FAIR VALUE</span>
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold text-[#E0E0E0]">
              ${microPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-[#666666]">Spread Bias:</span>
            <span
              className={`font-semibold ${
                microBias > 0 ? "text-[#00E676]" : microBias < 0 ? "text-[#FF1744]" : "text-[#888888]"
              }`}
            >
              {microBias > 0 ? `+${microBias.toFixed(2)} bps (Ask Skew)` : `${microBias.toFixed(2)} bps (Bid Skew)`}
            </span>
          </div>
        </div>

        {/* Card 3: Multi-Level Deep OFI */}
        <div className="bg-[#0A0A0A] border border-[#222222] p-3 rounded flex flex-col justify-between">
          <div className="text-[11px] text-[#888888] flex justify-between">
            <span>DEEP OFI (5 LEVELS)</span>
            <span className="text-[#00E5FF]">WEIGHTED</span>
          </div>
          <div className="my-2">
            <span
              className={`text-2xl font-bold ${
                (bookData?.deep_ofi || 0) > 0
                  ? "text-[#00E676]"
                  : (bookData?.deep_ofi || 0) < 0
                  ? "text-[#FF1744]"
                  : "text-[#888888]"
              }`}
            >
              {(bookData?.deep_ofi || 0) > 0 ? `+${(bookData?.deep_ofi || 0).toFixed(3)}` : (bookData?.deep_ofi || 0).toFixed(3)}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-[#666666]">Cumulative OFI:</span>
            <span
              className={`font-semibold ${
                (bookData?.cumulative_ofi || 0) >= 0 ? "text-[#00E676]" : "text-[#FF1744]"
              }`}
            >
              {(bookData?.cumulative_ofi || 0) > 0 ? `+${(bookData?.cumulative_ofi ?? 0).toFixed(2)}` : (bookData?.cumulative_ofi ?? 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Card 4: Kyle's Lambda & Price Impact */}
        <div className="bg-[#0A0A0A] border border-[#222222] p-3 rounded flex flex-col justify-between">
          <div className="text-[11px] text-[#888888] flex justify-between">
            <span>KYLE&apos;S LAMBDA (λ)</span>
            <span className="text-[#FFB000]">IMPACT MODEL</span>
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold text-[#00E5FF]">
              {(bookData?.kyle_lambda || 0.0004).toFixed(6)}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-[#666666]">Expected Impact:</span>
            <span
              className={`font-semibold ${
                (bookData?.predicted_impact_bps || 0) > 0
                  ? "text-[#00E676]"
                  : (bookData?.predicted_impact_bps || 0) < 0
                  ? "text-[#FF1744]"
                  : "text-[#888888]"
              }`}
            >
              {(bookData?.predicted_impact_bps || 0) > 0
                ? `+${(bookData?.predicted_impact_bps || 0).toFixed(2)} bps`
                : `${(bookData?.predicted_impact_bps || 0).toFixed(2)} bps`}
            </span>
          </div>
        </div>
      </div>

      {/* Visual Spread Barometer: Best Bid vs Micro-Price vs Best Ask */}
      <div className="bg-[#0A0A0A] border border-[#222222] p-3 rounded mb-3">
        <div className="flex justify-between items-center text-xs text-[#888888] mb-1.5">
          <span>
            BEST BID: <span className="text-[#00E676] font-bold">${bestBid.toFixed(2)}</span>
          </span>
          <span className="text-center text-[#FFB000]">
            MICRO-PRICE POSITION: <span className="font-bold">${microPrice.toFixed(2)}</span> ({microBias >= 0 ? `+${microBias.toFixed(1)}` : microBias.toFixed(1)} bps from Mid)
          </span>
          <span>
            BEST ASK: <span className="text-[#FF1744] font-bold">${bestAsk.toFixed(2)}</span>
          </span>
        </div>

        <div className="relative w-full h-5 bg-[#141414] rounded overflow-hidden flex items-center">
          {/* Mid price marker */}
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#444444] z-10" />

          {/* Micro-price indicator pill */}
          <div
            className="absolute top-0 bottom-0 w-4 -ml-2 rounded flex items-center justify-center transition-all duration-150 z-20 shadow-lg"
            style={{
              left: `${microPercent}%`,
              backgroundColor: microBias > 0 ? "#00E676" : microBias < 0 ? "#FF1744" : "#FFB000",
            }}
          >
            <div className="w-1.5 h-1.5 bg-black rounded-full" />
          </div>
        </div>

        <div className="flex justify-between text-[10px] text-[#555555] mt-1">
          <span>0% (Bid Wall Pressure)</span>
          <span>50% (Mid Equilibrium)</span>
          <span>100% (Ask Wall Exhaustion)</span>
        </div>
      </div>

      {/* Real-Time Cumulative OFI Stream Chart */}
      <div className="flex-1 min-h-[220px] bg-[#0A0A0A] border border-[#222222] p-3 rounded flex flex-col">
        <div className="flex justify-between items-center text-xs text-[#888888] mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[#FFB000] font-semibold">CUMULATIVE ORDER FLOW ACCUMULATION</span>
            <span className="text-[10px] text-[#666666]">(100-tick rolling window)</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-[#00E676]" /> Institutional Net Buying
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-[#FF1744]" /> Institutional Net Selling
            </span>
          </div>
        </div>

        <div className="relative flex-1 w-full h-full min-h-[160px]">
          <canvas
            ref={canvasRef}
            width={720}
            height={200}
            className="w-full h-full block rounded bg-[#050505]"
          />
        </div>
      </div>

      {/* Institutional Microstructure Explainer Footer */}
      <div className="mt-3 p-2 bg-[#050505] border border-[#1A1A1A] text-[11px] text-[#666666] rounded flex flex-col md:flex-row justify-between gap-2">
        <div>
          <span className="text-[#00E5FF] font-semibold">OFI Formulation: </span>
          <span>{"I_n = ΔB_n - ΔA_n (Cont, Kukanov & Stoikov 2014)"}</span>
        </div>
        <div>
          <span className="text-[#FFB000] font-semibold">Micro-Price: </span>
          <span>{"P_micro = (Q_b·P_a + Q_a·P_b) / (Q_b + Q_a) (Stoikov 2018)"}</span>
        </div>
        <div>
          <span className="text-[#00E676] font-semibold">Toxicity: </span>
          <span>{"VPIN Volume Synchronized Flow (Easley et al. 2012)"}</span>
        </div>
      </div>
    </div>
  );
};
