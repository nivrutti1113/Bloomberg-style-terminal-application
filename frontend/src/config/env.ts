/**
 * env.ts - Centralized Terminal Environment & Network Configuration
 * Strictly resolves API and WebSocket endpoints without hardcoded localhost in components.
 * Automatically switches to wss:// when loaded over HTTPS to prevent mixed-content blocks.
 */

export const getApiBaseUrl = (): string => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const host = window.location.hostname;
    const port =
      host === "localhost" || host === "127.0.0.1"
        ? ":8000"
        : window.location.port
        ? `:${window.location.port}`
        : "";
    return `${isHttps ? "https:" : "http:"}//${host}${port}`;
  }
  // Safe default for dev SSR only
  return "http://localhost:8000";
};

export const getWsBaseUrl = (): string => {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    const isHttps = window.location.protocol === "https:";
    const host = window.location.hostname;
    const port =
      host === "localhost" || host === "127.0.0.1"
        ? ":8000"
        : window.location.port
        ? `:${window.location.port}`
        : "";
    const wsProto = isHttps ? "wss:" : "ws:";
    return `${wsProto}//${host}${port}/ws`;
  }
  // Safe default for dev SSR only
  return "ws://localhost:8000/ws";
};

export const getWsBookUrl = (symbol: string): string => {
  const clean = symbol.toUpperCase().replace("/", "");
  const baseWs = getWsBaseUrl();
  const rootWs = baseWs.replace(/\/ws\/?$/, "");
  return `${rootWs}/ws/book/${clean}`;
};
