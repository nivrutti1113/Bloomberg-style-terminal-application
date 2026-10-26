import pytest
import time
from adapters import Tick, BinanceAdapter, NSEAdapter

def test_tick_normalization():
    data = {
        "venue": "BINANCE",
        "symbol": "BTCUSDT",
        "price": 68500.5,
        "qty": 0.25,
        "exch_ts_ms": 1729900000000,
        "recv_ts_ms": 1729900000045,
    }
    tick = Tick.from_dict(data)
    assert tick.venue == "BINANCE"
    assert tick.symbol == "BTCUSDT"
    assert tick.price == 68500.5
    assert tick.qty == 0.25
    assert tick.recv_ts_ms - tick.exch_ts_ms == 45

    serialized = tick.to_dict()
    assert serialized["symbol"] == "BTCUSDT"
    assert serialized["price"] == 68500.5


def test_nse_adapter_stub_safe_no_data():
    adapter = NSEAdapter()
    assert adapter.venue == "NSE"
    assert adapter.is_connected is False
    status = adapter.get_status()
    assert status["has_credentials"] is False
    assert status["venue"] == "NSE"
    assert "RELIANCE" in status["symbols"]


def test_binance_adapter_init():
    adapter = BinanceAdapter(symbols=["BTCUSDT", "ETHUSDT"])
    assert adapter.venue == "BINANCE"
    assert "BTCUSDT" in adapter.symbols
    assert "ETHUSDT" in adapter.symbols
    assert adapter.is_connected is False
