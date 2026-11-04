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
from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
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
# Pub/Sub Layer (Redis with In-Memory Dev Fallback)
# ==========================================
class PubSubManager:
    CHANNEL = "market:ticks"

    def __init__(self):
        self.use_redis = False
        self.redis_client = None
        self._subscribers: Set[asyncio.Queue] = set()
        self._listener_task: Optional[asyncio.Task] = None
        self._running = False

    async def connect(self):
        self._running = True
        try:
            import redis.asyncio as aioredis
            self.redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
            await self.redis_client.ping()
            self.use_redis = True
            logger.info(f"Connected to Redis Pub/Sub at {REDIS_URL}")
            self._listener_task = asyncio.create_task(self._redis_listener())
        except Exception as e:
            self.use_redis = False
            self.redis_client = None
            logger.info(f"Redis not available ({e}). Active Driver: IN-MEMORY BROADCAST BUS (DEV FALLBACK)")

    async def _redis_listener(self):
        """Listens to Redis tick channel and fans out to all local subscriber queues."""
        try:
            pubsub = self.redis_client.pubsub()
            await pubsub.subscribe(self.CHANNEL)
            async for raw in pubsub.listen():
                if not self._running:
                    break
                if raw and raw.get("type") == "message":
                    try:
                        msg = json.loads(raw["data"])
                        for queue in list(self._subscribers):
                            try:
                                queue.put_nowait(msg)
                            except asyncio.QueueFull:
                                pass
                    except Exception as err:
                        logger.error(f"Error parsing Redis message: {err}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"Redis subscriber loop error: {e}")

    async def publish(self, channel: str, message: dict):
        if self.use_redis and self.redis_client:
            try:
                await self.redis_client.publish(channel, json.dumps(message))
                return
            except Exception as e:
                logger.warning(f"Redis publish failed, falling back to memory: {e}")

        # Local memory bus fallback
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

    def get_status(self) -> dict:
        return {
            "driver": "REDIS" if self.use_redis else "IN_MEMORY_DEV_FALLBACK",
            "is_redis": self.use_redis,
            "active_subscribers": len(self._subscribers),
        }

    async def is_healthy(self) -> bool:
        if self.use_redis and self.redis_client:
            try:
                await self.redis_client.ping()
                return True
            except Exception:
                return False
        return True

    async def close(self):
        self._running = False
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        if self.redis_client:
            await self.redis_client.close()


# ==========================================
# Metrics & Market State
# ==========================================
class TerminalState:
    def __init__(self):
        self.prices: Dict[str, dict] = {}
        self.latencies = collections.deque(maxlen=2000)
        self.feed_latencies = collections.deque(maxlen=2000)
        self.pipeline_latencies = collections.deque(maxlen=2000)
        self.tick_timestamps = collections.deque(maxlen=10000)
        self.total_ticks = 0
        self.conflated_ticks_count = 0
        self.last_tick_time = 0
        self.start_time = time.time()
        self.active_clients: Set[WebSocket] = set()
        self.client_subscriptions: Dict[WebSocket, Set[str]] = {}

    def record_tick(self, tick: Tick):
        self.total_ticks += 1
        now_ms = int(time.time() * 1000)
        self.last_tick_time = now_ms
        self.tick_timestamps.append(now_ms)

        # Feed latency: exchange matching timestamp to server ingestion (includes internet transit + clock skew)
        feed_lat = max(0, tick.recv_ts_ms - tick.exch_ts_ms)
        self.latencies.append(feed_lat)
        self.feed_latencies.append(feed_lat)

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

    def get_metrics(self, feed_connected: bool, feed_reconnect_count: int = 0) -> dict:
        now_ms = int(time.time() * 1000)
        one_sec_ago = now_ms - 1000
        while self.tick_timestamps and self.tick_timestamps[0] < one_sec_ago:
            self.tick_timestamps.popleft()

        ticks_per_sec = len(self.tick_timestamps)
        last_tick_age_ms = (now_ms - self.last_tick_time) if self.last_tick_time > 0 else None

        feed_p50 = float(np.percentile(self.feed_latencies, 50)) if self.feed_latencies else 0.0
        feed_p99 = float(np.percentile(self.feed_latencies, 99)) if self.feed_latencies else 0.0
        pipe_p50 = float(np.percentile(self.pipeline_latencies, 50)) if self.pipeline_latencies else 0.0
        pipe_p99 = float(np.percentile(self.pipeline_latencies, 99)) if self.pipeline_latencies else 0.0

        return {
            "ticks_per_sec": ticks_per_sec,
            "total_ticks": self.total_ticks,
            "conflated_ticks": self.conflated_ticks_count,
            "last_tick_age_ms": last_tick_age_ms,
            "feed_reconnect_count": feed_reconnect_count,
            "p50_latency_ms": round(feed_p50, 1),
            "p99_latency_ms": round(feed_p99, 1),
            "feed_latency_ms": {"p50": round(feed_p50, 1), "p99": round(feed_p99, 1)},
            "pipeline_latency_ms": {"p50": round(pipe_p50, 2), "p99": round(pipe_p99, 2)},
            "active_ws_connections": len(self.active_clients),
            "feed_status": "CONNECTED" if feed_connected else "DISCONNECTED",
            "uptime_seconds": int(time.time() - self.start_time),
            "timestamp_ms": now_ms,
            "storage_driver": "TIMESCALE" if db_mgr.is_timescale else "SQLITE_DEV_FALLBACK",
            "pubsub_driver": "REDIS" if pubsub_mgr.use_redis else "IN_MEMORY_DEV_FALLBACK",
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
# Client Distribution & Conflation Layer
# ==========================================
_conflation_ticks: Dict[str, Tick] = {}
client_queues: Dict[WebSocket, asyncio.Queue] = {}
CLIENT_QUEUE_MAXSIZE = 100


def enqueue_client_message(queue: asyncio.Queue, message: dict):
    """Enqueues a message with drop-oldest policy if the bounded queue is full."""
    if queue.full():
        try:
            queue.get_nowait()  # Drop oldest item
        except asyncio.QueueEmpty:
            pass
    try:
        queue.put_nowait(message)
    except asyncio.QueueFull:
        pass


async def conflation_broadcaster_loop():
    """
    Conflates ticks per symbol for browser clients.
    Sends at most the latest tick per symbol every 100ms.
    """
    while True:
        try:
            await asyncio.sleep(0.1)  # 100ms conflation window
            if not _conflation_ticks or not client_queues:
                continue

            # Atomically extract current conflated snapshot
            ticks_batch = list(_conflation_ticks.values())
            _conflation_ticks.clear()

            for ws, q in list(client_queues.items()):
                subs = state.client_subscriptions.get(ws, set())
                for tick in ticks_batch:
                    if not subs or tick.symbol in subs:
                        payload = {"type": "tick", "data": tick.to_dict()}
                        enqueue_client_message(q, payload)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Conflation broadcaster error: {e}")


async def heartbeat_broadcaster_loop():
    """
    Sends a small {"type":"ping"} message to every WebSocket client every 15-20 seconds.
    """
    while True:
        try:
            await asyncio.sleep(15.0)
            if not client_queues:
                continue
            now_ms = int(time.time() * 1000)
            ping_msg = {"type": "ping", "ts": now_ms}
            for q in list(client_queues.values()):
                enqueue_client_message(q, ping_msg)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Heartbeat broadcaster error: {e}")


# ==========================================
# Lifecycle Management
# ==========================================
async def handle_incoming_tick(tick: Tick):
    state.record_tick(tick)
    candle_aggregator.process_tick(tick)
    await db_mgr.enqueue_tick(tick)
    # Fast non-blocking update of conflation buffer (never blocks the Binance feed)
    _conflation_ticks[tick.symbol] = tick
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

    # Background broadcast & heartbeat workers
    conflation_task = asyncio.create_task(conflation_broadcaster_loop())
    heartbeat_task = asyncio.create_task(heartbeat_broadcaster_loop())

    # Start Binance public websocket stream
    await binance_adapter.start(handle_incoming_tick)
    await nse_adapter.start(handle_incoming_tick)

    yield

    logger.info("Shutting down terminal backend...")
    conflation_task.cancel()
    heartbeat_task.cancel()
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

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
ALLOWED_ORIGINS = [o.strip() for o in raw_origins.split(",") if o.strip()]

if ENVIRONMENT == "production":
    if not ALLOWED_ORIGINS or any("*" in o for o in ALLOWED_ORIGINS):
        raise RuntimeError(
            "FATAL: In production mode, ALLOWED_ORIGINS must be set to explicit domains and cannot contain '*'. "
            f"Configured ALLOWED_ORIGINS: {ALLOWED_ORIGINS}"
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def validate_ws_origin(websocket: WebSocket) -> bool:
    """Validates incoming WebSocket Origin header against configured ALLOWED_ORIGINS."""
    origin = websocket.headers.get("origin")
    if not origin:
        # In development, local programmatic clients/benchmarks without Origin are allowed
        return ENVIRONMENT != "production"
    clean_origin = origin.rstrip("/")
    allowed_clean = [o.rstrip("/") for o in ALLOWED_ORIGINS]
    return clean_origin in allowed_clean or "*" in allowed_clean


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
    return state.get_metrics(
        feed_connected=binance_adapter.is_connected,
        feed_reconnect_count=binance_adapter.reconnect_count,
    )


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


MAX_CLIENTS = int(os.getenv("MAX_CLIENTS", "250"))
MAX_SUBSCRIPTIONS = int(os.getenv("MAX_SUBSCRIPTIONS", "25"))
MAX_MESSAGE_BYTES = 16384  # 16 KB

# Rate Limiting & Analytics Cache
ANALYTICS_RATE_LIMIT_PER_MIN = int(os.getenv("ANALYTICS_RATE_LIMIT_PER_MIN", "10"))
_analytics_request_times: Dict[str, collections.deque] = collections.defaultdict(
    lambda: collections.deque(maxlen=100)
)
_analytics_cache: Dict[str, tuple[float, dict]] = {}
ANALYTICS_CACHE_TTL_SEC = 60.0


def check_rate_limit(client_ip: str, limit_per_min: int = ANALYTICS_RATE_LIMIT_PER_MIN) -> bool:
    now = time.time()
    q = _analytics_request_times[client_ip]
    while q and (now - q[0]) > 60.0:
        q.popleft()
    if len(q) >= limit_per_min:
        return False
    q.append(now)
    return True


def get_allowed_symbols() -> Set[str]:
    return set(binance_adapter.symbols) | set(nse_adapter.symbols)


@app.api_route("/health", methods=["GET", "HEAD"])
async def health_check():
    """Liveness probe: Fast, low overhead check confirming the web worker is running."""
    return {
        "status": "healthy",
        "uptime_seconds": int(time.time() - state.start_time),
        "timestamp_ms": int(time.time() * 1000),
    }


@app.get("/ready")
async def readiness_check():
    """Readiness probe: Confirms market data feed, database, and message bus are fully operational."""
    now_ms = int(time.time() * 1000)
    uptime_sec = time.time() - state.start_time
    is_test_mode = os.getenv("TEST_MODE") == "true"

    feed_healthy = (
        (state.last_tick_time > 0 and (now_ms - state.last_tick_time) < 30000)
        or is_test_mode
        or (binance_adapter.is_running and uptime_sec < 90)
    )
    db_healthy = await db_mgr.is_healthy()
    pubsub_healthy = await pubsub_mgr.is_healthy()

    ready = feed_healthy and db_healthy and pubsub_healthy
    response_data = {
        "ready": ready,
        "feed_healthy": feed_healthy,
        "last_tick_age_ms": now_ms - state.last_tick_time if state.last_tick_time > 0 else None,
        "db_healthy": db_healthy,
        "pubsub_healthy": pubsub_healthy,
        "storage_driver": "TIMESCALE" if db_mgr.is_timescale else "SQLITE_DEV_FALLBACK",
        "pubsub_driver": "REDIS" if pubsub_mgr.use_redis else "IN_MEMORY_DEV_FALLBACK",
        "timestamp_ms": now_ms,
    }

    if not ready:
        return JSONResponse(status_code=503, content=response_data)
    return response_data


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
async def get_har_analytics(symbol: str, request: Request):
    """
    HAR (Heterogeneous Autoregressive) Realized Volatility forecast.
    Wired directly to quantitative research engine with rate limiting and 60s TTL caching.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "Rate limit exceeded (10 requests/minute). Please retry later."},
            headers={"Retry-After": "60"},
        )

    symbol_clean = symbol.upper().replace("/", "")
    cache_key = f"har:{symbol_clean}"
    now = time.time()
    if cache_key in _analytics_cache:
        cached_ts, cached_res = _analytics_cache[cache_key]
        if (now - cached_ts) < ANALYTICS_CACHE_TTL_SEC:
            return cached_res

    try:
        df = await fetch_daily_data(symbol_clean, limit=180)
        res = calculate_har_model(df, symbol_clean)
        _analytics_cache[cache_key] = (now, res)
        return res
    except Exception as e:
        logger.error(f"Error computing HAR analytics for {symbol_clean}: {e}")
        return JSONResponse(status_code=500, content={"error": f"Failed to compute HAR model: {str(e)}"})


@app.get("/analytics/voltarget/{symbol}")
async def get_voltarget_analytics(symbol: str, request: Request):
    """
    Volatility-Targeting backtest metrics, Sharpe ratio, drawdown, and equity curves.
    Wired directly to quantitative research backtest engine with rate limiting and 60s caching.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "Rate limit exceeded (10 requests/minute). Please retry later."},
            headers={"Retry-After": "60"},
        )

    symbol_clean = symbol.upper().replace("/", "")
    cache_key = f"voltarget:{symbol_clean}"
    now = time.time()
    if cache_key in _analytics_cache:
        cached_ts, cached_res = _analytics_cache[cache_key]
        if (now - cached_ts) < ANALYTICS_CACHE_TTL_SEC:
            return cached_res

    try:
        df = await fetch_daily_data(symbol_clean, limit=180)
        res = calculate_vol_target_backtest(df, symbol_clean, target_vol_annual=0.15)
        _analytics_cache[cache_key] = (now, res)
        return res
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
    Features:
    - Origin validation & connection limits
    - 100ms symbol conflation (at most the latest tick per symbol every 100ms)
    - Bounded per-client queue with drop-oldest policy (prevents slow clients from consuming RAM or crashing)
    - Heartbeat ping-pong (backend ping every 15s)
    - Non-blocking ingestion loop
    """
    if not validate_ws_origin(websocket):
        await websocket.close(code=1008, reason="Policy Violation: Disallowed Origin")
        return

    if len(state.active_clients) >= MAX_CLIENTS:
        await websocket.close(code=1008, reason="Max clients reached")
        return

    await websocket.accept()
    state.active_clients.add(websocket)
    state.client_subscriptions[websocket] = set()

    # Bounded per-client queue with drop-oldest policy
    queue = asyncio.Queue(maxsize=CLIENT_QUEUE_MAXSIZE)
    client_queues[websocket] = queue

    async def client_reader():
        try:
            while True:
                text = await websocket.receive_text()
                if len(text) > MAX_MESSAGE_BYTES:
                    await websocket.close(code=1009, reason="Message too large")
                    break

                try:
                    msg = json.loads(text)
                    action = msg.get("action")
                    if action == "subscribe":
                        req_symbols = [s.upper() for s in msg.get("symbols", [])]
                        allowed = get_allowed_symbols()
                        invalid = [s for s in req_symbols if s not in allowed]
                        if invalid:
                            enqueue_client_message(queue, {
                                "type": "error",
                                "code": 4400,
                                "message": f"Unknown symbols: {invalid}",
                                "allowed_symbols": sorted(list(allowed)),
                            })
                            continue

                        current_subs = state.client_subscriptions.get(websocket, set())
                        if len(current_subs) + len(req_symbols) > MAX_SUBSCRIPTIONS:
                            enqueue_client_message(queue, {
                                "type": "error",
                                "code": 4429,
                                "message": f"Subscription limit exceeded. Maximum {MAX_SUBSCRIPTIONS} symbols allowed.",
                            })
                            continue

                        current_subs.update(req_symbols)
                        enqueue_client_message(queue, {"type": "subscribed", "symbols": list(current_subs)})

                    elif action == "unsubscribe":
                        req_symbols = {s.upper() for s in msg.get("symbols", [])}
                        current_subs = state.client_subscriptions.get(websocket, set())
                        current_subs.difference_update(req_symbols)
                        enqueue_client_message(queue, {"type": "unsubscribed", "symbols": list(current_subs)})

                    elif action == "ping" or msg.get("type") == "ping":
                        enqueue_client_message(queue, {"type": "pong", "ts": int(time.time() * 1000)})

                    elif action == "pong" or msg.get("type") == "pong":
                        pass  # Client acknowledged heartbeat

                except json.JSONDecodeError:
                    enqueue_client_message(queue, {"type": "error", "code": 4400, "message": "Invalid JSON format"})
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.debug(f"WS reader error: {e}")

    async def client_writer():
        try:
            # First, send current snapshot of all prices
            await websocket.send_json({"type": "snapshot", "data": state.prices})

            while True:
                item = await queue.get()
                t_send_start = time.time()
                # 5.0s write timeout accommodates network jitter without disconnecting active clients
                await asyncio.wait_for(websocket.send_json(item), timeout=5.0)
                state.pipeline_latencies.append((time.time() - t_send_start) * 1000)

        except (WebSocketDisconnect, asyncio.TimeoutError):
            pass
        except Exception as e:
            logger.debug(f"WS writer error: {e}")

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
        client_queues.pop(websocket, None)
        logger.info(f"Client disconnected. Active clients: {len(state.active_clients)}")


@app.websocket("/ws/book/{symbol}")
async def websocket_book_endpoint(websocket: WebSocket, symbol: str):
    """
    Real-time top 20 order book stream with spread, mid-price, and imbalance metrics.
    """
    if not validate_ws_origin(websocket):
        await websocket.close(code=1008, reason="Policy Violation: Disallowed Origin")
        return

    if len(state.active_clients) >= MAX_CLIENTS:
        await websocket.close(code=1008, reason="Max clients reached")
        return

    await websocket.accept()
    state.active_clients.add(websocket)
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

        # Stream book frames to client with timeout
        while True:
            payload = await queue.get()
            await asyncio.wait_for(websocket.send_json(payload), timeout=5.0)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as e:
        logger.error(f"Error in book websocket for {symbol_clean}: {e}")
    finally:
        state.active_clients.discard(websocket)
        book.unsubscribe(queue)


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        access_log=False,
        ws_ping_interval=20,
        ws_ping_timeout=20,
    )
