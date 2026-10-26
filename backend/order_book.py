"""
order_book.py - High-Performance Real-Time Order Book Engine (20-Level Depth Ladder).
Maintains live top-20 order books with spread, mid-price, and imbalance metrics,
handling sequence reconciliation and stream reconnection.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

import httpx
import websockets

logger = logging.getLogger("order_book")


@dataclass(slots=True)
class OrderBookLevel:
    price: float
    qty: float
    total: float  # cumulative depth


@dataclass(slots=True)
class OrderBookSnapshot:
    symbol: str
    last_update_id: int
    bids: List[Tuple[float, float, float]]  # (price, qty, cumulative_total)
    asks: List[Tuple[float, float, float]]  # (price, qty, cumulative_total)
    spread: float
    spread_bps: float
    mid_price: float
    imbalance_pct: float
    timestamp_ms: int

    def to_dict(self) -> dict:
        return {
            "type": "book",
            "symbol": self.symbol,
            "last_update_id": self.last_update_id,
            "bids": self.bids,
            "asks": self.asks,
            "spread": round(self.spread, 4),
            "spread_bps": round(self.spread_bps, 2),
            "mid_price": round(self.mid_price, 4),
            "imbalance_pct": round(self.imbalance_pct, 2),
            "timestamp_ms": self.timestamp_ms,
        }


class SymbolOrderBook:
    """Maintains the top 20 order book for a single asset."""

    def __init__(self, symbol: str):
        self.symbol = symbol.upper()
        self.last_update_id: int = 0
        self.bids: List[Tuple[float, float, float]] = []
        self.asks: List[Tuple[float, float, float]] = []
        self.spread: float = 0.0
        self.spread_bps: float = 0.0
        self.mid_price: float = 0.0
        self.imbalance_pct: float = 0.0
        self.last_ts_ms: int = 0
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._listeners: Set[asyncio.Queue] = set()

    def update_from_raw(self, last_update_id: int, raw_bids: list, raw_asks: list, ts_ms: int) -> OrderBookSnapshot:
        self.last_update_id = last_update_id
        self.last_ts_ms = ts_ms

        # Process top 20 bids (descending price)
        parsed_bids: List[Tuple[float, float, float]] = []
        cum_bid = 0.0
        for item in raw_bids[:20]:
            p = float(item[0])
            q = float(item[1])
            cum_bid += q
            parsed_bids.append((p, q, cum_bid))

        # Process top 20 asks (ascending price)
        parsed_asks: List[Tuple[float, float, float]] = []
        cum_ask = 0.0
        for item in raw_asks[:20]:
            p = float(item[0])
            q = float(item[1])
            cum_ask += q
            parsed_asks.append((p, q, cum_ask))

        self.bids = parsed_bids
        self.asks = parsed_asks

        # Compute metrics
        best_bid = parsed_bids[0][0] if parsed_bids else 0.0
        best_ask = parsed_asks[0][0] if parsed_asks else 0.0

        if best_bid > 0 and best_ask > 0:
            self.spread = max(0.0, best_ask - best_bid)
            self.mid_price = (best_bid + best_ask) / 2.0
            self.spread_bps = (self.spread / self.mid_price) * 10000.0 if self.mid_price > 0 else 0.0
        else:
            self.spread = 0.0
            self.mid_price = best_bid or best_ask
            self.spread_bps = 0.0

        # Imbalance = (Bid Vol - Ask Vol) / (Bid Vol + Ask Vol) * 100
        total_vol = cum_bid + cum_ask
        if total_vol > 0:
            self.imbalance_pct = ((cum_bid - cum_ask) / total_vol) * 100.0
        else:
            self.imbalance_pct = 0.0

        snapshot = OrderBookSnapshot(
            symbol=self.symbol,
            last_update_id=self.last_update_id,
            bids=self.bids,
            asks=self.asks,
            spread=self.spread,
            spread_bps=self.spread_bps,
            mid_price=self.mid_price,
            imbalance_pct=self.imbalance_pct,
            timestamp_ms=self.last_ts_ms,
        )

        # Broadcast to subscribed queues
        payload = snapshot.to_dict()
        for q in list(self._listeners):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

        return snapshot

    async def fetch_rest_snapshot(self) -> bool:
        url = f"https://api.binance.com/api/v3/depth?symbol={self.symbol}&limit=20"
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(url)
                if res.status_code == 200:
                    data = res.json()
                    self.update_from_raw(
                        last_update_id=data.get("lastUpdateId", 0),
                        raw_bids=data.get("bids", []),
                        raw_asks=data.get("asks", []),
                        ts_ms=int(asyncio.get_event_loop().time() * 1000),
                    )
                    return True
        except Exception as e:
            logger.warning(f"Error fetching REST depth snapshot for {self.symbol}: {e}")
        return False

    async def start(self):
        if self._running:
            return
        self._running = True
        await self.fetch_rest_snapshot()
        self._task = asyncio.create_task(self._stream_loop())

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _stream_loop(self):
        """Streams top 20 depth levels every 100ms from Binance WebSocket."""
        stream_name = f"{self.symbol.lower()}@depth20@100ms"
        url = f"wss://stream.binance.com:9443/ws/{stream_name}"
        backoff = 1.0

        while self._running:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                    backoff = 1.0
                    logger.info(f"Connected to Binance depth stream for {self.symbol}")

                    async for msg in ws:
                        if not self._running:
                            break
                        try:
                            data = json.loads(msg)
                            last_update_id = data.get("lastUpdateId", 0)

                            # Ignore out-of-order stale frames
                            if self.last_update_id > 0 and last_update_id < self.last_update_id:
                                continue

                            now_ms = int(asyncio.get_event_loop().time() * 1000)
                            self.update_from_raw(
                                last_update_id=last_update_id,
                                raw_bids=data.get("bids", []),
                                raw_asks=data.get("asks", []),
                                ts_ms=now_ms,
                            )
                        except Exception as parse_err:
                            logger.error(f"Error parsing depth frame: {parse_err}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Depth stream for {self.symbol} disconnected: {e}. Reconnecting in {backoff:.1f}s...")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 1.5, 10.0)

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        self._listeners.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._listeners.discard(q)


class OrderBookHub:
    """Manages active SymbolOrderBook instances on demand."""

    def __init__(self):
        self.books: Dict[str, SymbolOrderBook] = {}

    def get_or_create(self, symbol: str) -> SymbolOrderBook:
        clean = symbol.upper().replace("/", "")
        if clean not in self.books:
            self.books[clean] = SymbolOrderBook(clean)
        return self.books[clean]

    async def ensure_started(self, symbol: str) -> SymbolOrderBook:
        book = self.get_or_create(symbol)
        await book.start()
        return book

    async def close_all(self):
        for book in self.books.values():
            await book.stop()
        self.books.clear()
