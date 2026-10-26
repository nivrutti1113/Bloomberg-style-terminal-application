# TERMINAL // Real-Time Bloomberg-Style Market Terminal

A keyboard-driven, multi-panel terminal with live streaming crypto prices, dockable multi-panel layout, command line interface, order book, and quant analytics.

---

## Architecture Overview

- **Frontend**: Next.js 16 (App Router), TypeScript Strict, Tailwind CSS 4, Zustand, FlexLayout, `@tanstack/react-virtual`, `lightweight-charts` (TradingView).
- **Backend**: FastAPI, `adapters.py` with normalized `Tick`, `order_book.py` with top 20 bid/ask depth engine, `database.py` with TimescaleDB hypertable DDL & continuous aggregates (with aiosqlite zero-dependency fallback), `candle_aggregator.py` for real-time 1m/5m/15m/1h/1d synthesis, `analytics.py` with HAR-RV realized volatility forecasting and volatility-targeting backtest engine, `/prices`, `/metrics`, `/candles`, `/analytics/har/{symbol}`, `/analytics/voltarget/{symbol}`, `/ws`, `/ws/book/{symbol}`.
- **Zero Fake Data**: Real ticks and depth streamed directly from Binance public WebSockets. If feeds stall, panels dim to explicit `STALE` state after 5 seconds.

---

## Quick Start Instructions

### 1. Start the Backend (Terminal 1)
```powershell
cd backend
python -m pip install -r requirements.txt
python app.py
```
Backend runs on `http://localhost:8000`.

### 2. Start the Frontend (Terminal 2)
```powershell
cd frontend
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Features Implemented

### Phase 1: Core Shell & Live Streaming
- Bloomberg dark aesthetic (`#000000` pure black, `#0A0A0A` panels, `#FFB000` amber text).
- Command bar with global shortcut `/` or `Ctrl+K`, history navigation, and autocomplete.
- FlexLayout dockable, draggable, resizable layout saved in `localStorage`.
- High-throughput WebSocket connection manager with `requestAnimationFrame` micro-batching and 5-second staleness watchdog.
- Watchlist (WL) with live tick flashes and HTML5 Canvas sparklines.

### Phase 2: Charts, Candles & Indicators
- TradingView `lightweight-charts` integration with volume histogram overlay.
- Real-time last-candle synthesis on every incoming tick.
- Timeframe switcher (`1m`, `5m`, `15m`, `1h`, `1d`).
- Technical indicators: `SMA (20)`, `EMA (50)`, `BOLL (20,2)`, `RSI (14)`.
- Backend TimescaleDB hypertable DDL, continuous aggregates, and real-time candle synthesis.

### Phase 3: Order Book & Time and Sales
- 20-level bid/ask depth ladder with dynamic horizontal volume bars.
- Live Spread (USD & bps) and Mid-Price calculation.
- Graphical real-time Order Book Imbalance meter (% bid vs % ask pressure).
- Sequence gap reconciliation via REST snapshot resync.
- Virtualized Time & Sales trade tape with size filters (`ALL`, `>$1K`, `>$10K`, `>$50K`) and whale transaction alert styling.

### Phase 4: Quantitative Research Analytics
- **HAR Realized Volatility Forecast Model (`VOL`)**:
  - Implements Heterogeneous Autoregressive model of Realized Volatility (HAR-RV).
  - Forecasts 1-day ($h=1$), 5-day ($h=5$), and 22-day ($h=22$) annualized volatility.
  - OLS coefficients ($\beta_0, \beta_d, \beta_w, \beta_m$) and $R^2$ fit scores.
  - Interactive timeseries chart comparing historical Realized Volatility vs HAR Forecast.
- **Volatility Targeting Strategy Backtest (`BT`)**:
  - Dynamic leverage position sizing: $w_t = \text{clip}(\sigma_{\text{target}} / \sigma_{t-1}, 0, \text{max\_leverage})$ with zero lookahead leakage.
  - Calculates Sharpe ratio (Strategy vs Buy-and-Hold benchmark).
  - Maximum Drawdown (MDD) calculation and comparison.
  - Annual return and turnover metrics accounting for transaction friction (5.0 bps).
  - Interactive dual equity curve chart (Vol-Target Strategy vs Buy-and-Hold benchmark normalized to 100).
