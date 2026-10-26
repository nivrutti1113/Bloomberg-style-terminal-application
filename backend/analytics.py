"""
analytics.py - Quantitative Research Analytics Engine.
Implements HAR-RV (Heterogeneous Autoregressive Realized Volatility) forecasting
and Volatility-Targeting backtesting matching research code standards.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

logger = logging.getLogger("terminal_analytics")


async def fetch_daily_data(symbol: str, limit: int = 180) -> pd.DataFrame:
    """Fetch real historical daily OHLCV series for quant modeling."""
    clean_symbol = symbol.upper().replace("/", "")
    url = f"https://api.binance.com/api/v3/klines?symbol={clean_symbol}&interval=1d&limit={limit}"

    records = []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(url)
            if res.status_code == 200:
                raw = res.json()
                for c in raw:
                    records.append({
                        "time_sec": int(c[0] // 1000),
                        "date": pd.to_datetime(c[0], unit="ms").strftime("%Y-%m-%d"),
                        "open": float(c[1]),
                        "high": float(c[2]),
                        "low": float(c[3]),
                        "close": float(c[4]),
                        "volume": float(c[5]),
                    })
    except Exception as e:
        logger.error(f"Error fetching daily candles for {clean_symbol}: {e}")

    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    df.set_index("date", inplace=True)
    return df


def calculate_har_model(df: pd.DataFrame, symbol: str) -> Dict[str, Any]:
    """
    Fits HAR-RV (Heterogeneous Autoregressive Realized Volatility) Model:
    RV_{t+h} = beta_0 + beta_d * RV_d + beta_w * RV_w + beta_m * RV_m
    """
    if len(df) < 35:
        return {
            "symbol": symbol,
            "status": "INSUFFICIENT_DATA",
            "message": f"Requires at least 35 daily periods, got {len(df)}.",
        }

    # Daily close-to-close log returns
    df = df.copy()
    df["log_ret"] = np.log(df["close"] / df["close"].shift(1))
    # Annualized realized volatility (% per year, 365 trading days for crypto)
    annualization_factor = np.sqrt(365)
    df["rv"] = np.abs(df["log_ret"]) * annualization_factor * 100.0

    # HAR components
    df["rv_d"] = df["rv"]  # Daily
    df["rv_w"] = df["rv"].rolling(5).mean()   # Weekly (5d)
    df["rv_m"] = df["rv"].rolling(22).mean()  # Monthly (22d)

    # Forecast target: 1-day ahead
    df["target_h1"] = df["rv"].shift(-1)
    df["target_h5"] = df["rv"].rolling(5).mean().shift(-5)
    df["target_h22"] = df["rv"].rolling(22).mean().shift(-22)

    clean_df = df.dropna(subset=["rv_d", "rv_w", "rv_m"]).copy()

    X = clean_df[["rv_d", "rv_w", "rv_m"]].values
    y_h1 = clean_df["target_h1"].dropna().values
    X_train_h1 = X[: len(y_h1)]

    # Fit 1-day ahead model
    model_h1 = LinearRegression()
    model_h1.fit(X_train_h1, y_h1)

    # Predict in-sample / history
    clean_df["forecast_rv_h1"] = model_h1.predict(X)

    # Latest forecast point
    latest_row = clean_df.iloc[-1]
    latest_features = latest_row[["rv_d", "rv_w", "rv_m"]].values.reshape(1, -1)
    forecast_1d = float(model_h1.predict(latest_features)[0])

    # Fit 5-day ahead
    clean_h5 = clean_df.dropna(subset=["target_h5"])
    model_h5 = LinearRegression()
    model_h5.fit(clean_h5[["rv_d", "rv_w", "rv_m"]].values, clean_h5["target_h5"].values)
    forecast_5d = float(model_h5.predict(latest_features)[0])

    # Fit 22-day ahead
    clean_h22 = clean_df.dropna(subset=["target_h22"])
    model_h22 = LinearRegression()
    model_h22.fit(clean_h22[["rv_d", "rv_w", "rv_m"]].values, clean_h22["target_h22"].values)
    forecast_22d = float(model_h22.predict(latest_features)[0])

    r2_score = float(model_h1.score(X_train_h1, y_h1))

    # Time series of realized vs forecast for charting
    chart_series = []
    for date, row in clean_df.tail(60).iterrows():
        chart_series.append({
            "date": str(date),
            "realized": round(float(row["rv"]), 2),
            "forecast": round(float(row["forecast_rv_h1"]), 2),
            "close": round(float(row["close"]), 2),
        })

    return {
        "symbol": symbol.upper(),
        "status": "SUCCESS",
        "model": "HAR-RV",
        "current_realized_vol": round(float(latest_row["rv"]), 2),
        "forecast_1d": round(max(0.0, forecast_1d), 2),
        "forecast_5d": round(max(0.0, forecast_5d), 2),
        "forecast_22d": round(max(0.0, forecast_22d), 2),
        "coefficients": {
            "intercept": round(float(model_h1.intercept_), 3),
            "beta_daily": round(float(model_h1.coef_[0]), 3),
            "beta_weekly": round(float(model_h1.coef_[1]), 3),
            "beta_monthly": round(float(model_h1.coef_[2]), 3),
        },
        "r_squared": round(max(0.0, r2_score), 3),
        "sample_size": len(clean_df),
        "chart_series": chart_series,
    }


def calculate_vol_target_backtest(
    df: pd.DataFrame,
    symbol: str,
    target_vol_annual: float = 0.15,
    max_leverage: float = 2.0,
    cost_bps: float = 5.0,
) -> Dict[str, Any]:
    """
    Volatility targeting backtest matching user's vol-forecaster research engine:
    Position[t] = clip(target_vol_daily / forecast_vol[t-1], 0, max_leverage)
    Evaluates strategy equity curve vs Buy-and-Hold benchmark.
    """
    if len(df) < 30:
        return {
            "symbol": symbol,
            "status": "INSUFFICIENT_DATA",
            "message": f"Requires at least 30 daily periods, got {len(df)}.",
        }

    df = df.copy()
    prices = df["close"]
    asset_ret = prices.pct_change()

    # Daily target volatility (annualized / sqrt(365))
    daily_target = target_vol_annual / np.sqrt(365)

    # Realized rolling volatility proxy (20-day rolling stdev annualized)
    daily_vol = asset_ret.rolling(20).std()
    # Avoid zero division
    daily_vol = daily_vol.replace(0, np.nan).fillna(daily_target)

    # Position on day t uses vol known at t-1 (strictly zero lookahead leakage)
    weights = np.clip(daily_target / daily_vol.shift(1), 0.0, max_leverage)

    # Align dates
    valid = weights.dropna().index.intersection(asset_ret.dropna().index)
    w = weights.loc[valid]
    r = asset_ret.loc[valid]

    # Turnover & cost
    turnover = w.diff().abs().fillna(w.iloc[0] if len(w) > 0 else 0.0)
    cost = turnover * (cost_bps * 1e-4)

    # Net strategy returns
    net_ret = w * r - cost

    # Cumulative equity curve (starting at 100)
    strat_cum = (1.0 + net_ret).cumprod() * 100.0
    bench_cum = (1.0 + r).cumprod() * 100.0

    # Max Drawdowns
    strat_peak = strat_cum.cummax()
    strat_dd = (strat_peak - strat_cum) / strat_peak
    strat_mdd = float(strat_dd.max()) if len(strat_dd) > 0 else 0.0

    bench_peak = bench_cum.cummax()
    bench_dd = (bench_peak - bench_cum) / bench_peak
    bench_mdd = float(bench_dd.max()) if len(bench_dd) > 0 else 0.0

    # Annualized metrics
    ann_factor = 365
    strat_vol = float(net_ret.std() * np.sqrt(ann_factor)) if len(net_ret) > 1 else 0.0
    strat_ann_ret = float(net_ret.mean() * ann_factor) if len(net_ret) > 0 else 0.0
    strat_sharpe = float(strat_ann_ret / strat_vol) if strat_vol > 1e-6 else 0.0

    bench_vol = float(r.std() * np.sqrt(ann_factor)) if len(r) > 1 else 0.0
    bench_ann_ret = float(r.mean() * ann_factor) if len(r) > 0 else 0.0
    bench_sharpe = float(bench_ann_ret / bench_vol) if bench_vol > 1e-6 else 0.0

    annual_turnover = float(turnover.mean() * ann_factor) if len(turnover) > 0 else 0.0

    # Build equity curves series for visual charting
    equity_series = []
    for date in valid:
        equity_series.append({
            "date": str(date),
            "strategy": round(float(strat_cum.loc[date]), 2),
            "benchmark": round(float(bench_cum.loc[date]), 2),
            "leverage": round(float(w.loc[date]), 2),
        })

    return {
        "symbol": symbol.upper(),
        "status": "SUCCESS",
        "target_volatility": round(target_vol_annual * 100, 1),
        "realized_volatility": round(strat_vol * 100, 1),
        "sharpe_ratio": round(strat_sharpe, 2),
        "max_drawdown_pct": round(strat_mdd * 100, 2),
        "annual_return_pct": round(strat_ann_ret * 100, 2),
        "annual_turnover": round(annual_turnover, 1),
        "benchmark_sharpe": round(bench_sharpe, 2),
        "benchmark_max_drawdown_pct": round(bench_mdd * 100, 2),
        "benchmark_annual_return_pct": round(bench_ann_ret * 100, 2),
        "equity_curve": equity_series[-90:],  # Recent 90 daily points
        "parameters": {
            "target_vol": target_vol_annual,
            "max_leverage": max_leverage,
            "cost_bps": cost_bps,
        },
    }
