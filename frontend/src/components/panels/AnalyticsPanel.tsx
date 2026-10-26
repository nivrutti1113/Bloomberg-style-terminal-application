"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "@/store/terminalStore";
import { getApiBaseUrl } from "@/config/env";

interface AnalyticsPanelProps {
  symbol?: string;
  defaultTab?: "VOL" | "BT";
}

interface HarData {
  symbol: string;
  status: string;
  model: string;
  current_realized_vol: number;
  forecast_1d: number;
  forecast_5d: number;
  forecast_22d: number;
  coefficients: {
    intercept: number;
    beta_daily: number;
    beta_weekly: number;
    beta_monthly: number;
  };
  r_squared: number;
  chart_series: {
    date: string;
    realized: number;
    forecast: number;
    close: number;
  }[];
}

interface VolTargetData {
  symbol: string;
  status: string;
  target_volatility: number;
  realized_volatility: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  annual_return_pct: number;
  annual_turnover: number;
  benchmark_sharpe: number;
  benchmark_max_drawdown_pct: number;
  benchmark_annual_return_pct: number;
  equity_curve: {
    date: string;
    strategy: number;
    benchmark: number;
    leverage: number;
  }[];
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ symbol, defaultTab = "VOL" }) => {
  const { activeSymbol, connectionStatus, activePanelFunction } = useTerminalStore();
  const targetSymbol = (symbol || activeSymbol).toUpperCase();

  const [tab, setTab] = useState<"VOL" | "BT">(defaultTab);
  const [harData, setHarData] = useState<HarData | null>(null);
  const [btData, setBtData] = useState<VolTargetData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (defaultTab) {
      setTab(defaultTab);
    }
  }, [defaultTab]);

  useEffect(() => {
    if (activePanelFunction === "BT") {
      setTab("BT");
    } else if (activePanelFunction === "VOL") {
      setTab("VOL");
    }
  }, [activePanelFunction]);

  useEffect(() => {
    let isMounted = true;

    const fetchAnalytics = async () => {
      try {
        setError(null);
        const baseUrl = getApiBaseUrl();
        const [harRes, btRes] = await Promise.allSettled([
          fetch(`${baseUrl}/analytics/har/${targetSymbol}`).then((r) => r.json()),
          fetch(`${baseUrl}/analytics/voltarget/${targetSymbol}`).then((r) => r.json()),
        ]);

        if (isMounted) {
          if (harRes.status === "fulfilled" && harRes.value.status === "SUCCESS") {
            setHarData(harRes.value as HarData);
          }
          if (btRes.status === "fulfilled" && btRes.value.status === "SUCCESS") {
            setBtData(btRes.value as VolTargetData);
          }
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(`Analytics calculation error: ${err}`);
          setLoading(false);
        }
      }
    };

    fetchAnalytics();
    return () => {
      isMounted = false;
    };
  }, [targetSymbol]);

  // Render High-Performance Canvas Visualizations
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.parentElement?.clientWidth || 600;
    const height = canvas.parentElement?.clientHeight || 280;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const padLeft = 45;
    const padRight = 20;
    const padTop = 25;
    const padBottom = 25;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    if (tab === "VOL" && harData?.chart_series && harData.chart_series.length > 1) {
      const series = harData.chart_series;
      const allVals = series.flatMap((s) => [s.realized, s.forecast]);
      const minVal = Math.max(0, Math.min(...allVals) * 0.9);
      const maxVal = Math.max(...allVals) * 1.1 || 100;

      // Draw Grid Lines
      ctx.strokeStyle = "#1A1A1A";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padTop + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();

        const labelVal = (maxVal - ((maxVal - minVal) / 4) * i).toFixed(1);
        ctx.fillStyle = "#666666";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${labelVal}%`, padLeft - 6, y + 3);
      }

      // Draw Realized Volatility Line (Amber)
      ctx.strokeStyle = "#FFB000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      series.forEach((s, idx) => {
        const x = padLeft + (idx / (series.length - 1)) * chartW;
        const y = padTop + chartH - ((s.realized - minVal) / (maxVal - minVal)) * chartH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Draw HAR Forecast Line (Cyan)
      ctx.strokeStyle = "#2D9CDB";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      series.forEach((s, idx) => {
        const x = padLeft + (idx / (series.length - 1)) * chartW;
        const y = padTop + chartH - ((s.forecast - minVal) / (maxVal - minVal)) * chartH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Dates on X Axis
      ctx.fillStyle = "#666666";
      ctx.textAlign = "center";
      const step = Math.floor(series.length / 5) || 1;
      for (let i = 0; i < series.length; i += step) {
        const x = padLeft + (i / (series.length - 1)) * chartW;
        ctx.fillText(series[i].date.slice(5), x, height - 8);
      }
    } else if (tab === "BT" && btData?.equity_curve && btData.equity_curve.length > 1) {
      const series = btData.equity_curve;
      const allVals = series.flatMap((s) => [s.strategy, s.benchmark]);
      const minVal = Math.min(...allVals) * 0.95;
      const maxVal = Math.max(...allVals) * 1.05;

      // Draw Grid Lines & 100 baseline
      ctx.strokeStyle = "#1A1A1A";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padTop + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();

        const labelVal = (maxVal - ((maxVal - minVal) / 4) * i).toFixed(0);
        ctx.fillStyle = "#666666";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillText(labelVal, padLeft - 6, y + 3);
      }

      // 100 Baseline line
      if (minVal <= 100 && maxVal >= 100) {
        const y100 = padTop + chartH - ((100 - minVal) / (maxVal - minVal)) * chartH;
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(padLeft, y100);
        ctx.lineTo(width - padRight, y100);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Benchmark Buy & Hold Line (Grey)
      ctx.strokeStyle = "#888888";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      series.forEach((s, idx) => {
        const x = padLeft + (idx / (series.length - 1)) * chartW;
        const y = padTop + chartH - ((s.benchmark - minVal) / (maxVal - minVal)) * chartH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Strategy Equity Curve Line (Green)
      ctx.strokeStyle = "#00D26A";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      series.forEach((s, idx) => {
        const x = padLeft + (idx / (series.length - 1)) * chartW;
        const y = padTop + chartH - ((s.strategy - minVal) / (maxVal - minVal)) * chartH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Dates on X Axis
      ctx.fillStyle = "#666666";
      ctx.textAlign = "center";
      const step = Math.floor(series.length / 5) || 1;
      for (let i = 0; i < series.length; i += step) {
        const x = padLeft + (i / (series.length - 1)) * chartW;
        ctx.fillText(series[i].date.slice(5), x, height - 8);
      }
    }
  }, [tab, harData, btData]);

  const isStale = connectionStatus === "STALE";

  return (
    <div className={`w-full h-full bg-[#0A0A0A] flex flex-col font-mono text-[11px] select-none ${isStale ? "opacity-50" : ""}`}>
      {/* Header Tabs */}
      <div className="bg-[#141414] border-b border-[#2A2A2A] px-2 py-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#FFB000] font-bold text-[12px]">{targetSymbol}</span>
          <span className="text-[#666666]">[QUANT ANALYTICS]</span>
          {loading && <span className="text-[#FFB000] text-[10px] animate-pulse">[COMPUTING...]</span>}
        </div>

        <div className="flex items-center gap-1 text-[10px]">
          <button
            onClick={() => setTab("VOL")}
            className={`px-2 py-0.5 border ${
              tab === "VOL"
                ? "bg-[#FFB000] text-black font-bold border-[#FFB000]"
                : "bg-[#0A0A0A] text-[#9A9A9A] border-[#2A2A2A] hover:text-[#FFB000]"
            }`}
          >
            VOL (HAR-RV FORECAST)
          </button>
          <button
            onClick={() => setTab("BT")}
            className={`px-2 py-0.5 border ${
              tab === "BT"
                ? "bg-[#FFB000] text-black font-bold border-[#FFB000]"
                : "bg-[#0A0A0A] text-[#9A9A9A] border-[#2A2A2A] hover:text-[#FFB000]"
            }`}
          >
            BT (VOL TARGET BACKTEST)
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {tab === "VOL" ? (
          <>
            {/* HAR Key Metrics Cards */}
            <div className="grid grid-cols-4 gap-2">
              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">CURRENT REALIZED VOL</div>
                <div className="text-white text-[15px] font-bold mt-0.5 tabular-nums">
                  {harData?.current_realized_vol !== undefined ? `${harData.current_realized_vol}%` : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">Annualized</div>
              </div>

              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">1-DAY FORECAST (h=1)</div>
                <div className="text-[#00D26A] text-[15px] font-bold mt-0.5 tabular-nums">
                  {harData?.forecast_1d !== undefined ? `${harData.forecast_1d}%` : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">HAR Next Day</div>
              </div>

              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">5-DAY FORECAST (h=5)</div>
                <div className="text-[#FFB000] text-[15px] font-bold mt-0.5 tabular-nums">
                  {harData?.forecast_5d !== undefined ? `${harData.forecast_5d}%` : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">Weekly Rolling</div>
              </div>

              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">22-DAY FORECAST (h=22)</div>
                <div className="text-[#2D9CDB] text-[15px] font-bold mt-0.5 tabular-nums">
                  {harData?.forecast_22d !== undefined ? `${harData.forecast_22d}%` : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">Monthly Horizon</div>
              </div>
            </div>

            {/* Chart Container */}
            <div className="flex-1 min-h-[220px] border border-[#2A2A2A] bg-[#000000] p-2 flex flex-col">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-[#FFB000] font-bold">REALIZED VOLATILITY VS HAR-RV 1D FORECAST</span>
                <div className="flex items-center gap-3 text-[9px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-[#FFB000] inline-block" />
                    <span className="text-[#9A9A9A]">Realized Vol</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-[#2D9CDB] inline-block border-b border-dashed" />
                    <span className="text-[#9A9A9A]">HAR Forecast</span>
                  </span>
                </div>
              </div>
              <div className="flex-1 w-full h-full relative">
                <canvas ref={canvasRef} className="w-full h-full block" />
              </div>
            </div>

            {/* HAR Model Parameters */}
            <div className="border border-[#2A2A2A] bg-[#050505] p-2 text-[10px]">
              <div className="text-[#FFB000] font-bold mb-1">HAR-RV OLS REGRESSION SPECIFICATION:</div>
              <div className="grid grid-cols-4 gap-2 text-[#9A9A9A] tabular-nums">
                <div>β_d: <span className="text-white font-bold">{harData?.coefficients.beta_daily ?? "--"}</span></div>
                <div>β_w: <span className="text-white font-bold">{harData?.coefficients.beta_weekly ?? "--"}</span></div>
                <div>β_m: <span className="text-white font-bold">{harData?.coefficients.beta_monthly ?? "--"}</span></div>
                <div>R² Score: <span className="text-[#00D26A] font-bold">{harData?.r_squared ?? "--"}</span></div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Backtest Strategy Metrics Cards */}
            <div className="grid grid-cols-4 gap-2">
              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">STRATEGY SHARPE</div>
                <div className="text-[#00D26A] text-[15px] font-bold mt-0.5 tabular-nums">
                  {btData?.sharpe_ratio !== undefined ? btData.sharpe_ratio.toFixed(2) : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">vs B&amp;H: {btData?.benchmark_sharpe?.toFixed(2) ?? "--"}</div>
              </div>

              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">MAX DRAWDOWN</div>
                <div className="text-[#FF3B30] text-[15px] font-bold mt-0.5 tabular-nums">
                  {btData?.max_drawdown_pct !== undefined ? `-${btData.max_drawdown_pct}%` : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">vs B&amp;H: -{btData?.benchmark_max_drawdown_pct ?? "--"}%</div>
              </div>

              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">REALIZED VOLATILITY</div>
                <div className="text-[#FFB000] text-[15px] font-bold mt-0.5 tabular-nums">
                  {btData?.realized_volatility !== undefined ? `${btData.realized_volatility}%` : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">Target: {btData?.target_volatility ?? 15}%</div>
              </div>

              <div className="border border-[#2A2A2A] bg-[#000000] p-2 text-center">
                <div className="text-[#666666] text-[9px]">ANNUAL RETURN</div>
                <div className="text-[#2D9CDB] text-[15px] font-bold mt-0.5 tabular-nums">
                  {btData?.annual_return_pct !== undefined ? `${btData.annual_return_pct}%` : "--"}
                </div>
                <div className="text-[#666666] text-[8px]">Turnover: {btData?.annual_turnover ?? "--"}x</div>
              </div>
            </div>

            {/* Equity Curve Chart */}
            <div className="flex-1 min-h-[220px] border border-[#2A2A2A] bg-[#000000] p-2 flex flex-col">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-[#FFB000] font-bold">VOL-TARGETING STRATEGY EQUITY VS BUY &amp; HOLD (BASE = 100)</span>
                <div className="flex items-center gap-3 text-[9px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-[#00D26A] inline-block" />
                    <span className="text-[#9A9A9A]">Vol-Target Strategy</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-[#888888] inline-block" />
                    <span className="text-[#9A9A9A]">Buy &amp; Hold Benchmark</span>
                  </span>
                </div>
              </div>
              <div className="flex-1 w-full h-full relative">
                <canvas ref={canvasRef} className="w-full h-full block" />
              </div>
            </div>

            {/* Backtest Constraints & Config */}
            <div className="border border-[#2A2A2A] bg-[#050505] p-2 text-[10px]">
              <div className="text-[#FFB000] font-bold mb-1">QUANT BACKTEST ENGINE PARAMETERS:</div>
              <div className="grid grid-cols-3 gap-2 text-[#9A9A9A] tabular-nums">
                <div>Target Vol: <span className="text-white font-bold">15.0% annualized</span></div>
                <div>Leverage Cap: <span className="text-white font-bold">2.0x</span></div>
                <div>Execution Cost: <span className="text-white font-bold">5.0 bps / trade</span></div>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="text-[#FF3B30] bg-[#1C0000] p-2 border border-[#FF3B30] text-[10px] font-bold">
            ERROR: {error}
          </div>
        )}
      </div>
    </div>
  );
};
