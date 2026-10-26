"""
app.py - High-Performance Real-Time Market Data Backend (FastAPI + WebSocket + Pub/Sub).
"""

from __future__ import annotations

import asyncio
import collections
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Set

import numpy as np
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from adapters import BinanceAdapter, NSEAdapter, Tick
from analytics import calculate_har_model, calculate_vol_target_backtest, fetch_daily_data
from candle_aggregator import RealtimeCandleAggregator
from database import DatabaseManager
from order_book import OrderBookHub

logger = logging.getLogger("terminal_backend")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


# ==========================================
# Pub/Sub Layer (Redis with In-Memory Fallback)
# ==========================================
class PubSubManager:
    def __init__(self):
        self.use_redis = False
        self.redis_client = None
        self._subscribers: Set[asyncio.Queue] = set()

    async def connect(self):
        try:
            import redis.asyncio as aioredis
            self.redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
            await self.redis_client.ping()
            self.use_redis = True
            logger.info(f"Connected to Redis at {REDIS_URL}")
        except Exception as e:
            self.use_redis = False
            self.redis_client = None
            logger.info(f"Redis not available ({e}). Using in-memory broadcast bus.")

    async def publish(self, channel: str, message: dict):
        if self.use_redis and self.redis_client:
            try:
                await self.redis_client.publish(channel, json.dumps(message))
                return
            except Exception as e:
                logger.warning(f"Redis publish failed, falling back to memory: {e}")
        
        # Broadcast to local subscribers
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass

    def subscribe(self) -> asyncio.Queue:
        queue = asyncio.Queue(maxsize=10000)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        self._subscribers.discard(queue)

    async def close(self):
        if self.redis_client:
            await self.redis_client.aclose()


# ==========================================
# Metrics & Market State
# ==========================================
class TerminalState:
    def __init__(self):
        self.prices: Dict[str, dict] = {}
        self.latencies = collections.deque(maxlen=2000)
        self.tick_timestamps = collections.deque(maxlen=10000)
        self.total_ticks = 0
        self.start_time = time.time()
        self.active_clients: Set[WebSocket] = set()
        self.client_subscriptions: Dict[WebSocket, Set[str]] = {}

    def record_tick(self, tick: Tick):
        self.total_ticks += 1
        now_ms = int(time.time() * 1000)
        self.tick_timestamps.append(now_ms)

        # Latency in ms: difference between exchange event timestamp and server receive time
        latency = max(0, tick.recv_ts_ms - tick.exch_ts_ms)
        self.latencies.append(latency)

        # Update symbol price state
        current = self.prices.get(tick.symbol, {})
        open_price = current.get("open_price", tick.price)
        change_24h = tick.price - open_price if open_price > 0 else 0.0
        change_pct = (change_24h / open_price * 100.0) if open_price > 0 else 0.0

        high_24h = max(current.get("high_24h", tick.price), tick.price)
        low_24h = min(current.get("low_24h", tick.price), tick.price)
        vol_24h = current.get("volume_24h", 0.0) + tick.qty

        self.prices[tick.symbol] = {
            "symbol": tick.symbol,
            "venue": tick.venue,
            "price": tick.price,
            "qty": tick.qty,
            "change_24h": round(change_24h, 4),
            "change_pct_24h": round(change_pct, 2),
            "high_24h": round(high_24h, 4),
            "low_24h": round(low_24h, 4),
            "volume_24h": round(vol_24h, 2),
            "open_price": open_price,
            "exch_ts_ms": tick.exch_ts_ms,
            "recv_ts_ms": tick.recv_ts_ms,
        }

    def get_metrics(self, feed_connected: bool) -> dict:
        now_ms = int(time.time() * 1000)
        one_sec_ago = now_ms - 1000
        while self.tick_timestamps and self.tick_timestamps[0] < one_sec_ago:
            self.tick_timestamps.popleft()

        ticks_per_sec = len(self.tick_timestamps)

        if self.latencies:
            arr = np.array(self.latencies)
            p50 = float(np.percentile(arr, 50))
            p99 = float(np.percentile(arr, 99))
        else:
            p50 = 0.0
            p99 = 0.0

        return {
            "ticks_per_sec": ticks_per_sec,
            "total_ticks": self.total_ticks,
            "p50_latency_ms": round(p50, 1),
            "p99_latency_ms": round(p99, 1),
            "active_ws_connections": len(self.active_clients),
            "feed_status": "CONNECTED" if feed_connected else "DISCONNECTED",
            "uptime_seconds": int(time.time() - self.start_time),
            "timestamp_ms": now_ms,
        }


pubsub_mgr = PubSubManager()
state = TerminalState()
db_mgr = DatabaseManager()


def on_candle_closed(symbol: str, timeframe: str, candle: dict):
    # Store closed candle in database asynchronously
    asyncio.create_task(db_mgr.store_closed_candle(symbol, timeframe, candle))


candle_aggregator = RealtimeCandleAggregator(on_candle_closed=on_candle_closed)
book_hub = OrderBookHub()
binance_adapter = BinanceAdapter()
nse_adapter = NSEAdapter()


# ==========================================
# Lifecycle Management
# ==========================================
async def handle_incoming_tick(tick: Tick):
    state.record_tick(tick)
    candle_aggregator.process_tick(tick)
    await db_mgr.enqueue_tick(tick)
    payload = {"type": "tick", "data": tick.to_dict()}
    await pubsub_mgr.publish("market:ticks", payload)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing terminal backend...")
    await pubsub_mgr.connect()
    await db_mgr.connect()

    # Load initial 24h ticker snapshot from Binance API
    snapshots = await binance_adapter.fetch_24h_snapshot()
    for sym, snap in snapshots.items():
        state.prices[sym] = snap
    logger.info(f"Loaded 24h snapshot for {len(snapshots)} symbols.")

    # Warm up depth ladder for primary symbols
    asyncio.create_task(book_hub.ensure_started("BTCUSDT"))
    asyncio.create_task(book_hub.ensure_started("ETHUSDT"))

    # Start Binance public websocket stream
    await binance_adapter.start(handle_incoming_tick)
    await nse_adapter.start(handle_incoming_tick)

    yield

    logger.info("Shutting down terminal backend...")
    await binance_adapter.stop()
    await nse_adapter.stop()
    await book_hub.close_all()
    await db_mgr.close()
    await pubsub_mgr.close()


app = FastAPI(
    title="Real-Time Terminal Market Data Backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# REST API Endpoints
# ==========================================
@app.get("/prices")
async def get_prices():
    """Returns current prices and 24h statistics snapshot."""
    return {
        "venue": "BINANCE",
        "count": len(state.prices),
        "data": state.prices,
    }


@app.get("/metrics")
async def get_metrics():
    """Returns real-time system metrics (ticks/sec, p50/p99 latency, clients)."""
    return state.get_metrics(feed_connected=binance_adapter.is_connected)


@app.get("/venues")
async def get_venues():
    """Returns connection and compliance statuses for all market data venues."""
    return {
        "venues": [
            {
                "venue": "BINANCE",
                "market": "Crypto (Global)",
                "status": "CONNECTED" if binance_adapter.is_connected else "RECONNECTING",
                "type": "PUBLIC_WEBSOCKET",
                "delayed": False,
                "symbols_count": len(binance_adapter.symbols),
            },
            {
                "venue": "NSE",
                "market": "Indian Equities & Indices",
                "status": "CONNECTED" if nse_adapter.is_connected else "NO_CREDENTIALS",
                "type": "BROKER_API_STUB",
                "delayed": nse_adapter.is_delayed,
                "status_message": nse_adapter.status_message,
                "symbols": nse_adapter.symbols,
            },
        ]
    }


@app.get("/candles")
async def get_candles(
    symbol: str = Query("BTCUSDT", description="Market symbol, e.g. BTCUSDT"),
    tf: str = Query("1m", description="Timeframe: 1m, 5m, 15m, 1h, 1d"),
    limit: int = Query(150, ge=1, le=1000, description="Max candles"),
):
    """
    OHLCV candle endpoint.
    Aggregates live ticks in real time and merges with historical warmup.
    """
    symbol_clean = symbol.upper().replace("/", "")
    valid_tfs = {"1m", "5m", "15m", "1h", "1d"}
    timeframe = tf if tf in valid_tfs else "1m"

    try:
        candles = await candle_aggregator.get_candles_with_warmup(
            symbol=symbol_clean, timeframe=timeframe, limit=limit
        )
        return {
            "symbol": symbol_clean,
            "timeframe": timeframe,
            "count": len(candles),
            "candles": candles,
        }
    except Exception as e:
        logger.error(f"Failed to get candles for {symbol_clean}: {e}")
        return JSONResponse(status_code=502, content={"error": f"Failed to fetch candles: {str(e)}"})


@app.get("/analytics/har/{symbol}")
async def get_har_analytics(symbol: str):
    """
    HAR (Heterogeneous Autoregressive) Realized Volatility forecast.
    Wired directly to quantitative research engine.
    """
    symbol_clean = symbol.upper().replace("/", "")
    try:
        df = await fetch_daily_data(symbol_clean, limit=180)
        return calculate_har_model(df, symbol_clean)
    except Exception as e:
        logger.error(f"Error computing HAR analytics for {symbol_clean}: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to compute HAR model: {str(e)}"})


@app.get("/analytics/voltarget/{symbol}")
async def get_voltarget_analytics(symbol: str):
    """
    Volatility-Targeting backtest metrics, Sharpe ratio, drawdown, and equity curves.
    Wired directly to quantitative research backtest engine.
    """
    symbol_clean = symbol.upper().replace("/", "")
    try:
        df = await fetch_daily_data(symbol_clean, limit=180)
        return calculate_vol_target_backtest(df, symbol_clean, target_vol_annual=0.15)
    except Exception as e:
        logger.error(f"Error computing VolTarget analytics for {symbol_clean}: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to compute VolTarget backtest: {str(e)}"})


# ==========================================
# WebSocket Endpoints
# ==========================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Real-time high-throughput normalized tick stream.
    Supports client subscription to specific symbols or all symbols.
    """
    await websocket.accept()
    state.active_clients.add(websocket)
    state.client_subscriptions[websocket] = set()  # empty means all symbols

    queue = pubsub_mgr.subscribe()

    async def client_reader():
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    msg = json.loads(text)
                    action = msg.get("action")
                    if action == "subscribe":
                        symbols = {s.upper() for s in msg.get("symbols", [])}
                        state.client_subscriptions[websocket].update(symbols)
                        await websocket.send_json({"type": "subscribed", "symbols": list(state.client_subscriptions[websocket])})
                    elif action == "unsubscribe":
                        symbols = {s.upper() for s in msg.get("symbols", [])}
                        state.client_subscriptions[websocket].difference_update(symbols)
                        await websocket.send_json({"type": "unsubscribed", "symbols": list(symbols)})
                    elif action == "ping" or msg.get("type") == "ping":
                        await websocket.send_json({"type": "pong", "ts": int(time.time() * 1000)})
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    async def client_writer():
        try:
            # First, send current snapshot of all prices
            await websocket.send_json({"type": "snapshot", "data": state.prices})

            while True:
                payload = await queue.get()
                tick_data = payload.get("data")
                if tick_data:
                    symbol = tick_data.get("symbol")
                    client_subs = state.client_subscriptions.get(websocket, set())
                    # If client subscribed to specific symbols, filter; otherwise send all
                    if not client_subs or symbol in client_subs:
                        await websocket.send_json(payload)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    reader_task = asyncio.create_task(client_reader())
    writer_task = asyncio.create_task(client_writer())

    try:
        # Wait until either reader or writer terminates
        done, pending = await asyncio.wait(
            [reader_task, writer_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    finally:
        state.active_clients.discard(websocket)
        state.client_subscriptions.pop(websocket, None)
        pubsub_mgr.unsubscribe(queue)
        logger.info(f"Client disconnected. Active clients: {len(state.active_clients)}")


@app.websocket("/ws/book/{symbol}")
async def websocket_book_endpoint(websocket: WebSocket, symbol: str):
    """
    Real-time top 20 order book stream with spread, mid-price, and imbalance metrics.
    """
    await websocket.accept()
    symbol_clean = symbol.upper().replace("/", "")

    book = await book_hub.ensure_started(symbol_clean)
    queue = book.subscribe()

    try:
        # Send current book snapshot immediately if available
        if book.bids or book.asks:
            snapshot = {
                "type": "book",
                "symbol": book.symbol,
                "last_update_id": book.last_update_id,
                "bids": book.bids,
                "asks": book.asks,
                "spread": round(book.spread, 4),
                "spread_bps": round(book.spread_bps, 2),
                "mid_price": round(book.mid_price, 4),
                "imbalance_pct": round(book.imbalance_pct, 2),
                "timestamp_ms": book.last_ts_ms,
            }
            await websocket.send_json(snapshot)

        # Stream book frames to client
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Error in book websocket for {symbol_clean}: {e}")
    finally:
        book.unsubscribe(queue)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False, access_log=False)
