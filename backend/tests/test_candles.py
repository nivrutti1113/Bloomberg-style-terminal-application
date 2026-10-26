import pytest
import time
from adapters import Tick
from candle_aggregator import RealtimeCandleAggregator, CandleBar

def test_candle_bar_update():
    bar = CandleBar(time_sec=1729900000, price=100.0, qty=1.5)
    assert bar.open == 100.0
    assert bar.high == 100.0
    assert bar.low == 100.0
    assert bar.close == 100.0
    assert bar.volume == 1.5

    # Update with higher price
    bar.update(price=105.0, qty=2.0)
    assert bar.high == 105.0
    assert bar.low == 100.0
    assert bar.close == 105.0
    assert bar.volume == 3.5

    # Update with lower price
    bar.update(price=95.0, qty=0.5)
    assert bar.high == 105.0
    assert bar.low == 95.0
    assert bar.close == 95.0
    assert bar.volume == 4.0


def test_realtime_candle_aggregator_bucket_transitions():
    closed_candles = []

    def on_closed(symbol, tf, candle):
        closed_candles.append((symbol, tf, candle))

    aggregator = RealtimeCandleAggregator(on_candle_closed=on_closed)

    base_time_ms = 1729900000000  # Starts at some second S

    # Tick 1: at S
    t1 = Tick(venue="BINANCE", symbol="BTCUSDT", price=65000.0, qty=1.0, exch_ts_ms=base_time_ms, recv_ts_ms=base_time_ms)
    aggregator.process_tick(t1)

    # Tick 2: at S+10s (same 1m bucket)
    t2 = Tick(venue="BINANCE", symbol="BTCUSDT", price=65200.0, qty=0.5, exch_ts_ms=base_time_ms + 10000, recv_ts_ms=base_time_ms + 10000)
    aggregator.process_tick(t2)

    bar_1m = aggregator.get_current_bar("BTCUSDT", "1m")
    assert bar_1m is not None
    assert bar_1m["open"] == 65000.0
    assert bar_1m["high"] == 65200.0
    assert bar_1m["close"] == 65200.0
    assert bar_1m["volume"] == 1.5

    # Tick 3: at S+65s (new 1m bucket -> triggers close of prior candle)
    t3 = Tick(venue="BINANCE", symbol="BTCUSDT", price=65100.0, qty=2.0, exch_ts_ms=base_time_ms + 65000, recv_ts_ms=base_time_ms + 65000)
    aggregator.process_tick(t3)

    assert len(closed_candles) >= 1
    sym, tf, closed = closed_candles[0]
    assert sym == "BTCUSDT"
    assert tf == "1m"
    assert closed["open"] == 65000.0
    assert closed["high"] == 65200.0
    assert closed["close"] == 65200.0

    # New 1m bar is open
    new_bar = aggregator.get_current_bar("BTCUSDT", "1m")
    assert new_bar is not None
    assert new_bar["open"] == 65100.0
    assert new_bar["close"] == 65100.0
    assert new_bar["volume"] == 2.0
