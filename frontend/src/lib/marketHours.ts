import { useSyncExternalStore } from "react";

/**
 * marketHours.ts - National Stock Exchange of India (NSE) Market Session Engine.
 *
 * Rules:
 * - India Standard Time (IST) is UTC + 5:30.
 * - Regular Trading Session: Monday - Friday, 09:15 - 15:30 IST.
 * - Pre-Market Session: Monday - Friday, 09:00 - 09:15 IST.
 * - Closed: Weekends (Saturday & Sunday) and Weekdays before 09:00 or after 15:30 IST.
 * - During CLOSED sessions, equity prices are strictly frozen at Last Traded Price (LTP).
 * - Crypto (BTC, ETH, etc.) operates 24/7/365 with continuous real-time execution.
 */

export interface MarketSessionInfo {
  isOpen: boolean;
  isRegular: boolean;
  isPreMarket: boolean;
  session: "REGULAR" | "PRE_MARKET" | "CLOSED" | "WEEKEND";
  badgeText: string;
  detailText: string;
  nextSessionText: string;
}

const INDIAN_EQUITY_SYMBOLS = new Set([
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
]);

/**
 * Checks if a symbol belongs to the Indian equity / derivatives market (NSE/BSE).
 */
export function isIndianSymbol(symbol: string, venue?: string): boolean {
  if (venue === "NSE" || venue === "BSE") return true;
  const s = symbol.toUpperCase().replace("/", "").trim();
  if (s.endsWith(".NS") || s.startsWith("^NSE") || s.startsWith("^CNX")) return true;
  return INDIAN_EQUITY_SYMBOLS.has(s);
}

/**
 * Calculates current market session for the National Stock Exchange of India (NSE).
 * Converts local/UTC timestamps strictly to Indian Standard Time (UTC + 05:30).
 * Safely defaults to Date.now() on client and 0 in SSR/build environments to avoid blocking prerenders.
 */
export function getNseMarketSession(nowMs?: number): MarketSessionInfo {
  // Use nowMs, or Date.now() only if running in the browser, fallback to 0 during SSR/prerender
  const ms = nowMs !== undefined ? nowMs : (typeof window !== "undefined" ? Date.now() : 0);
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(ms + istOffsetMs);

  const dayOfWeek = istDate.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Weekend check: Saturday or Sunday
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      isOpen: false,
      isRegular: false,
      isPreMarket: false,
      session: "WEEKEND",
      badgeText: "CLOSED (WEEKEND)",
      detailText: "Indian equities are closed on weekends.",
      nextSessionText: "Regular trading opens Monday at 09:15 IST",
    };
  }

  // Pre-market session: 09:00 - 09:15 IST (540 to 555 mins)
  if (timeInMinutes >= 540 && timeInMinutes < 555) {
    return {
      isOpen: true,
      isRegular: false,
      isPreMarket: true,
      session: "PRE_MARKET",
      badgeText: "PRE-MARKET",
      detailText: "NSE Pre-market order collection session (09:00 - 09:15 IST)",
      nextSessionText: "Regular trading starts at 09:15 IST",
    };
  }

  // Regular market session: 09:15 - 15:30 IST (555 to 930 mins)
  if (timeInMinutes >= 555 && timeInMinutes <= 930) {
    return {
      isOpen: true,
      isRegular: true,
      isPreMarket: false,
      session: "REGULAR",
      badgeText: "MARKET OPEN",
      detailText: "NSE Regular trading session active (09:15 - 15:30 IST)",
      nextSessionText: "Session closes at 15:30 IST",
    };
  }

  // Post-market or before market
  const isBeforeOpen = timeInMinutes < 540;
  return {
    isOpen: false,
    isRegular: false,
    isPreMarket: false,
    session: "CLOSED",
    badgeText: "MARKET CLOSED",
    detailText: "NSE Trading is closed (Session hours: 09:15 - 15:30 IST Mon-Fri)",
    nextSessionText: isBeforeOpen ? "Regular trading opens today at 09:15 IST" : "Regular trading opens tomorrow at 09:15 IST",
  };
}

const SERVER_SESSION: MarketSessionInfo = {
  isOpen: false,
  isRegular: false,
  isPreMarket: false,
  session: "CLOSED",
  badgeText: "MARKET CLOSED",
  detailText: "NSE Trading is closed (Session hours: 09:15 - 15:30 IST Mon-Fri)",
  nextSessionText: "Regular trading opens at 09:15 IST",
};

let currentSnapshot: MarketSessionInfo =
  typeof window !== "undefined" ? getNseMarketSession() : SERVER_SESSION;

const listeners = new Set<() => void>();

function updateSnapshot() {
  const next = getNseMarketSession();
  if (
    currentSnapshot.session !== next.session ||
    currentSnapshot.isOpen !== next.isOpen ||
    currentSnapshot.badgeText !== next.badgeText
  ) {
    currentSnapshot = next;
    listeners.forEach((listener) => listener());
  }
}

let tickerStarted = false;
function ensureTicker() {
  if (typeof window === "undefined" || tickerStarted) return;
  tickerStarted = true;
  setInterval(updateSnapshot, 10000);
}

function subscribeNseSession(callback: () => void): () => void {
  ensureTicker();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getClientSnapshot(): MarketSessionInfo {
  return currentSnapshot;
}

function getServerSnapshot(): MarketSessionInfo {
  return SERVER_SESSION;
}

/**
 * React hook to retrieve and automatically refresh the current NSE market session.
 * Uses useSyncExternalStore for hydration-safe external subscription without setState in effects.
 */
export function useNseMarketSession(): MarketSessionInfo {
  return useSyncExternalStore(subscribeNseSession, getClientSnapshot, getServerSnapshot);
}
