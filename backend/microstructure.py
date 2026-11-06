"""
microstructure.py - High-Frequency Market Microstructure & Order Flow Imbalance (OFI) Engine.
Implements:
1. Cont, Kukanov & Stoikov (2014) Level-1 Order Flow Imbalance (OFI).
2. Multi-Level Deep Order Flow Imbalance (Deep OFI across top 5 levels).
3. Stoikov (2018) Volume-Weighted Micro-Price & Fair Value Drift (bps).
4. Kyle's Lambda (empirical price impact parameter: dP = lambda * OFI).
5. Easley, Lopez de Prado & O'Hara (2012) VPIN (Volume-Synchronized Probability of Toxicity).
"""

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(slots=True)
class MicrostructureMetrics:
    symbol: str
    timestamp_ms: int
    best_bid: float
    best_ask: float
    mid_price: float
    micro_price: float
    micro_price_bias_bps: float
    ofi_l1: float
    deep_ofi: float
    cumulative_ofi: float
    ofi_zscore: float
    kyle_lambda: float
    predicted_impact_bps: float
    vpin: float
    vpin_state: str  # "LOW", "MODERATE", "TOXIC"
    regime: str      # "STRONG_BUY_PRESSURE", "STRONG_SELL_PRESSURE", "BALANCED"

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "timestamp_ms": self.timestamp_ms,
            "best_bid": round(self.best_bid, 4),
            "best_ask": round(self.best_ask, 4),
            "mid_price": round(self.mid_price, 4),
            "micro_price": round(self.micro_price, 4),
            "micro_price_bias_bps": round(self.micro_price_bias_bps, 3),
            "ofi_l1": round(self.ofi_l1, 4),
            "deep_ofi": round(self.deep_ofi, 4),
            "cumulative_ofi": round(self.cumulative_ofi, 4),
            "ofi_zscore": round(self.ofi_zscore, 2),
            "kyle_lambda": round(self.kyle_lambda, 6),
            "predicted_impact_bps": round(self.predicted_impact_bps, 3),
            "vpin": round(self.vpin, 3),
            "vpin_state": self.vpin_state,
            "regime": self.regime,
        }


class MicrostructureTracker:
    """
    Maintains real-time microstructure state for a given symbol.
    """

    def __init__(self, symbol: str, vpin_bucket_size: float = 5.0, history_len: int = 150):
        self.symbol = symbol.upper()
        self.vpin_bucket_size = vpin_bucket_size
        self.history_len = history_len

        # Level 1 book state (price, qty)
        self.prev_best_bid: Optional[Tuple[float, float]] = None
        self.prev_best_ask: Optional[Tuple[float, float]] = None

        # Multi-level book state: list of (price, qty)
        self.prev_bids_top5: Optional[List[Tuple[float, float]]] = None
        self.prev_asks_top5: Optional[List[Tuple[float, float]]] = None

        # Cumulative and rolling metrics
        self.cumulative_ofi: float = 0.0
        self.ofi_history: deque[float] = deque(maxlen=history_len)
        self.mid_price_history: deque[float] = deque(maxlen=history_len)
        self.timeseries_history: deque[dict] = deque(maxlen=100)

        # VPIN variables
        self.vpin_current_buy: float = 0.0
        self.vpin_current_sell: float = 0.0
        self.vpin_buckets: deque[float] = deque(maxlen=25)  # |V_buy - V_sell| per filled bucket
        self.last_vpin: float = 0.28  # default baseline

        # Current computed metrics
        self.latest_metrics: Optional[MicrostructureMetrics] = None

    def update_book(
        self,
        bids: List[Tuple[float, float, float]],
        asks: List[Tuple[float, float, float]],
        ts_ms: int,
    ) -> MicrostructureMetrics:
        """
        bids: list of (price, qty, cumulative_total) sorted descending
        asks: list of (price, qty, cumulative_total) sorted ascending
        """
        if not bids or not asks:
            return self._fallback_metrics(ts_ms)

        curr_bid_p, curr_bid_q = bids[0][0], bids[0][1]
        curr_ask_p, curr_ask_q = asks[0][0], asks[0][1]
        mid_price = (curr_bid_p + curr_ask_p) / 2.0 if (curr_bid_p > 0 and curr_ask_p > 0) else 0.0

        # 1. Stoikov (2018) Volume-Weighted Micro-Price
        total_top_qty = curr_bid_q + curr_ask_q
        if total_top_qty > 0 and curr_bid_p > 0 and curr_ask_p > 0:
            micro_price = (curr_bid_q * curr_ask_p + curr_ask_q * curr_bid_p) / total_top_qty
        else:
            micro_price = mid_price

        micro_bias_bps = ((micro_price - mid_price) / mid_price) * 10000.0 if mid_price > 0 else 0.0

        # 2. Cont, Kukanov & Stoikov (2014) Level-1 OFI calculation
        ofi_l1 = 0.0
        if self.prev_best_bid is not None and self.prev_best_ask is not None:
            prev_bid_p, prev_bid_q = self.prev_best_bid
            prev_ask_p, prev_ask_q = self.prev_best_ask

            # Delta Bids
            if curr_bid_p > prev_bid_p:
                delta_b = curr_bid_q
            elif curr_bid_p == prev_bid_p:
                delta_b = curr_bid_q - prev_bid_q
            else:
                delta_b = -prev_bid_q

            # Delta Asks
            if curr_ask_p > prev_ask_p:
                delta_a = -prev_ask_q
            elif curr_ask_p == prev_ask_p:
                delta_a = curr_ask_q - prev_ask_q
            else:
                delta_a = curr_ask_q

            ofi_l1 = delta_b - delta_a

        # 3. Multi-Level Deep OFI (top 5 levels with geometric weights w_k = 1 / sqrt(k))
        deep_ofi = ofi_l1
        curr_bids_top5 = [(b[0], b[1]) for b in bids[:5]]
        curr_asks_top5 = [(a[0], a[1]) for a in asks[:5]]

        if self.prev_bids_top5 is not None and self.prev_asks_top5 is not None:
            deep_sum = 0.0
            weight_sum = 0.0
            levels_count = min(len(curr_bids_top5), len(self.prev_bids_top5), len(curr_asks_top5), len(self.prev_asks_top5), 5)
            for k in range(levels_count):
                w = 1.0 / math.sqrt(k + 1)
                cb_p, cb_q = curr_bids_top5[k]
                pb_p, pb_q = self.prev_bids_top5[k]
                ca_p, ca_q = curr_asks_top5[k]
                pa_p, pa_q = self.prev_asks_top5[k]

                db = cb_q if cb_p > pb_p else (cb_q - pb_q if cb_p == pb_p else -pb_q)
                da = -pa_q if ca_p > pa_p else (ca_q - pa_q if ca_p == pa_p else ca_q)
                deep_sum += w * (db - da)
                weight_sum += w

            if weight_sum > 0:
                deep_ofi = deep_sum / weight_sum

        # Update cached previous states
        self.prev_best_bid = (curr_bid_p, curr_bid_q)
        self.prev_best_ask = (curr_ask_p, curr_ask_q)
        self.prev_bids_top5 = curr_bids_top5
        self.prev_asks_top5 = curr_asks_top5

        # 4. Rolling statistics & Cumulative OFI
        self.cumulative_ofi += ofi_l1
        self.ofi_history.append(ofi_l1)
        self.mid_price_history.append(mid_price)

        n = len(self.ofi_history)
        if n >= 5:
            mean_ofi = sum(self.ofi_history) / n
            variance = sum((x - mean_ofi) ** 2 for x in self.ofi_history) / n
            std_ofi = math.sqrt(variance)
            ofi_zscore = (ofi_l1 - mean_ofi) / (std_ofi + 1e-6)
        else:
            ofi_zscore = 0.0

        # 5. Kyle's Lambda (Price Impact Coefficient)
        # Empirical regression: dMid = lambda * OFI
        kyle_lambda = 0.0001
        predicted_impact_bps = 0.0
        if n >= 10 and len(self.mid_price_history) == n:
            price_deltas = [
                self.mid_price_history[i] - self.mid_price_history[i - 1]
                for i in range(1, n)
            ]
            ofis = list(self.ofi_history)[1:]
            cov_sum = sum(p * o for p, o in zip(price_deltas, ofis))
            var_sum = sum(o * o for o in ofis)
            if var_sum > 1e-8:
                kyle_lambda = max(0.0, cov_sum / var_sum)
                # Predict next delta price
                pred_delta = kyle_lambda * ofi_l1
                if mid_price > 0:
                    predicted_impact_bps = (pred_delta / mid_price) * 10000.0

        # 6. Regime Classification
        if ofi_zscore >= 1.75 or micro_bias_bps > 2.0:
            regime = "STRONG_BUY_PRESSURE"
        elif ofi_zscore <= -1.75 or micro_bias_bps < -2.0:
            regime = "STRONG_SELL_PRESSURE"
        else:
            regime = "BALANCED"

        # 7. VPIN State determination
        if self.last_vpin >= 0.65:
            vpin_state = "TOXIC"
        elif self.last_vpin >= 0.45:
            vpin_state = "MODERATE"
        else:
            vpin_state = "LOW"

        metrics = MicrostructureMetrics(
            symbol=self.symbol,
            timestamp_ms=ts_ms,
            best_bid=curr_bid_p,
            best_ask=curr_ask_p,
            mid_price=mid_price,
            micro_price=micro_price,
            micro_price_bias_bps=micro_bias_bps,
            ofi_l1=ofi_l1,
            deep_ofi=deep_ofi,
            cumulative_ofi=self.cumulative_ofi,
            ofi_zscore=ofi_zscore,
            kyle_lambda=kyle_lambda,
            predicted_impact_bps=predicted_impact_bps,
            vpin=self.last_vpin,
            vpin_state=vpin_state,
            regime=regime,
        )

        self.latest_metrics = metrics
        self.timeseries_history.append({
            "t": ts_ms,
            "ofi": round(ofi_l1, 3),
            "cum_ofi": round(self.cumulative_ofi, 3),
            "micro_bias": round(micro_bias_bps, 2),
            "mid": round(mid_price, 2),
            "vpin": round(self.last_vpin, 3),
        })

        return metrics

    def update_trade(self, price: float, qty: float, is_buyer_maker: bool, ts_ms: int):
        """
        Feeds incoming trades to update the VPIN (Volume-Synchronized Probability of Toxicity) engine.
        is_buyer_maker=True means trade was initiated by a seller (market sell hit bid).
        is_buyer_maker=False means trade was initiated by a buyer (market buy hit ask).
        """
        # Buyer initiated if market buy (is_buyer_maker is False in Binance notation)
        if not is_buyer_maker:
            self.vpin_current_buy += qty
        else:
            self.vpin_current_sell += qty

        total_bucket_vol = self.vpin_current_buy + self.vpin_current_sell
        if total_bucket_vol >= self.vpin_bucket_size:
            abs_imbalance = abs(self.vpin_current_buy - self.vpin_current_sell)
            self.vpin_buckets.append(abs_imbalance)
            self.vpin_current_buy = 0.0
            self.vpin_current_sell = 0.0

            if len(self.vpin_buckets) >= 5:
                # VPIN = sum(|V_b - V_s|) / (N * V)
                vpin_val = sum(self.vpin_buckets) / (len(self.vpin_buckets) * self.vpin_bucket_size)
                # Bound between 0.05 and 0.95
                self.last_vpin = max(0.05, min(0.95, vpin_val))

    def _fallback_metrics(self, ts_ms: int) -> MicrostructureMetrics:
        return MicrostructureMetrics(
            symbol=self.symbol,
            timestamp_ms=ts_ms,
            best_bid=0.0,
            best_ask=0.0,
            mid_price=0.0,
            micro_price=0.0,
            micro_price_bias_bps=0.0,
            ofi_l1=0.0,
            deep_ofi=0.0,
            cumulative_ofi=0.0,
            ofi_zscore=0.0,
            kyle_lambda=0.0001,
            predicted_impact_bps=0.0,
            vpin=0.25,
            vpin_state="LOW",
            regime="BALANCED",
        )

    def get_timeseries(self) -> List[dict]:
        return list(self.timeseries_history)


# Global Hub for MicrostructureTrackers
class MicrostructureHub:
    def __init__(self):
        self.trackers: Dict[str, MicrostructureTracker] = {}

    def get_or_create(self, symbol: str) -> MicrostructureTracker:
        clean = symbol.upper().replace("/", "")
        if clean not in self.trackers:
            self.trackers[clean] = MicrostructureTracker(clean)
        return self.trackers[clean]


microstructure_hub = MicrostructureHub()
