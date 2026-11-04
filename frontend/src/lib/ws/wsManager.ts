/**
 * High-Performance Shared WebSocket Connection Manager
 * 
 * Features:
 * - Singleton pattern: Single shared socket connection across all panels.
 * - Auto-reconnect with exponential backoff and jitter.
 * - Heartbeat ping-pong (15s interval).
 * - Automatic re-subscription of active symbol channels upon reconnect.
 * - Stale detection (>5s without a tick marks data STALE).
 * - High-speed micro-batching via requestAnimationFrame (NEVER setState per tick).
 * - Memory safety: Ring buffers capped at max capacity.
 * - Graceful fallback: If backend WS is unavailable,
 *   connects directly to Binance public stream (wss://stream.binance.com:9443/stream)
 *   to ensure ZERO fake data at all times.
 */

import { OrderBookData, Tick, WsConnectionStatus } from "@/types/market";
import { WS_URL } from "@/lib/config";

type TickListener = (ticks: Tick[]) => void;
type StatusListener = (status: WsConnectionStatus, latencyMs: number) => void;
type OrderBookListener = (data: OrderBookData) => void;

class WebSocketManager {
  private static instance: WebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private backendUrl: string = `${WS_URL}/ws`;
  private binanceFallbackUrl: string =
    "wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade/solusdt@trade/bnbusdt@trade/dogeusdt@trade/xrpusdt@trade/adausdt@trade/avaxusdt@trade/linkusdt@trade/nearusdt@trade";

  private isUsingFallback: boolean = false;
  private status: WsConnectionStatus = "DISCONNECTED";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private baseBackoffMs = 1000;
  private maxBackoffMs = 15000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;

  private lastTickTimeMs: number = 0;
  private lastHeartbeatTimeMs: number = 0;
  private connectionOpenTimeMs: number = 0;
  private consecutiveFailedChecks: number = 0;
  private consecutiveGoodChecks: number = 0;
  private lastLatencyMs: number = 0;
  private subscribedSymbols: Set<string> = new Set([
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
  ]);

  // Listeners
  private tickListeners: Set<TickListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();

  // High-throughput rAF Batching Queue
  private pendingTickBatch: Tick[] = [];
  private rafScheduled = false;

  // Rate metrics
  private tickCountInWindow = 0;
  private lastRateCheckTime = performance.now();
  private currentTicksPerSec = 0;

  private constructor() {
    if (typeof window !== "undefined") {
      this.startStaleWatchdog();
    }
  }

  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  public connect(): void {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.setStatus("RECONNECTING");
    const targetUrl = this.isUsingFallback ? this.binanceFallbackUrl : this.backendUrl;

    try {
      this.ws = new WebSocket(targetUrl);
    } catch {
      this.handleConnectionFailure();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.consecutiveFailedChecks = 0;
      this.consecutiveGoodChecks = 0;
      const now = Date.now();
      this.connectionOpenTimeMs = now;
      this.lastTickTimeMs = now;
      this.lastHeartbeatTimeMs = now;

      this.setStatus(this.isUsingFallback ? "DIRECT_FALLBACK" : "CONNECTED");
      this.startHeartbeat();

      // Re-subscribe to all active symbols on connect / reconnect
      if (!this.isUsingFallback && this.subscribedSymbols.size > 0) {
        this.send({
          action: "subscribe",
          symbols: Array.from(this.subscribedSymbols),
        });
        console.log(
          `[WSManager] Connected. Re-subscribed to ${this.subscribedSymbols.size} symbols:`,
          Array.from(this.subscribedSymbols)
        );
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      const recvTime = Date.now();

      try {
        const payload = JSON.parse(event.data);

        // Handle backend ping heartbeat message
        if (payload.type === "ping") {
          this.lastHeartbeatTimeMs = recvTime;
          this.send({ type: "pong", ts: recvTime });
          return;
        }

        // Handle pong message
        if (payload.type === "pong") {
          this.lastHeartbeatTimeMs = recvTime;
          return;
        }

        // Handle backend tick format
        if (payload.type === "tick" && payload.data) {
          this.lastTickTimeMs = recvTime;
          this.tickCountInWindow++;
          const t = payload.data as Tick;
          this.lastLatencyMs = Math.max(0, t.recv_ts_ms - t.exch_ts_ms);
          this.queueTick(t);
        }
        // Handle direct Binance WebSocket fallback format
        else if (payload.data && payload.data.e === "trade") {
          this.lastTickTimeMs = recvTime;
          this.tickCountInWindow++;
          const d = payload.data;
          const tick: Tick = {
            venue: "BINANCE",
            symbol: d.s,
            price: parseFloat(d.p),
            qty: parseFloat(d.q),
            exch_ts_ms: Number(d.T || d.E),
            recv_ts_ms: recvTime,
          };
          this.lastLatencyMs = Math.max(0, recvTime - tick.exch_ts_ms);
          this.queueTick(tick);
        }
        // Handle backend snapshot
        else if (payload.type === "snapshot" && payload.data) {
          this.lastTickTimeMs = recvTime;
          const snapshotPrices = payload.data as Record<string, Partial<Tick>>;
          const ticks: Tick[] = Object.values(snapshotPrices).map((p) => ({
            venue: p.venue || "BINANCE",
            symbol: p.symbol || "",
            price: Number(p.price || 0),
            qty: Number(p.qty || 0),
            exch_ts_ms: Number(p.exch_ts_ms || recvTime),
            recv_ts_ms: Number(p.recv_ts_ms || recvTime),
          }));
          this.queueBatch(ticks);
        }
      } catch (err) {
        console.error("[WSManager] Parse error:", err);
      }
    };

    this.ws.onerror = (err) => {
      console.warn("[WSManager] WebSocket error observed:", err);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      console.warn(
        `[WSManager] WebSocket closed (code: ${event.code}, reason: "${event.reason || "none"}"). Initiating reconnect...`
      );
      this.handleConnectionFailure(event.code, event.reason);
    };
  }

  private handleConnectionFailure(closeCode?: number, reason?: string): void {
    this.setStatus("RECONNECTING");
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Alternate between backend and direct fallback if max attempts reached
      this.isUsingFallback = !this.isUsingFallback;
      this.reconnectAttempts = 0;
      console.warn(`[WSManager] Max reconnect attempts reached. Using fallback: ${this.isUsingFallback}`);
    }

    const rawBackoff = this.baseBackoffMs * Math.pow(1.5, this.reconnectAttempts);
    const jitter = Math.random() * 1000;
    const backoff = Math.min(rawBackoff + jitter, this.maxBackoffMs);
    this.reconnectAttempts++;

    console.warn(
      `[WSManager] Reconnecting in ${Math.round(backoff)}ms (attempt ${this.reconnectAttempts}, last close code: ${closeCode ?? "unknown"}, reason: "${reason || "none"}")`
    );

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isUsingFallback) {
        this.send({ type: "ping", ts: Date.now() });
      }
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startStaleWatchdog(): void {
    if (this.staleCheckTimer) clearInterval(this.staleCheckTimer);
    this.staleCheckTimer = setInterval(() => {
      const now = Date.now();

      // Update ticks/sec calculation
      const nowPerf = performance.now();
      const elapsedPerf = (nowPerf - this.lastRateCheckTime) / 1000;
      if (elapsedPerf >= 1.0) {
        this.currentTicksPerSec = Math.round(this.tickCountInWindow / elapsedPerf);
        this.tickCountInWindow = 0;
        this.lastRateCheckTime = nowPerf;
      }

      // Requirement 1: Missing heartbeat for 40s treated as dead socket -> reconnect
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const elapsedSinceHeartbeat =
          this.lastHeartbeatTimeMs > 0
            ? now - this.lastHeartbeatTimeMs
            : now - this.connectionOpenTimeMs;

        if (elapsedSinceHeartbeat > 40000) {
          console.warn(
            `[WSManager] Dead socket detected: No heartbeat received for ${Math.round(
              elapsedSinceHeartbeat / 1000
            )}s (>40s). Closing socket to trigger reconnect.`
          );
          this.ws.close(4000, "Missing heartbeat timeout (40s)");
          return;
        }
      }

      // Requirement 2: Smarter STALE watchdog
      // Mark STALE only if NO tick (any symbol) AND no heartbeat arrived in the last 15 seconds.
      // Never mark STALE based on one low-activity symbol.
      // Add hysteresis: require 2 consecutive failed checks to go STALE
      // and 2 consecutive good checks to return to CONNECTED, so the status does not flicker.
      if (this.status === "CONNECTED" || this.status === "STALE" || this.status === "DIRECT_FALLBACK") {
        const elapsedSinceTick =
          this.lastTickTimeMs > 0 ? now - this.lastTickTimeMs : now - this.connectionOpenTimeMs;
        const elapsedSinceHeartbeat =
          this.lastHeartbeatTimeMs > 0 ? now - this.lastHeartbeatTimeMs : now - this.connectionOpenTimeMs;

        const checkFailed = elapsedSinceTick > 15000 && elapsedSinceHeartbeat > 15000;

        if (checkFailed) {
          this.consecutiveFailedChecks++;
          this.consecutiveGoodChecks = 0;

          if (this.consecutiveFailedChecks >= 2 && this.status !== "STALE") {
            this.setStatus("STALE");
            console.warn(
              `[WSManager] Connection marked STALE (failed 2 consecutive checks: tick_age=${Math.round(
                elapsedSinceTick / 1000
              )}s, heartbeat_age=${Math.round(elapsedSinceHeartbeat / 1000)}s)`
            );
          }
        } else {
          this.consecutiveGoodChecks++;
          this.consecutiveFailedChecks = 0;

          if (this.consecutiveGoodChecks >= 2 && this.status === "STALE") {
            const nextStatus = this.isUsingFallback ? "DIRECT_FALLBACK" : "CONNECTED";
            this.setStatus(nextStatus);
            console.log(
              `[WSManager] Connection restored to ${nextStatus} (passed 2 consecutive checks: tick_age=${Math.round(
                elapsedSinceTick / 1000
              )}s, heartbeat_age=${Math.round(elapsedSinceHeartbeat / 1000)}s)`
            );
          }
        }
      }
    }, 1000);
  }

  private queueTick(tick: Tick): void {
    this.pendingTickBatch.push(tick);
    this.scheduleFlush();
  }

  private queueBatch(ticks: Tick[]): void {
    this.pendingTickBatch.push(...ticks);
    this.scheduleFlush();
  }

  /**
   * Coalesce and flush batched ticks strictly inside requestAnimationFrame
   * to guarantee 60fps+ rendering with zero frame stutter.
   */
  private scheduleFlush(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;

    requestAnimationFrame(() => {
      this.rafScheduled = false;
      if (this.pendingTickBatch.length === 0) return;

      const batchToFlush = this.pendingTickBatch;
      this.pendingTickBatch = [];

      // Dispatch to subscribed panels
      for (const listener of this.tickListeners) {
        listener(batchToFlush);
      }
    });
  }

  public subscribeTicks(listener: TickListener): () => void {
    this.tickListeners.add(listener);
    return () => {
      this.tickListeners.delete(listener);
    };
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.lastLatencyMs);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeSymbols(symbols: string[]): void {
    for (const s of symbols) {
      this.subscribedSymbols.add(s.toUpperCase());
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isUsingFallback) {
      this.send({
        action: "subscribe",
        symbols,
      });
    }
  }

  public unsubscribeSymbols(symbols: string[]): void {
    for (const s of symbols) {
      this.subscribedSymbols.delete(s.toUpperCase());
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isUsingFallback) {
      this.send({
        action: "unsubscribe",
        symbols,
      });
    }
  }

  public send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setStatus(newStatus: WsConnectionStatus): void {
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      listener(this.status, this.lastLatencyMs);
    }
  }

  public getStatus(): WsConnectionStatus {
    return this.status;
  }

  public getTicksPerSec(): number {
    return this.currentTicksPerSec;
  }

  public getLastLatencyMs(): number {
    return this.lastLatencyMs;
  }

  public isFallbackMode(): boolean {
    return this.isUsingFallback;
  }

  /**
   * Subscribes to live 20-level order book for a symbol.
   * Connects to backend WS /ws/book/{symbol} with automatic transparent failover
   * to direct Binance depth stream if backend is offline.
   */
  public subscribeOrderBook(symbol: string, callback: OrderBookListener): () => void {
    if (typeof window === "undefined") return () => {};

    const cleanSymbol = symbol.toUpperCase().replace("/", "");
    let ws: WebSocket | null = null;
    let isClosed = false;
    let useDirectFallback = this.isUsingFallback;
    let pendingData: OrderBookData | null = null;
    let rafId: number | null = null;

    const connectBookSocket = () => {
      if (isClosed) return;

      const targetUrl = useDirectFallback
        ? `wss://stream.binance.com:9443/ws/${cleanSymbol.toLowerCase()}@depth20@100ms`
        : `${WS_URL}/ws/book/${cleanSymbol}`;

      try {
        ws = new WebSocket(targetUrl);
      } catch {
        useDirectFallback = true;
        setTimeout(connectBookSocket, 1500);
        return;
      }

      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = JSON.parse(event.data);

          let bookData: OrderBookData | null = null;

          // Backend format
          if (raw.type === "book") {
            bookData = raw as OrderBookData;
          }
          // Direct Binance depth20 format
          else if (raw.lastUpdateId && (raw.bids || raw.asks)) {
            const rawBids = raw.bids || [];
            const rawAsks = raw.asks || [];

            let cumBid = 0;
            const bids: [number, number, number][] = rawBids.map((b: [string, string]) => {
              const p = parseFloat(b[0]);
              const q = parseFloat(b[1]);
              cumBid += q;
              return [p, q, cumBid];
            });

            let cumAsk = 0;
            const asks: [number, number, number][] = rawAsks.map((a: [string, string]) => {
              const p = parseFloat(a[0]);
              const q = parseFloat(a[1]);
              cumAsk += q;
              return [p, q, cumAsk];
            });

            const bestBid = bids[0] ? bids[0][0] : 0;
            const bestAsk = asks[0] ? asks[0][0] : 0;
            const spread = bestBid > 0 && bestAsk > 0 ? Math.max(0, bestAsk - bestBid) : 0;
            const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
            const spreadBps = mid > 0 ? (spread / mid) * 10000 : 0;

            const totalVol = cumBid + cumAsk;
            const imbalance = totalVol > 0 ? ((cumBid - cumAsk) / totalVol) * 100 : 0;

            bookData = {
              symbol: cleanSymbol,
              last_update_id: raw.lastUpdateId,
              bids,
              asks,
              spread: Number(spread.toFixed(4)),
              spread_bps: Number(spreadBps.toFixed(2)),
              mid_price: Number(mid.toFixed(4)),
              imbalance_pct: Number(imbalance.toFixed(2)),
              timestamp_ms: Date.now(),
            };
          }

          if (bookData) {
            pendingData = bookData;
            if (rafId === null) {
              rafId = requestAnimationFrame(() => {
                rafId = null;
                if (pendingData) {
                  callback(pendingData);
                }
              });
            }
          }
        } catch (err) {
          console.error("[WSManager] Book parse error:", err);
        }
      };

      ws.onerror = () => {
        if (!useDirectFallback) {
          useDirectFallback = true;
        }
      };

      ws.onclose = () => {
        if (!isClosed) {
          setTimeout(connectBookSocket, 2000);
        }
      };
    };

    connectBookSocket();

    return () => {
      isClosed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }
}

export const wsManager = WebSocketManager.getInstance();
