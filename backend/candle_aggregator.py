"""
candle_aggregator.py - Real-Time In-Memory Candle Synthesis & Historical Aggregation.
Synthesizes 1m, 5m, 15m, 1h, 1d OHLCV candles from normalized ticks at 60fps.
"""

from __future__ import annotations

import collections
import logging
import time
from typing import Callable, Dict, List, Optional

import httpx

from adapters import Tick

logger = logging.getLogger("candle_aggregator")

TIMEFRAME_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "1d": 86400,
}


class CandleBar:
    __slots__ = ("time", "open", "high", "low", "close", "volume")

    def __init__(self, time_sec: int, price: float, qty: float):
        self.time = time_sec
        self.open = price
        self.high = price
        self.low = price
        self.close = price
        self.volume = qty

    def update(self, price: float, qty: float):
        if price > self.high:
            self.high = price
        if price < self.low:
            self.low = price
        self.close = price
        self.volume += qty

    def to_dict(self) -> dict:
        return {
            "time": self.time,
            "open": round(self.open, 6),
            "high": round(self.high, 6),
            "low": round(self.low, 6),
            "close": round(self.close, 6),
            "volume": round(self.volume, 4),
        }


class RealtimeCandleAggregator:
    def __init__(self, on_candle_closed: Optional[Callable[[str, str, dict], None]] = None):
        self.on_candle_closed = on_candle_closed
        # Key: (symbol, timeframe) -> CandleBar
        self.open_bars: Dict[tuple[str, str], CandleBar] = {}
        # Key: (symbol, timeframe) -> deque of closed CandleBar dicts
        self.closed_history: Dict[tuple[str, str], collections.deque] = collections.defaultdict(
            lambda: collections.deque(maxlen=1000)
        )

    def process_tick(self, tick: Tick):
        sym = tick.symbol.upper()
        exch_sec = int(tick.exch_ts_ms // 1000)

        for tf, interval_sec in TIMEFRAME_SECONDS.items():
            bucket_sec = (exch_sec // interval_sec) * interval_sec
            key = (sym, tf)

            current_bar = self.open_bars.get(key)
            if current_bar is None:
                self.open_bars[key] = CandleBar(bucket_sec, tick.price, tick.qty)
            elif current_bar.time == bucket_sec:
                current_bar.update(tick.price, tick.qty)
            elif bucket_sec > current_bar.time:
                # Close the prior bar
                closed_dict = current_bar.to_dict()
                self.closed_history[key].append(closed_dict)

                if self.on_candle_closed:
                    try:
                        self.on_candle_closed(sym, tf, closed_dict)
                    except Exception as e:
                        logger.error(f"Error in on_candle_closed callback: {e}")

                # Start new active bar
                self.open_bars[key] = CandleBar(bucket_sec, tick.price, tick.qty)

    def get_current_bar(self, symbol: str, timeframe: str) -> Optional[dict]:
        bar = self.open_bars.get((symbol.upper(), timeframe))
        return bar.to_dict() if bar else None

    async def get_candles_with_warmup(
        self, symbol: str, timeframe: str, limit: int = 150
    ) -> List[dict]:
        """
        Returns complete OHLCV dataset for charting:
        Seeds with real historical candles from Binance REST API,
        then appends locally aggregated closed and in-progress candles.
        """
        sym = symbol.upper()
        key = (sym, timeframe)
        local_closed = list(self.closed_history[key])

        # Fetch historical warmup from Binance if local history has fewer than limit bars
        historical_candles: List[dict] = []
        if len(local_closed) < limit:
            urls = [
                f"https://api.binance.com/api/v3/klines?symbol={sym}&interval={timeframe}&limit={limit}",
                f"https://api.binance.us/api/v3/klines?symbol={sym}&interval={timeframe}&limit={limit}",
            ]
            for url in urls:
                try:
                    async with httpx.AsyncClient(timeout=6.0) as client:
                        res = await client.get(url)
                        if res.status_code == 200:
                            raw = res.json()
                            for c in raw:
                                historical_candles.append({
                                    "time": int(c[0] // 1000),
                                    "open": float(c[1]),
                                    "high": float(c[2]),
                                    "low": float(c[3]),
                                    "close": float(c[4]),
                                    "volume": float(c[5]),
                                })
                            if historical_candles:
                                break
                        elif res.status_code == 451:
                            continue
                except Exception as e:
                    logger.debug(f"Could not fetch Binance klines warmup for {sym} from {url}: {e}")

        # Merge historical candles with local closed and open bars
        candle_map: Dict[int, dict] = {}
        for c in historical_candles:
            candle_map[c["time"]] = c
        for c in local_closed:
            candle_map[c["time"]] = c

        open_bar = self.open_bars.get(key)
        if open_bar:
            candle_map[open_bar.time] = open_bar.to_dict()

        sorted_candles = sorted(candle_map.values(), key=lambda x: x["time"])
        return sorted_candles[-limit:]
