import pytest
from order_book import SymbolOrderBook, OrderBookSnapshot

def test_order_book_metrics_calculation():
    book = SymbolOrderBook("BTCUSDT")

    raw_bids = [
        ["68000.0", "1.5"],
        ["67990.0", "2.0"],
        ["67980.0", "3.0"],
    ]
    raw_asks = [
        ["68010.0", "1.0"],
        ["68020.0", "2.5"],
        ["68030.0", "1.5"],
    ]

    snapshot = book.update_from_raw(
        last_update_id=1001,
        raw_bids=raw_bids,
        raw_asks=raw_asks,
        ts_ms=1729900000000,
    )

    assert snapshot.symbol == "BTCUSDT"
    assert snapshot.last_update_id == 1001

    # Best bid is 68000, best ask is 68010 -> spread is 10.0
    assert snapshot.spread == 10.0
    # Mid price is (68000 + 68010) / 2 = 68005.0
    assert snapshot.mid_price == 68005.0
    # Spread bps = (10 / 68005) * 10000 ~ 1.47 bps
    assert round(snapshot.spread_bps, 2) == 1.47

    # Cumulative bid total = 1.5 + 2.0 + 3.0 = 6.5
    assert snapshot.bids[0] == (68000.0, 1.5, 1.5)
    assert snapshot.bids[1] == (67990.0, 2.0, 3.5)
    assert snapshot.bids[2] == (67980.0, 3.0, 6.5)

    # Cumulative ask total = 1.0 + 2.5 + 1.5 = 5.0
    assert snapshot.asks[0] == (68010.0, 1.0, 1.0)
    assert snapshot.asks[1] == (68020.0, 2.5, 3.5)
    assert snapshot.asks[2] == (68030.0, 1.5, 5.0)

    # Imbalance: (6.5 - 5.0) / (6.5 + 5.0) * 100 = 1.5 / 11.5 * 100 ~ 13.04%
    assert round(snapshot.imbalance_pct, 2) == 13.04


def test_order_book_imbalance_all_bids():
    book = SymbolOrderBook("SOLUSDT")
    raw_bids = [["150.0", "10.0"]]
    raw_asks = []
    snapshot = book.update_from_raw(100, raw_bids, raw_asks, 1729900000)
    assert snapshot.imbalance_pct == 100.0
    assert snapshot.spread == 0.0


def test_order_book_imbalance_all_asks():
    book = SymbolOrderBook("SOLUSDT")
    raw_bids = []
    raw_asks = [["152.0", "10.0"]]
    snapshot = book.update_from_raw(101, raw_bids, raw_asks, 1729900000)
    assert snapshot.imbalance_pct == -100.0
    assert snapshot.spread == 0.0
