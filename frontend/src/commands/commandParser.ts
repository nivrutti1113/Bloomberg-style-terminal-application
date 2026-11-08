/**
 * Terminal Command Parser & Auto-completion Engine
 */

import { PanelType } from "@/types/market";

export interface ParsedCommand {
  isValid: boolean;
  action: "OPEN_PANEL" | "ADD_SYMBOL" | "DEL_SYMBOL" | "HELP" | "ERROR";
  symbol?: string;
  panelFunction?: "GP" | "OB" | "TS" | "VOL" | "BT" | "WL" | "METRICS" | "HELP" | "OFI" | "DES";
  panelType?: PanelType;
  errorMessage?: string;
}

export const SUPPORTED_FUNCTIONS: Record<string, { name: string; panelType: PanelType; description: string }> = {
  GP: { name: "Price Chart", panelType: "chart", description: "Candlesticks, technical indicators, and real-time candle line" },
  OB: { name: "Order Book", panelType: "orderbook", description: "20-level depth ladder with spread and order book imbalance" },
  OFI: { name: "Order Flow Imbalance", panelType: "microstructure", description: "OFI alpha, Micro-Price drift, Kyle's lambda & VPIN toxicity" },
  DES: { name: "Security Description", panelType: "company_des", description: "Bloomberg DES company profile, fundamentals, 52W range and business overview" },
  TS: { name: "Time & Sales", panelType: "trades", description: "Live virtualized trade tape with large transaction highlights" },
  VOL: { name: "HAR Volatility", panelType: "analytics", description: "HAR-RV realized volatility forecasts (1d, 5d, 22d)" },
  BT: { name: "Vol-Target Backtest", panelType: "analytics", description: "Volatility targeting backtest equity curve & Sharpe ratio" },
  WL: { name: "Watchlist", panelType: "watchlist", description: "Multi-symbol streaming watchlist with sparklines" },
  METRICS: { name: "System Metrics", panelType: "metrics", description: "Throughput (ticks/s), p50/p99 latency, and feed health" },
  HELP: { name: "Terminal Help", panelType: "help", description: "Shortcut reference and function command catalog" },
};

const KNOWN_EQUITIES = new Set([
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "BHARTIARTL",
  "NIFTY50",
  "NIFTY",
  "BANKNIFTY",
  "AAPL",
  "TSLA",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
]);

function normalizeSymbol(raw: string): string {
  const s = raw.toUpperCase().replace("/", "").trim();
  if (KNOWN_EQUITIES.has(s) || s.endsWith(".NS") || s.startsWith("^") || s.endsWith("USDT") || s.includes("/")) {
    return s;
  }
  if (["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "NEAR"].includes(s)) {
    return `${s}USDT`;
  }
  return s;
}

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
    // If just a function code (e.g. "GP", "OFI", "DES"), apply to current active symbol
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
    const sym = normalizeSymbol(parts[1]);
    return { isValid: true, action: "ADD_SYMBOL", symbol: sym };
  }

  if ((first === "DEL" || first === "REMOVE") && parts[1]) {
    const sym = normalizeSymbol(parts[1]);
    return { isValid: true, action: "DEL_SYMBOL", symbol: sym };
  }

  // Syntax: <FUNCTION> <SYMBOL> (e.g. "DES RELIANCE", "GP TCS", "DES BTCUSDT")
  if (parts.length >= 2 && first in SUPPORTED_FUNCTIONS) {
    const fn = first as keyof typeof SUPPORTED_FUNCTIONS;
    const sym = normalizeSymbol(parts[1]);
    return {
      isValid: true,
      action: "OPEN_PANEL",
      symbol: sym,
      panelFunction: fn as ParsedCommand["panelFunction"],
      panelType: SUPPORTED_FUNCTIONS[fn].panelType,
    };
  }

  // Syntax: <SYMBOL> <FUNCTION> (e.g. "BTC GP", "RELIANCE DES", "TCS GP", "BTC OFI")
  if (parts.length >= 2) {
    const sym = normalizeSymbol(parts[0]);
    const fn = parts[1].toUpperCase();

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
        errorMessage: `Unknown function '${fn}'. Type 'HELP' to see all commands (DES, GP, OB, OFI, TS, VOL, BT, WL).`,
      };
    }
  }

  return {
    isValid: false,
    action: "ERROR",
    errorMessage: `Unrecognized command: '${trimmed}'. Syntax: <SYMBOL> <FUNCTION> or <FUNCTION> <SYMBOL> (e.g., 'RELIANCE DES', 'DES TCS', 'BTC GP').`,
  };
}

export const AUTOCOMPLETE_ITEMS = [
  { command: "DES", description: "Security Description & Tear-Sheet for active asset", category: "NAVIGATION" },
  { command: "RELIANCE DES", description: "Open Reliance Industries Bloomberg DES profile", category: "NAVIGATION" },
  { command: "TCS DES", description: "Open Tata Consultancy Services DES profile", category: "NAVIGATION" },
  { command: "INFY DES", description: "Open Infosys DES profile", category: "NAVIGATION" },
  { command: "NIFTY50 GP", description: "Open Nifty 50 Index candlestick chart", category: "NAVIGATION" },
  { command: "GP", description: "Open Chart for active symbol", category: "NAVIGATION" },
  { command: "OB", description: "Open Order Book for active symbol", category: "NAVIGATION" },
  { command: "OFI", description: "Open Market Microstructure & OFI Alpha for active symbol", category: "NAVIGATION" },
  { command: "TS", description: "Open Time & Sales tape for active symbol", category: "NAVIGATION" },
  { command: "VOL", description: "HAR-RV Realized Volatility forecast", category: "NAVIGATION" },
  { command: "BT", description: "Volatility Targeting Strategy Backtest", category: "NAVIGATION" },
  { command: "WL", description: "Open/Focus Streaming Watchlist", category: "NAVIGATION" },
  { command: "METRICS", description: "Open Telemetry & Latency Dashboard", category: "SYSTEM" },
  { command: "HELP", description: "Show Command Catalog & Keyboard Shortcuts", category: "SYSTEM" },
  { command: "BTC GP", description: "Bitcoin Candlestick Chart", category: "NAVIGATION" },
  { command: "BTC OFI", description: "Bitcoin Order Flow Imbalance & Micro-Price", category: "NAVIGATION" },
  { command: "ETH OB", description: "Ethereum 20-Level Depth Ladder", category: "NAVIGATION" },
  { command: "SOL TS", description: "Solana Real-time Trade Tape", category: "NAVIGATION" },
  { command: "ADD RELIANCE", description: "Add Reliance Industries to watchlist", category: "WATCHLIST" },
  { command: "ADD TCS", description: "Add TCS to watchlist", category: "WATCHLIST" },
  { command: "ADD INFY", description: "Add Infosys to watchlist", category: "WATCHLIST" },
];
