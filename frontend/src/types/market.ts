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
  conflated_ticks?: number;
  last_tick_age_ms?: number | null;
  feed_reconnect_count?: number;
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
  micro_price?: number;
  micro_price_bias_bps?: number;
  ofi_l1?: number;
  deep_ofi?: number;
  cumulative_ofi?: number;
  ofi_zscore?: number;
  kyle_lambda?: number;
  predicted_impact_bps?: number;
  vpin?: number;
  vpin_state?: "LOW" | "MODERATE" | "TOXIC";
  regime?: "STRONG_BUY_PRESSURE" | "STRONG_SELL_PRESSURE" | "BALANCED";
}

export interface MicrostructureTimeseriesPoint {
  t: number;
  ofi: number;
  cum_ofi: number;
  micro_bias: number;
  mid: number;
  vpin: number;
}

export interface MicrostructureCurrent {
  symbol: string;
  timestamp_ms: number;
  best_bid: number;
  best_ask: number;
  mid_price: number;
  micro_price: number;
  micro_price_bias_bps: number;
  ofi_l1: number;
  deep_ofi: number;
  cumulative_ofi: number;
  ofi_zscore: number;
  kyle_lambda: number;
  predicted_impact_bps: number;
  vpin: number;
  vpin_state: "LOW" | "MODERATE" | "TOXIC";
  regime: "STRONG_BUY_PRESSURE" | "STRONG_SELL_PRESSURE" | "BALANCED";
}

export interface MicrostructureData {
  symbol: string;
  current: MicrostructureCurrent | null;
  timeseries: MicrostructureTimeseriesPoint[];
  timestamp_ms: number;
}

export interface CommandSuggestion {
  command: string;
  description: string;
  category: "NAVIGATION" | "WATCHLIST" | "SYSTEM";
}

export type PanelType = "watchlist" | "chart" | "orderbook" | "trades" | "analytics" | "metrics" | "help" | "microstructure";

export interface LayoutTabConfig {
  id: string;
  name: string;
  component: PanelType;
  symbol?: string;
  functionKey?: string;
}
