/**
 * Global Zustand Store for Terminal State & UI Controls
 */

import { create } from "zustand";
import { SymbolPrice, Tick, WsConnectionStatus } from "@/types/market";

const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "DOGEUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "NEARUSDT",
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "BHARTIARTL",
  "NIFTY50",
  "BANKNIFTY",
  "SENSEX",
];

const MAX_SPARKLINE_POINTS = 30;

const SEED_PRICES: Record<string, { price: number; change: number; pct: number; vol: number }> = {
  BTCUSDT: { price: 68450.0, change: 1420.0, pct: 2.12, vol: 24500 },
  ETHUSDT: { price: 3560.5, change: 52.3, pct: 1.49, vol: 112000 },
  SOLUSDT: { price: 185.2, change: 6.8, pct: 3.81, vol: 640000 },
  BNBUSDT: { price: 595.0, change: 8.5, pct: 1.45, vol: 45000 },
  DOGEUSDT: { price: 0.165, change: 0.005, pct: 3.12, vol: 1850000 },
  XRPUSDT: { price: 0.582, change: -0.012, pct: -2.02, vol: 920000 },
  ADAUSDT: { price: 0.385, change: 0.008, pct: 2.12, vol: 480000 },
  AVAXUSDT: { price: 28.4, change: 1.1, pct: 4.02, vol: 85000 },
  LINKUSDT: { price: 12.35, change: 0.25, pct: 2.06, vol: 62000 },
  NEARUSDT: { price: 4.85, change: 0.15, pct: 3.19, vol: 145000 },
  RELIANCE: { price: 1360.1, change: -17.4, pct: -1.26, vol: 4946000 },
  TCS: { price: 2488.6, change: 112.4, pct: 4.73, vol: 3139000 },
  INFY: { price: 1124.5, change: 26.5, pct: 2.41, vol: 4793000 },
  HDFCBANK: { price: 829.8, change: -16.2, pct: -1.91, vol: 23600000 },
  ICICIBANK: { price: 1612.9, change: -27.1, pct: -1.65, vol: 5037000 },
  SBIN: { price: 1148.1, change: -17.0, pct: -1.46, vol: 5897000 },
  BHARTIARTL: { price: 2139.3, change: -22.4, pct: -1.04, vol: 1449000 },
  NIFTY50: { price: 25606.3, change: -194.3, pct: -0.75, vol: 18200000 },
  BANKNIFTY: { price: 63393.95, change: -1241.25, pct: -1.92, vol: 8900000 },
  SENSEX: { price: 83335.58, change: -584.13, pct: -0.70, vol: 12500000 },
};

function createInitialMarketPrices(): Record<string, SymbolPrice> {
  const result: Record<string, SymbolPrice> = {};
  const now = typeof window !== "undefined" ? Date.now() : 0;
  for (const [sym, data] of Object.entries(SEED_PRICES)) {
    const isCrypto = sym.endsWith("USDT");
    const spark = Array.from({ length: 15 }, (_, i) => data.price * (1 + (Math.sin(i) * 0.004)));
    result[sym] = {
      symbol: sym,
      venue: isCrypto ? "BINANCE" : "NSE",
      price: data.price,
      qty: isCrypto ? 0.05 : 10,
      change_24h: data.change,
      change_pct_24h: data.pct,
      high_24h: data.price * 1.018,
      low_24h: data.price * 0.985,
      volume_24h: data.vol,
      open_price: data.price - data.change,
      exch_ts_ms: now,
      recv_ts_ms: now,
      priceHistory: spark,
      flashDirection: null,
      flashTimestamp: undefined,
    };
  }
  return result;
}

interface TerminalState {
  symbols: string[];
  activeSymbol: string;
  marketPrices: Record<string, SymbolPrice>;
  connectionStatus: WsConnectionStatus;
  latencyMs: number;
  ticksPerSec: number;
  p99LatencyMs: number;
  commandInput: string;
  commandHistory: string[];
  historyIndex: number;
  commandError: string | null;
  activePanelFunction: string;

  // Actions
  addSymbol: (symbol: string) => void;
  removeSymbol: (symbol: string) => void;
  setActiveSymbol: (symbol: string) => void;
  setActivePanelFunction: (fn: string) => void;
  updateTicks: (ticks: Tick[]) => void;
  updateFullSnapshots: (snapshots: Record<string, Partial<SymbolPrice>>) => void;
  setConnectionStatus: (status: WsConnectionStatus, latencyMs: number) => void;
  setTicksPerSec: (rate: number) => void;
  setCommandInput: (val: string) => void;
  setCommandError: (err: string | null) => void;
  pushCommandHistory: (cmd: string) => void;
  navigateHistory: (direction: "up" | "down") => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  symbols: DEFAULT_SYMBOLS,
  activeSymbol: "BTCUSDT",
  marketPrices: createInitialMarketPrices(),
  connectionStatus: "DISCONNECTED",
  latencyMs: 0,
  ticksPerSec: 0,
  p99LatencyMs: 0,
  commandInput: "",
  commandHistory: [],
  historyIndex: -1,
  commandError: null,
  activePanelFunction: "WL",

  addSymbol: (symbol) => {
    const clean = symbol.toUpperCase().trim();
    if (!clean) return;
    set((state) => {
      if (state.symbols.includes(clean)) return state;
      return { symbols: [...state.symbols, clean] };
    });
  },

  removeSymbol: (symbol) => {
    const clean = symbol.toUpperCase().trim();
    set((state) => ({
      symbols: state.symbols.filter((s) => s !== clean),
    }));
  },

  setActiveSymbol: (symbol) => {
    set({ activeSymbol: symbol.toUpperCase().trim() });
  },

  setActivePanelFunction: (fn) => {
    set({ activePanelFunction: fn.toUpperCase() });
  },

  updateTicks: (ticks: Tick[]) => {
    if (ticks.length === 0) return;

    set((state) => {
      const updatedPrices = { ...state.marketPrices };
      const now = Date.now();

      for (const tick of ticks) {
        const sym = tick.symbol.toUpperCase();
        const existing = updatedPrices[sym];

        let direction: "up" | "down" | null = null;
        const history = existing?.priceHistory ? [...existing.priceHistory] : [];
        const openPrice = existing?.open_price ?? tick.price;
        const high = existing ? Math.max(existing.high_24h, tick.price) : tick.price;
        const low = existing ? Math.min(existing.low_24h, tick.price) : tick.price;
        const volume = (existing?.volume_24h ?? 0) + tick.qty;

        if (existing) {
          if (tick.price > existing.price) direction = "up";
          else if (tick.price < existing.price) direction = "down";
          else direction = existing.flashDirection ?? null;
        }

        // Maintain sparkline ring buffer
        if (history.length === 0 || history[history.length - 1] !== tick.price) {
          history.push(tick.price);
          if (history.length > MAX_SPARKLINE_POINTS) {
            history.shift();
          }
        }

        const change24h = openPrice > 0 ? tick.price - openPrice : 0;
        const changePct24h = openPrice > 0 ? (change24h / openPrice) * 100 : 0;

        updatedPrices[sym] = {
          symbol: sym,
          venue: tick.venue,
          price: tick.price,
          qty: tick.qty,
          change_24h: change24h,
          change_pct_24h: changePct24h,
          high_24h: high,
          low_24h: low,
          volume_24h: volume,
          open_price: openPrice,
          exch_ts_ms: tick.exch_ts_ms,
          recv_ts_ms: tick.recv_ts_ms,
          priceHistory: history,
          flashDirection: direction,
          flashTimestamp: direction ? now : existing?.flashTimestamp,
        };
      }

      return { marketPrices: updatedPrices };
    });
  },

  updateFullSnapshots: (snapshots: Record<string, Partial<SymbolPrice>>) => {
    set((state) => {
      const updated = { ...state.marketPrices };
      const now = Date.now();
      for (const [sym, data] of Object.entries(snapshots)) {
        const upper = sym.toUpperCase();
        const existing = updated[upper];
        const newPrice = data.price ?? existing?.price ?? 0;
        let direction: "up" | "down" | null = null;
        if (existing && newPrice > 0) {
          if (newPrice > existing.price) direction = "up";
          else if (newPrice < existing.price) direction = "down";
          else direction = existing.flashDirection ?? null;
        }
        const history = existing?.priceHistory ? [...existing.priceHistory] : [];
        if (newPrice > 0 && (history.length === 0 || history[history.length - 1] !== newPrice)) {
          history.push(newPrice);
          if (history.length > MAX_SPARKLINE_POINTS) history.shift();
        }

        updated[upper] = {
          symbol: upper,
          venue: data.venue ?? existing?.venue ?? "NSE",
          price: newPrice,
          qty: data.qty ?? existing?.qty ?? 10,
          change_24h: data.change_24h ?? existing?.change_24h ?? 0,
          change_pct_24h: data.change_pct_24h ?? existing?.change_pct_24h ?? 0,
          high_24h: data.high_24h ?? existing?.high_24h ?? newPrice,
          low_24h: data.low_24h ?? existing?.low_24h ?? newPrice,
          volume_24h: data.volume_24h ?? existing?.volume_24h ?? 0,
          open_price: data.open_price ?? existing?.open_price ?? newPrice,
          exch_ts_ms: data.exch_ts_ms ?? existing?.exch_ts_ms ?? now,
          recv_ts_ms: now,
          priceHistory: history,
          flashDirection: direction,
          flashTimestamp: direction ? now : existing?.flashTimestamp,
        };
      }
      return { marketPrices: updated };
    });
  },

  setConnectionStatus: (status, latencyMs) => {
    set((state) => ({
      connectionStatus: status,
      latencyMs,
      p99LatencyMs: Math.max(state.p99LatencyMs, latencyMs),
    }));
  },

  setTicksPerSec: (rate) => set({ ticksPerSec: rate }),

  setCommandInput: (val) => set({ commandInput: val, commandError: null }),

  setCommandError: (err) => set({ commandError: err }),

  pushCommandHistory: (cmd) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    set((state) => ({
      commandHistory: [trimmed, ...state.commandHistory.filter((c) => c !== trimmed)].slice(0, 50),
      historyIndex: -1,
    }));
  },

  navigateHistory: (direction) => {
    set((state) => {
      if (state.commandHistory.length === 0) return state;

      let newIndex = state.historyIndex;
      if (direction === "up") {
        newIndex = Math.min(newIndex + 1, state.commandHistory.length - 1);
      } else {
        newIndex = Math.max(newIndex - 1, -1);
      }

      const input = newIndex === -1 ? "" : state.commandHistory[newIndex];
      return {
        historyIndex: newIndex,
        commandInput: input,
      };
    });
  },
}));
