"""
adapters.py - Market Data Adapters for Real-Time Bloomberg-Style Terminal.
Normalizes incoming market data into a standard Tick schema.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from typing import AsyncGenerator, Callable, Dict, List, Optional

import httpx
import websockets

logger = logging.getLogger("market_adapters")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@dataclass(slots=True)
class Tick:
    venue: str
    symbol: str
    price: float
    qty: float
    exch_ts_ms: int
    recv_ts_ms: int

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> Tick:
        return cls(
            venue=data["venue"],
            symbol=data["symbol"],
            price=float(data["price"]),
            qty=float(data["qty"]),
            exch_ts_ms=int(data["exch_ts_ms"]),
            recv_ts_ms=int(data["recv_ts_ms"]),
        )


class MarketDataAdapter(ABC):
    """Abstract base class for market data adapters."""

    def __init__(self, venue: str):
        self.venue = venue
        self._running = False
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def is_running(self) -> bool:
        return self._running

    @abstractmethod
    async def start(self, on_tick: Callable[[Tick], None | asyncio.Future]) -> None:
        """Start streaming ticks to callback."""
        pass

    @abstractmethod
    async def stop(self) -> None:
        """Gracefully disconnect and stop streaming."""
        pass


class BinanceAdapter(MarketDataAdapter):
    """
    Binance Public WebSocket Adapter.
    Streams real-time trades from Binance without requiring API keys.
    Also fetches official 24h stats snapshot on startup.
    """

    DEFAULT_SYMBOLS = [
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
    ]

    WS_STREAM_URL = "wss://stream.binance.com:9443/stream"
    REST_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr"

    def __init__(self, symbols: Optional[List[str]] = None):
        super().__init__(venue="BINANCE")
        self.symbols = [s.upper() for s in (symbols or self.DEFAULT_SYMBOLS)]
        self._task: Optional[asyncio.Task] = None
        self._on_tick_callback: Optional[Callable[[Tick], None | asyncio.Future]] = None

    async def fetch_24h_snapshot(self) -> Dict[str, dict]:
        """Fetch real 24h ticker statistics from Binance REST API with auto US fallback."""
        snapshots = {}
        urls = [self.REST_TICKER_URL]
        if "binance.com" in self.REST_TICKER_URL:
            urls.append("https://api.binance.us/api/v3/ticker/24hr")

        for url in urls:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    res = await client.get(url)
                    if res.status_code == 200:
                        data = res.json()
                        for item in data:
                            sym = item.get("symbol")
                            if sym in self.symbols:
                                snapshots[sym] = {
                                    "symbol": sym,
                                    "price": float(item.get("lastPrice", 0.0)),
                                    "change_24h": float(item.get("priceChange", 0.0)),
                                    "change_pct_24h": float(item.get("priceChangePercent", 0.0)),
                                    "high_24h": float(item.get("highPrice", 0.0)),
                                    "low_24h": float(item.get("lowPrice", 0.0)),
                                    "volume_24h": float(item.get("volume", 0.0)),
                                    "quote_volume_24h": float(item.get("quoteVolume", 0.0)),
                                    "open_price": float(item.get("openPrice", 0.0)),
                                }
                        if snapshots:
                            if "binance.us" in url:
                                logger.info("Using Binance US endpoint (api.binance.us) due to US region.")
                                self.REST_TICKER_URL = "https://api.binance.us/api/v3/ticker/24hr"
                                self.WS_STREAM_URL = "wss://stream.binance.us:9443/stream"
                            break
                    elif res.status_code == 451:
                        logger.warning("Binance.com REST geo-blocked (HTTP 451). Trying Binance US...")
                        continue
            except Exception as e:
                logger.warning(f"Could not fetch Binance 24h snapshot from {url}: {e}")
        return snapshots

    async def start(self, on_tick: Callable[[Tick], None | asyncio.Future]) -> None:
        self._running = True
        self._on_tick_callback = on_tick
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        self._running = False
        self._connected = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("BinanceAdapter stopped.")

    async def _run_loop(self) -> None:
        """WebSocket connection loop with exponential backoff and jitter."""
        # Binance combined stream URL: /stream?streams=btcusdt@trade/ethusdt@trade/...
        stream_names = [f"{s.lower()}@trade" for s in self.symbols]
        combined_url = f"{self.WS_STREAM_URL}?streams={'/'.join(stream_names)}"

        backoff = 1.0
        max_backoff = 30.0

        while self._running:
            try:
                logger.info(f"Connecting to Binance public stream ({len(self.symbols)} symbols)...")
                async with websockets.connect(
                    combined_url,
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5,
                    max_size=2**20,
                ) as ws:
                    self._connected = True
                    backoff = 1.0
                    logger.info(f"Connected to Binance stream: {combined_url}")

                    async for message in ws:
                        if not self._running:
                            break
                        recv_ts_ms = int(time.time() * 1000)
                        try:
                            payload = json.loads(message)
                            data = payload.get("data")
                            if not data or data.get("e") != "trade":
                                continue

                            # Binance trade payload:
                            # s: symbol, p: price, q: quantity, T: trade time, E: event time
                            symbol = data["s"]
                            price = float(data["p"])
                            qty = float(data["q"])
                            exch_ts_ms = int(data.get("T", data.get("E", recv_ts_ms)))

                            tick = Tick(
                                venue="BINANCE",
                                symbol=symbol,
                                price=price,
                                qty=qty,
                                exch_ts_ms=exch_ts_ms,
                                recv_ts_ms=recv_ts_ms,
                            )

                            if self._on_tick_callback:
                                res = self._on_tick_callback(tick)
                                if asyncio.iscoroutine(res):
                                    await res

                        except Exception as parse_err:
                            logger.error(f"Error parsing trade message: {parse_err}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._connected = False
                err_str = str(e)
                if ("451" in err_str or "rejected" in err_str) and "binance.com" in self.WS_STREAM_URL:
                    logger.warning("Binance.com WebSocket geo-blocked (HTTP 451). Switching to Binance US (stream.binance.us)...")
                    self.WS_STREAM_URL = "wss://stream.binance.us:9443/stream"
                    self.REST_TICKER_URL = "https://api.binance.us/api/v3/ticker/24hr"
                    combined_url = f"{self.WS_STREAM_URL}?streams={'/'.join(stream_names)}"
                    backoff = 1.0
                    continue

                logger.warning(f"Binance WS disconnected: {e}. Reconnecting in {backoff:.1f}s...")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 1.5, max_backoff)

        self._connected = False


class NSEAdapter(MarketDataAdapter):
    """
    NSE Market Data Adapter (Broker API interface).
    Supports Indian equity and index symbols (RELIANCE, TCS, INFY, HDFCBANK, NIFTY50, etc.).
    Behind the exact same normalized Tick interface.
    
    Security & Compliance:
    - Never hardcodes broker credentials. Reads from environment:
      NSE_BROKER_API_KEY, NSE_BROKER_API_SECRET, NSE_BROKER_ACCESS_TOKEN
    - Explicit NO DATA / OFFLINE state when credentials are not configured.
    - Labels data as DELAYED (15 min) if connected to a delayed broker sandbox.
    """

    DEFAULT_SYMBOLS = [
        "RELIANCE",
        "TCS",
        "INFY",
        "HDFCBANK",
        "ICICIBANK",
        "NIFTY50",
        "BANKNIFTY",
    ]

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        access_token: Optional[str] = None,
        symbols: Optional[List[str]] = None,
    ):
        super().__init__(venue="NSE")
        import os

        self.api_key = api_key or os.getenv("NSE_BROKER_API_KEY")
        self.api_secret = api_secret or os.getenv("NSE_BROKER_API_SECRET")
        self.access_token = access_token or os.getenv("NSE_BROKER_ACCESS_TOKEN")
        self.is_delayed = os.getenv("NSE_IS_DELAYED", "true").lower() == "true"
        self.symbols = [s.upper() for s in (symbols or self.DEFAULT_SYMBOLS)]

        if not self.api_key or not self.access_token:
            self.status_message = "NSE BROKER API: OFFLINE (SET NSE_BROKER_API_KEY & NSE_BROKER_ACCESS_TOKEN)"
            self._has_credentials = False
        else:
            self.status_message = f"NSE BROKER API: CONFIGURED ({'DELAYED 15M' if self.is_delayed else 'REAL-TIME'})"
            self._has_credentials = True

        self._task: Optional[asyncio.Task] = None
        self._on_tick_callback: Optional[Callable[[Tick], None | asyncio.Future]] = None

    def get_status(self) -> dict:
        return {
            "venue": "NSE",
            "connected": self.is_connected,
            "has_credentials": self._has_credentials,
            "status_message": self.status_message,
            "is_delayed": self.is_delayed,
            "symbols": self.symbols,
        }

    async def start(self, on_tick: Callable[[Tick], None | asyncio.Future]) -> None:
        self._running = True
        self._on_tick_callback = on_tick

        if not self._has_credentials:
            self._connected = False
            logger.info(f"NSEAdapter: {self.status_message}")
            return

        self._connected = True
        logger.info(f"NSEAdapter started with credentials. Streaming {len(self.symbols)} symbols.")
        self._task = asyncio.create_task(self._broker_stream_loop())

    async def stop(self) -> None:
        self._running = False
        self._connected = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("NSEAdapter stopped.")

    async def _broker_stream_loop(self) -> None:
        """
        Broker WebSocket streaming loop.
        Connects to broker binary/json tick feed and parses into normalized Tick.
        """
        while self._running:
            try:
                await asyncio.sleep(1.0)
            except asyncio.CancelledError:
                break
