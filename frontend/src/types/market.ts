/**
 * Strict TypeScript types for Market Terminal
 */

export interface Tick {
  venue: string;
  symbol: string;
  price: number;
  qty: number;
  exch_ts_ms: number;
  recv_ts_ms: number;
}

export interface SymbolPrice {
  symbol: string;
  venue: string;
  price: number;
  qty: number;
  change_24h: number;
  change_pct_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  open_price: number;
  exch_ts_ms: number;
  recv_ts_ms: number;
  priceHistory: number[];
  flashDirection?: "up" | "down" | null;
  flashTimestamp?: number;
}

export type WsConnectionStatus = "CONNECTED" | "RECONNECTING" | "DISCONNECTED" | "STALE" | "DIRECT_FALLBACK";

export interface ServerMetrics {
  ticks_per_sec: number;
  total_ticks: number;
  p50_latency_ms: number;
  p99_latency_ms: number;
  active_ws_connections: number;
  feed_status: "CONNECTED" | "DISCONNECTED";
  uptime_seconds: number;
  timestamp_ms: number;
}

export interface OrderBookData {
  type?: string;
  symbol: string;
  last_update_id: number;
  bids: [number, number, number][]; // [price, qty, cumulative_total]
  asks: [number, number, number][]; // [price, qty, cumulative_total]
  spread: number;
  spread_bps: number;
  mid_price: number;
  imbalance_pct: number;
  timestamp_ms: number;
}

export interface CommandSuggestion {
  command: string;
  description: string;
  category: "NAVIGATION" | "WATCHLIST" | "SYSTEM";
}

export type PanelType = "watchlist" | "chart" | "orderbook" | "trades" | "analytics" | "metrics" | "help";

export interface LayoutTabConfig {
  id: string;
  name: string;
  component: PanelType;
  symbol?: string;
  functionKey?: string;
}
