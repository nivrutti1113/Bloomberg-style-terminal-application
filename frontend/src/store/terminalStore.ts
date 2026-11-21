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
  "NIFTY50",
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
  RELIANCE: { price: 1320.4, change: 8.5, pct: 0.65, vol: 4820000 },
  TCS: { price: 3914.8, change: 16.4, pct: 0.42, vol: 2150000 },
  INFY: { price: 1842.1, change: -5.7, pct: -0.31, vol: 3540000 },
  HDFCBANK: { price: 1738.5, change: 15.2, pct: 0.88, vol: 6210000 },
  ICICIBANK: { price: 1258.9, change: 14.3, pct: 1.15, vol: 5430000 },
  NIFTY50: { price: 24145.0, change: 84.5, pct: 0.35, vol: 18200000 },
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
