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
 */
export function getNseMarketSession(nowMs: number = Date.now()): MarketSessionInfo {
  // Convert current timestamp to IST (UTC + 5 hours 30 minutes)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(nowMs + istOffsetMs);

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
