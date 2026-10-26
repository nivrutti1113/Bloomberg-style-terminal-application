/**
 * Terminal Command Parser & Auto-completion Engine
 */

export interface ParsedCommand {
  isValid: boolean;
  action: "OPEN_PANEL" | "ADD_SYMBOL" | "DEL_SYMBOL" | "HELP" | "ERROR";
  symbol?: string;
  panelFunction?: "GP" | "OB" | "TS" | "VOL" | "BT" | "WL" | "METRICS" | "HELP";
  panelType?: "watchlist" | "chart" | "orderbook" | "trades" | "analytics" | "metrics" | "help";
  errorMessage?: string;
}

export const SUPPORTED_FUNCTIONS: Record<string, { name: string; panelType: ParsedCommand["panelType"]; description: string }> = {
  GP: { name: "Price Chart", panelType: "chart", description: "Candlesticks, technical indicators, and real-time candle line" },
  OB: { name: "Order Book", panelType: "orderbook", description: "20-level depth ladder with spread and order book imbalance" },
  TS: { name: "Time & Sales", panelType: "trades", description: "Live virtualized trade tape with large transaction highlights" },
  VOL: { name: "HAR Volatility", panelType: "analytics", description: "HAR-RV realized volatility forecasts (1d, 5d, 22d)" },
  BT: { name: "Vol-Target Backtest", panelType: "analytics", description: "Volatility targeting backtest equity curve & Sharpe ratio" },
  WL: { name: "Watchlist", panelType: "watchlist", description: "Multi-symbol streaming watchlist with sparklines" },
  METRICS: { name: "System Metrics", panelType: "metrics", description: "Throughput (ticks/s), p50/p99 latency, and feed health" },
  HELP: { name: "Terminal Help", panelType: "help", description: "Shortcut reference and function command catalog" },
};

export function parseCommand(rawInput: string, currentActiveSymbol: string = "BTCUSDT"): ParsedCommand {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { isValid: false, action: "ERROR", errorMessage: "Empty command." };
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0].toUpperCase();

  // Single token commands
  if (parts.length === 1) {
    if (first === "HELP" || first === "?") {
      return { isValid: true, action: "OPEN_PANEL", panelFunction: "HELP", panelType: "help" };
    }
    if (first === "WL") {
      return { isValid: true, action: "OPEN_PANEL", panelFunction: "WL", panelType: "watchlist" };
    }
    if (first === "METRICS") {
      return { isValid: true, action: "OPEN_PANEL", panelFunction: "METRICS", panelType: "metrics" };
    }
    // If just a function code (e.g. "GP"), apply to current active symbol
    if (first in SUPPORTED_FUNCTIONS) {
      const fn = first as keyof typeof SUPPORTED_FUNCTIONS;
      return {
        isValid: true,
        action: "OPEN_PANEL",
        symbol: currentActiveSymbol,
        panelFunction: fn as ParsedCommand["panelFunction"],
        panelType: SUPPORTED_FUNCTIONS[fn].panelType,
      };
    }
  }

  // Watchlist manipulation: ADD <SYMBOL>, DEL <SYMBOL>
  if (first === "ADD" && parts[1]) {
    let sym = parts[1].toUpperCase();
    if (!sym.endsWith("USDT") && !sym.includes("/")) {
      sym = `${sym}USDT`;
    }
    return { isValid: true, action: "ADD_SYMBOL", symbol: sym };
  }

  if ((first === "DEL" || first === "REMOVE") && parts[1]) {
    let sym = parts[1].toUpperCase();
    if (!sym.endsWith("USDT") && !sym.includes("/")) {
      sym = `${sym}USDT`;
    }
    return { isValid: true, action: "DEL_SYMBOL", symbol: sym };
  }

  // Syntax: <SYMBOL> <FUNCTION> (e.g. "BTC GP", "ETH OB", "SOL TS")
  if (parts.length >= 2) {
    let sym = parts[0].toUpperCase();
    const fn = parts[1].toUpperCase();

    if (!sym.endsWith("USDT") && !sym.includes("/")) {
      sym = `${sym}USDT`;
    }

    if (fn in SUPPORTED_FUNCTIONS) {
      const funcKey = fn as keyof typeof SUPPORTED_FUNCTIONS;
      return {
        isValid: true,
        action: "OPEN_PANEL",
        symbol: sym,
        panelFunction: funcKey as ParsedCommand["panelFunction"],
        panelType: SUPPORTED_FUNCTIONS[funcKey].panelType,
      };
    } else {
      return {
        isValid: false,
        action: "ERROR",
        errorMessage: `Unknown function '${fn}'. Type 'HELP' to see all commands (GP, OB, TS, VOL, BT, WL).`,
      };
    }
  }

  return {
    isValid: false,
    action: "ERROR",
    errorMessage: `Unrecognized command: '${trimmed}'. Syntax: <SYMBOL> <FUNCTION> (e.g., 'BTC GP', 'ETH OB', 'WL').`,
  };
}

export const AUTOCOMPLETE_ITEMS = [
  { command: "BTC GP", label: "BTC Price Chart", desc: "Open BTC candlesticks" },
  { command: "ETH GP", label: "ETH Price Chart", desc: "Open ETH candlesticks" },
  { command: "SOL GP", label: "SOL Price Chart", desc: "Open SOL candlesticks" },
  { command: "BTC OB", label: "BTC Order Book", desc: "Open BTC depth ladder" },
  { command: "BTC TS", label: "BTC Time & Sales", desc: "Open BTC trade tape" },
  { command: "BTC VOL", label: "BTC Volatility", desc: "HAR-RV volatility model" },
  { command: "BTC BT", label: "BTC Backtest", desc: "Volatility targeting backtest" },
  { command: "WL", label: "Watchlist", desc: "Multi-symbol streaming quotes" },
  { command: "METRICS", label: "System Health", desc: "Ticks/sec, p50/p99 latency" },
  { command: "ADD <SYM>", label: "Add Symbol", desc: "e.g. ADD DOGEUSDT" },
  { command: "DEL <SYM>", label: "Remove Symbol", desc: "e.g. DEL DOGEUSDT" },
  { command: "HELP", label: "Command Catalog", desc: "View full terminal cheat sheet" },
];
