/**
 * config.ts - Centralized API and WebSocket Endpoint Configuration
 *
 * Rules:
 * - API_URL = process.env.NEXT_PUBLIC_API_URL
 * - WS_URL = process.env.NEXT_PUBLIC_WS_URL, or derived from API_URL (https -> wss, http -> ws) if missing
 * - Strip trailing slashes
 * - NEVER derive the URL from window.location in production
 * - Fall back to http://localhost:8000 / ws://localhost:8000 only when NODE_ENV === "development"
 * - If variables are missing in production, console.error a clear message
 * - Log the resolved API_URL and WS_URL once in the browser console on startup
 */

const isDev = process.env.NODE_ENV === "development";

// 1. Resolve API_URL
let resolvedApiUrl = "";
if (process.env.NEXT_PUBLIC_API_URL) {
  resolvedApiUrl = process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "");
} else if (isDev) {
  resolvedApiUrl = "http://localhost:8000";
} else {
  if (typeof window !== "undefined") {
    console.error(
      "[CONFIG ERROR] NEXT_PUBLIC_API_URL is missing in production environment. Backend REST calls will fail."
    );
  }
}

// 2. Resolve WS_URL
let resolvedWsUrl = "";
if (process.env.NEXT_PUBLIC_WS_URL) {
  // Strip trailing slashes and any trailing /ws so WS_URL serves as a clean base URL
  resolvedWsUrl = process.env.NEXT_PUBLIC_WS_URL.replace(/\/+$/, "").replace(/\/ws$/, "");
} else if (resolvedApiUrl) {
  // Derive from API_URL (https -> wss, http -> ws)
  resolvedWsUrl = resolvedApiUrl
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");
} else if (isDev) {
  resolvedWsUrl = "ws://localhost:8000";
} else {
  if (typeof window !== "undefined") {
    console.error(
      "[CONFIG ERROR] NEXT_PUBLIC_WS_URL and NEXT_PUBLIC_API_URL are missing in production environment. WebSocket feeds will fail."
    );
  }
}

export const API_URL = resolvedApiUrl;
export const WS_URL = resolvedWsUrl;

// Log resolved endpoints once in browser console on startup
if (typeof window !== "undefined") {
  const win = window as unknown as { __TERMINAL_CONFIG_LOGGED__?: boolean };
  if (!win.__TERMINAL_CONFIG_LOGGED__) {
    win.__TERMINAL_CONFIG_LOGGED__ = true;
    console.log(`[TERMINAL CONFIG] API_URL: ${API_URL}`);
    console.log(`[TERMINAL CONFIG] WS_URL: ${WS_URL}`);
  }
}
