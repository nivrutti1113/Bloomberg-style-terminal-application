"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  UTCTimestamp,
} from "lightweight-charts";
import { useTerminalStore } from "@/store/terminalStore";
import { wsManager } from "@/lib/ws/wsManager";
import { getApiBaseUrl } from "@/config/env";
import { Tick } from "@/types/market";
import {
  CandleDataPoint,
  calculateSMA,
  calculateEMA,
  calculateBollingerBands,
  calculateRSI,
} from "@/lib/indicators";

interface ChartPanelProps {
  symbol?: string;
}

type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
};

/**
 * Sanitizes candle array to ensure strict ascending time ordering and deduplication,
 * as required by TradingView Lightweight Charts.
 */
function sanitizeCandles(candles: CandleDataPoint[]): CandleDataPoint[] {
  if (!candles || candles.length === 0) return [];

  // Sort ascending by time
  const sorted = [...candles].sort((a, b) => (a.time as number) - (b.time as number));
  const unique: CandleDataPoint[] = [];

  for (const c of sorted) {
    if (unique.length === 0) {
      unique.push(c);
    } else {
      const prev = unique[unique.length - 1];
      if ((c.time as number) > (prev.time as number)) {
        unique.push(c);
      } else if (c.time === prev.time) {
        // Overwrite duplicate timestamp with the latest data
        unique[unique.length - 1] = c;
      }
    }
  }

  return unique;
}

export const ChartPanel: React.FC<ChartPanelProps> = ({ symbol }) => {
  const { activeSymbol, marketPrices, connectionStatus } = useTerminalStore();
  const targetSymbol = (symbol || activeSymbol).toUpperCase();

  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Indicators toggle state
  const [showSMA, setShowSMA] = useState<boolean>(true);
  const [showEMA, setShowEMA] = useState<boolean>(false);
  const [showBoll, setShowBoll] = useState<boolean>(false);
  const [showRSI, setShowRSI] = useState<boolean>(false);

  // Chart and Series refs
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bollUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bollLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Local candles cache for live updates & indicators
  const candlesRef = useRef<CandleDataPoint[]>([]);
  const currentCandleRef = useRef<CandleDataPoint | null>(null);

  // Price line tracking
  const currentPrice = marketPrices[targetSymbol]?.price;
  const priceChangePct = marketPrices[targetSymbol]?.change_pct_24h;

  // Initialize and update indicators with strict ascending timestamps
  const refreshIndicators = useCallback((candlesInput: CandleDataPoint[]) => {
    const candles = sanitizeCandles(candlesInput);
    if (candles.length === 0) return;

    if (smaSeriesRef.current) {
      const smaData = calculateSMA(candles, 20);
      smaSeriesRef.current.setData(smaData);
    }

    if (emaSeriesRef.current) {
      const emaData = calculateEMA(candles, 50);
      emaSeriesRef.current.setData(emaData);
    }

    if (bollUpperSeriesRef.current && bollLowerSeriesRef.current) {
      const { upper, lower } = calculateBollingerBands(candles, 20, 2);
      bollUpperSeriesRef.current.setData(upper);
      bollLowerSeriesRef.current.setData(lower);
    }

    if (rsiSeriesRef.current) {
      const rsiData = calculateRSI(candles, 14);
      rsiSeriesRef.current.setData(rsiData);
    }
  }, []);

  // Initialize Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create TradingView lightweight chart instance
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#9A9A9A",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#161616" },
        horzLines: { color: "#161616" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#FFB000",
          width: 1,
          style: 3,
          labelBackgroundColor: "#141414",
        },
        horzLine: {
          color: "#FFB000",
          width: 1,
          style: 3,
          labelBackgroundColor: "#141414",
        },
      },
      rightPriceScale: {
        borderColor: "#2A2A2A",
        scaleMargins: {
          top: 0.1,
          bottom: 0.22, // Reserve bottom for volume
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: "#2A2A2A",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Main Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00D26A",
      downColor: "#FF3B30",
      borderVisible: false,
      wickUpColor: "#00D26A",
      wickDownColor: "#FF3B30",
    });

    // Volume Histogram (sits in bottom 20%)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "", // Overlay scale
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    // Technical Indicator Series
    const smaSeries = chart.addSeries(LineSeries, {
      color: "#2D9CDB",
      lineWidth: 1,
      title: "SMA 20",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const emaSeries = chart.addSeries(LineSeries, {
      color: "#FFB000",
      lineWidth: 1,
      title: "EMA 50",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bollUpperSeries = chart.addSeries(LineSeries, {
      color: "#666666",
      lineWidth: 1,
      lineStyle: 2,
      title: "BOLL Upper",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bollLowerSeries = chart.addSeries(LineSeries, {
      color: "#666666",
      lineWidth: 1,
      lineStyle: 2,
      title: "BOLL Lower",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const rsiSeries = chart.addSeries(LineSeries, {
      color: "#A259FF",
      lineWidth: 1,
      title: "RSI 14",
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    rsiSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.75,
        bottom: 0.05,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    smaSeriesRef.current = smaSeries;
    emaSeriesRef.current = emaSeries;
    bollUpperSeriesRef.current = bollUpperSeries;
    bollLowerSeriesRef.current = bollLowerSeries;
    rsiSeriesRef.current = rsiSeries;

    // ResizeObserver for responsive resizing within FlexLayout docking splits
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.resize(width, height);
      }
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update Indicator Visibility on chart
  useEffect(() => {
    smaSeriesRef.current?.applyOptions({ visible: showSMA });
    emaSeriesRef.current?.applyOptions({ visible: showEMA });
    bollUpperSeriesRef.current?.applyOptions({ visible: showBoll });
    bollLowerSeriesRef.current?.applyOptions({ visible: showBoll });
    rsiSeriesRef.current?.applyOptions({ visible: showRSI });
  }, [showSMA, showEMA, showBoll, showRSI]);

  // Fetch Candle Data (Backend /candles with direct Binance fallback)
  useEffect(() => {
    let isMounted = true;

    const fetchCandles = async () => {
      try {
        setError(null);

        // 1. Try backend /candles endpoint
        let rawCandles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
        try {
          const res = await fetch(`${getApiBaseUrl()}/candles?symbol=${targetSymbol}&tf=${timeframe}&limit=180`);
          if (res.ok) {
            const data = await res.json();
            if (data.candles && Array.isArray(data.candles) && data.candles.length > 0) {
              rawCandles = data.candles;
            }
          }
        } catch {
          // Continue to fallback
        }

        // 2. Multi-Mirror Fallback if backend returned empty or was unreachable
        // (Includes Binance Vision public mirror which bypasses ISP DNS blocks, Global, and US)
        if (rawCandles.length === 0) {
          const mirrorUrls = [
            `https://data-api.binance.vision/api/v3/klines?symbol=${targetSymbol}&interval=${timeframe}&limit=180`,
            `https://api.binance.com/api/v3/klines?symbol=${targetSymbol}&interval=${timeframe}&limit=180`,
            `https://api.binance.us/api/v3/klines?symbol=${targetSymbol}&interval=${timeframe}&limit=180`,
          ];

          for (const url of mirrorUrls) {
            try {
              const res = await fetch(url);
              if (res.ok) {
                const raw = await res.json();
                if (Array.isArray(raw) && raw.length > 0) {
                  rawCandles = raw.map((c: (number | string)[]) => ({
                    time: Math.floor(Number(c[0]) / 1000),
                    open: parseFloat(String(c[1])),
                    high: parseFloat(String(c[2])),
                    low: parseFloat(String(c[3])),
                    close: parseFloat(String(c[4])),
                    volume: parseFloat(String(c[5])),
                  }));
                  break;
                }
              }
            } catch {
              // Try next mirror
            }
          }
        }

        if (!isMounted) return;

        if (!rawCandles || rawCandles.length === 0) {
          const isNSE = !targetSymbol.endsWith("USDT") && !targetSymbol.includes("/");
          if (isNSE) {
            setError(`NO CANDLE DATA: ${targetSymbol} is an Indian equity stub (Set NSE credentials in backend).`);
          } else {
            setError(`NO CANDLE DATA AVAILABLE FOR ${targetSymbol}`);
          }
          setLoading(false);
          return;
        }

        const formattedCandles: CandleDataPoint[] = rawCandles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        const cleanCandles = sanitizeCandles(formattedCandles);
        candlesRef.current = cleanCandles;
        currentCandleRef.current = cleanCandles.length > 0 ? { ...cleanCandles[cleanCandles.length - 1] } : null;

        if (candleSeriesRef.current && volumeSeriesRef.current) {
          candleSeriesRef.current.setData(cleanCandles);

          const volumeData = cleanCandles.map((c) => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? "rgba(0, 210, 106, 0.4)" : "rgba(255, 59, 48, 0.4)",
          }));
          volumeSeriesRef.current.setData(volumeData);

          refreshIndicators(cleanCandles);
          chartRef.current?.timeScale().fitContent();
        }

        setLoading(false);
      } catch (err) {
        if (isMounted) {
          setError(`Failed to load candles: ${err}`);
          setLoading(false);
        }
      }
    };

    fetchCandles();

    return () => {
      isMounted = false;
    };
  }, [targetSymbol, timeframe, refreshIndicators]);

  // Live Last-Candle Updating from incoming ticks
  useEffect(() => {
    const intervalSec = TIMEFRAME_SECONDS[timeframe];

    const unsubscribe = wsManager.subscribeTicks((ticks: Tick[]) => {
      const relevant = ticks.filter((t) => t.symbol.toUpperCase() === targetSymbol);
      if (relevant.length === 0 || !candleSeriesRef.current) return;

      for (const t of relevant) {
        const bucketSec = (Math.floor(t.exch_ts_ms / 1000 / intervalSec) * intervalSec) as UTCTimestamp;
        const current = currentCandleRef.current;

        // Skip any ticks with bucketSec earlier than the active candle to prevent out-of-order errors
        if (current && (bucketSec as number) < (current.time as number)) {
          continue;
        }

        if (current && current.time === bucketSec) {
          // Update in-progress candle
          current.high = Math.max(current.high, t.price);
          current.low = Math.min(current.low, t.price);
          current.close = t.price;
          current.volume += t.qty;

          candleSeriesRef.current.update(current);
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.update({
              time: bucketSec,
              value: current.volume,
              color: current.close >= current.open ? "rgba(0, 210, 106, 0.4)" : "rgba(255, 59, 48, 0.4)",
            });
          }

          // Keep current candle updated in history cache
          if (candlesRef.current.length > 0) {
            const lastIdx = candlesRef.current.length - 1;
            if (candlesRef.current[lastIdx].time === bucketSec) {
              candlesRef.current[lastIdx] = { ...current };
            }
          }
        } else if (!current || (bucketSec as number) > (current.time as number)) {
          // New candle bucket reached:
          // Finalize previous candle in candlesRef.current without creating duplicates
          if (current && candlesRef.current.length > 0) {
            const lastIdx = candlesRef.current.length - 1;
            if (candlesRef.current[lastIdx].time === current.time) {
              candlesRef.current[lastIdx] = { ...current };
            } else if ((current.time as number) > (candlesRef.current[lastIdx].time as number)) {
              candlesRef.current.push({ ...current });
            }
          }

          const newCandle: CandleDataPoint = {
            time: bucketSec,
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price,
            volume: t.qty,
          };
          currentCandleRef.current = newCandle;

          // Append new candle to candlesRef history
          const lastIdx = candlesRef.current.length - 1;
          if (lastIdx < 0 || (bucketSec as number) > (candlesRef.current[lastIdx].time as number)) {
            candlesRef.current.push({ ...newCandle });
            if (candlesRef.current.length > 500) {
              candlesRef.current.shift();
            }
          } else if (candlesRef.current[lastIdx].time === bucketSec) {
            candlesRef.current[lastIdx] = { ...newCandle };
          }

          candleSeriesRef.current.update(newCandle);
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.update({
              time: bucketSec,
              value: newCandle.volume,
              color: "rgba(0, 210, 106, 0.4)",
            });
          }

          refreshIndicators(candlesRef.current);
        }
      }
    });

    return () => unsubscribe();
  }, [targetSymbol, timeframe, refreshIndicators]);

  const isStale = connectionStatus === "STALE";

  return (
    <div className={`w-full h-full bg-[#0A0A0A] flex flex-col font-mono text-[11px] select-none ${isStale ? "opacity-50" : ""}`}>
      {/* Header: Symbol, Last Price, 24h Change, Timeframe Selector */}
      <div className="bg-[#141414] border-b border-[#2A2A2A] px-2 py-1 flex items-center justify-between text-[#9A9A9A]">
        <div className="flex items-center gap-3">
          <span className="text-[#FFB000] font-bold text-[12px]">{targetSymbol} GP</span>
          <span className="text-white font-bold tabular-nums">
            {currentPrice !== undefined
              ? currentPrice >= 10
                ? currentPrice.toFixed(2)
                : currentPrice.toFixed(4)
              : "--"}
          </span>
          {priceChangePct !== undefined && (
            <span className={`tabular-nums font-semibold ${priceChangePct >= 0 ? "text-[#00D26A]" : "text-[#FF3B30]"}`}>
              {priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(2)}%
            </span>
          )}
          {loading && <span className="text-[#FFB000] text-[10px] animate-pulse">[LOADING CANDLES...]</span>}
        </div>

        {/* Timeframe Buttons */}
        <div className="flex items-center gap-1 text-[10px]">
          {(["1m", "5m", "15m", "1h", "1d"] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-1.5 py-0.5 border ${
                timeframe === tf
                  ? "bg-[#FFB000] text-black font-bold border-[#FFB000]"
                  : "bg-[#0A0A0A] text-[#9A9A9A] border-[#2A2A2A] hover:text-[#FFB000]"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Technical Indicators Bar */}
      <div className="bg-[#000000] border-b border-[#2A2A2A] px-2 py-0.5 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-2">
          <span className="text-[#666666]">INDICATORS:</span>
          <button
            onClick={() => setShowSMA(!showSMA)}
            className={`px-1.5 py-0.2 border transition-colors ${
              showSMA
                ? "bg-[#2D9CDB]/20 text-[#2D9CDB] border-[#2D9CDB]"
                : "text-[#666666] border-[#2A2A2A] hover:text-[#9A9A9A]"
            }`}
          >
            SMA (20)
          </button>
          <button
            onClick={() => setShowEMA(!showEMA)}
            className={`px-1.5 py-0.2 border transition-colors ${
              showEMA
                ? "bg-[#FFB000]/20 text-[#FFB000] border-[#FFB000]"
                : "text-[#666666] border-[#2A2A2A] hover:text-[#9A9A9A]"
            }`}
          >
            EMA (50)
          </button>
          <button
            onClick={() => setShowBoll(!showBoll)}
            className={`px-1.5 py-0.2 border transition-colors ${
              showBoll
                ? "bg-[#FFFFFF]/20 text-white border-white"
                : "text-[#666666] border-[#2A2A2A] hover:text-[#9A9A9A]"
            }`}
          >
            BOLL (20,2)
          </button>
          <button
            onClick={() => setShowRSI(!showRSI)}
            className={`px-1.5 py-0.2 border transition-colors ${
              showRSI
                ? "bg-[#A259FF]/20 text-[#A259FF] border-[#A259FF]"
                : "text-[#666666] border-[#2A2A2A] hover:text-[#9A9A9A]"
            }`}
          >
            RSI (14)
          </button>
        </div>

        <div className="text-[#666666] text-[9px]">
          [LIVE LAST-CANDLE SYNTHESIS ACTIVE]
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="flex-1 w-full h-full relative bg-[#000000]">
        <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
            <div className="bg-[#1C0000] border border-[#FF3B30] p-4 text-[#FF3B30] text-center max-w-sm">
              <div className="font-bold mb-1">DATA ERROR</div>
              <div className="text-[10px] text-[#9A9A9A]">{error}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
