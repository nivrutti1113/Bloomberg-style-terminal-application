import pytest
import numpy as np
import pandas as pd
from analytics import calculate_har_model, calculate_vol_target_backtest

def generate_mock_daily_series(n_days=100):
    np.random.seed(42)
    dates = pd.date_range("2024-01-01", periods=n_days, freq="D").strftime("%Y-%m-%d")
    returns = np.random.normal(0.0005, 0.02, size=n_days)
    prices = 60000.0 * np.exp(np.cumsum(returns))

    df = pd.DataFrame({
        "time_sec": np.arange(1700000000, 1700000000 + n_days * 86400, 86400),
        "open": prices,
        "high": prices * 1.01,
        "low": prices * 0.99,
        "close": prices,
        "volume": np.random.uniform(500, 2000, size=n_days),
    }, index=dates)
    return df


def test_har_model_calculation():
    df = generate_mock_daily_series(120)
    res = calculate_har_model(df, "BTCUSDT")

    assert res["status"] == "SUCCESS"
    assert res["model"] == "HAR-RV"
    assert "forecast_1d" in res
    assert "forecast_5d" in res
    assert "forecast_22d" in res
    assert res["forecast_1d"] > 0
    assert "coefficients" in res
    assert "beta_daily" in res["coefficients"]
    assert "chart_series" in res
    assert len(res["chart_series"]) > 0


def test_vol_target_backtest_metrics():
    df = generate_mock_daily_series(120)
    res = calculate_vol_target_backtest(df, "BTCUSDT", target_vol_annual=0.15)

    assert res["status"] == "SUCCESS"
    assert res["target_volatility"] == 15.0
    assert "sharpe_ratio" in res
    assert "max_drawdown_pct" in res
    assert "annual_turnover" in res
    assert "equity_curve" in res
    assert len(res["equity_curve"]) > 0

    first_point = res["equity_curve"][0]
    assert "strategy" in first_point
    assert "benchmark" in first_point


def test_insufficient_data_safety():
    df = generate_mock_daily_series(10)
    har_res = calculate_har_model(df, "BTCUSDT")
    assert har_res["status"] == "INSUFFICIENT_DATA"

    bt_res = calculate_vol_target_backtest(df, "BTCUSDT")
    assert bt_res["status"] == "INSUFFICIENT_DATA"
