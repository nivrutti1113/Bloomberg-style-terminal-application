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
];

const MAX_SPARKLINE_POINTS = 30;

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
  marketPrices: {},
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
