# Finevers // High-Frequency Market Terminal & Microstructure Engine

An institutional-grade, keyboard-driven market terminal modeled after the Bloomberg Terminal and Refinitiv Eikon architectures. Designed for quantitative researchers, algorithmic traders, and prop desks requiring sub-millisecond execution telemetry, live Level-2 depth ladder analysis, order flow imbalance (OFI) alpha, and econometric volatility forecasting.

Dual-venue execution pipeline: Streams live Binance Level-2 depth & trade feeds alongside zero-auth real-time Indian equities (NSE) and equity tear-sheet profiles (`DES`).

---

## 1. System Architecture & Quantitative Philosophy

```
                                  [ EXCHANGE FEEDS ]
                     ┌────────────────────┴────────────────────┐
                     ▼                                         ▼
            Binance Public WSS                         Yahoo Finance API
        (wss://stream.binance.com)                 (v8 Chart & Quotes Engine)
        Crypto L2 Depth (20 Levels)                 NSE Equities & Indices
         Raw Tick Aggregations                     (RELIANCE, TCS, INFY, NIFTY)
                     │                                         │
                     └────────────────────┬────────────────────┘
                                          ▼
                               [ FASTAPI INGESTION CORE ]
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
   [ OrderBookHub (L2) ]        [ MicrostructureHub ]         [ CandleAggregator ]
   - 20-Level Depth Ladder      - Cont-Stoikov OFI (L1/Deep)  - 1m/5m/15m/1h/1d Bars
   - Queue Imbalance %          - Stoikov Micro-Price         - Real-time Synthesis
   - Spread in BPS              - Kyle's Lambda (Price Impact)- DB Persistence
                                - Easley et al. VPIN Toxicity
            │                             │                             │
            └─────────────────────────────┼─────────────────────────────┘
                                          ▼
                               [ CONFLATION RING BUFFER ]
                               (100ms Window / Drop-Oldest)
                                          │
                     ┌────────────────────┴────────────────────┐
                     ▼                                         ▼
             [ Redis Pub/Sub ]                       [ Async WebSocket Fanout ]
            (Horizontal Workers)                     (Browser Clients: 60 FPS)
                     │                                         │
                     └────────────────────┬────────────────────┘
                                          ▼
                         [ NEXT.JS 16 REACT / CANVAS CLIENT ]
                     FlexLayout Multi-Window Dockable Workspace
```

Most retail charting platforms rely on backwards-looking, lagging price indicators (RSI, MACD, Simple Moving Averages) computed over aggregated time bars ($t$). In contrast, institutional proprietary trading desks extract actionable statistical edge from **order book queue dynamics, trade execution aggression, and market microstructure invariants** that occur at the sub-second level.

Finevers implements real-time econometric models on the raw streaming order book to forecast near-term price discovery before candles print on an ordinary chart.

---

## 2. Microstructure & Econometric Models Implemented

### A. Stoikov (2018) Volume-Weighted Micro-Price
Raw mid-price $P_{\text{mid}} = \frac{P_a + P_b}{2}$ ignores limit order queue depths. The Stoikov micro-price adjusts for instantaneous liquidity asymmetry:

$$P_{\text{micro}} = \frac{Q_b P_a + Q_a P_b}{Q_b + Q_a}$$

The terminal exposes the fair value drift in basis points ($\Delta_{\text{bps}}$):

$$\Delta_{\text{bps}} = \frac{P_{\text{micro}} - P_{\text{mid}}}{P_{\text{mid}}} \times 10{,}000$$

A positive bias ($\Delta_{\text{bps}} > 0$) signifies heavy bid support predicting upward quote adjustment; a negative bias predicts downward slippage.

### B. Cont, Kukanov & Stoikov (2014) Order Flow Imbalance (OFI)
Tracks dynamic shifts in queue volumes across successive order book updates ($n-1 \to n$):

$$\text{OFI}_{L1} = I_{\{P_{b,n} \ge P_{b,n-1}\}} Q_{b,n} - I_{\{P_{b,n} \le P_{b,n-1}\}} Q_{b,n-1} - \left( I_{\{P_{a,n} \le P_{a,n-1}\}} Q_{a,n} - I_{\{P_{a,n} \ge P_{a,n-1}\}} Q_{a,n-1} \right)$$

* **Deep Multi-Level OFI**: Evaluates cumulative imbalance across the top 5 price rungs with geometric decay weights ($w_i = \frac{1}{i}$):

$$\text{Deep OFI} = \sum_{i=1}^{5} \frac{1}{i} \cdot \text{OFI}_i$$

* **OFI Z-Score**: Normalized against rolling standard deviation ($\sigma_{\text{OFI}}$). Identifies institutional absorption vs aggressive distribution (`STRONG_BUY_PRESSURE` vs `STRONG_SELL_PRESSURE`).

### C. Kyle's Lambda ($\lambda$) & Instantaneous Price Impact
Measures price concession demanded per unit of signed order flow:

$$\Delta P_t = \lambda \cdot \text{OFI}_t + \varepsilon_t \quad \implies \quad \lambda = \frac{\text{Cov}(\Delta P, \text{OFI})}{\text{Var}(\text{OFI})}$$

Higher $\lambda$ signifies thin liquidity where modest order flow results in severe price displacement.

### D. Easley, Lopez de Prado & O'Hara (2012) VPIN (Toxicity)
Measures the Volume-Synchronized Probability of Toxicity. Trades are assigned to equal volume buckets of size $V$:

$$\text{VPIN} = \frac{\sum_{\tau=1}^{N} |V_\tau^B - V_\tau^S|}{N \times V}$$

High VPIN ($> 0.65$) indicates informed institutional participation where passive market makers are prone to adverse selection.

### E. Corsi (2009) HAR-RV Realized Volatility Model
Heterogeneous Autoregressive model of Realized Volatility:

$$\text{RV}_{t+1d}^{(d)} = \beta_0 + \beta_d \text{RV}_t^{(d)} + \beta_w \text{RV}_t^{(w)} + \beta_m \text{RV}_t^{(m)} + \varepsilon_{t+1}$$

Calculates OLS parameters over rolling daily, weekly (5-day), and monthly (22-day) historical realized variance components with out-of-sample forecasting.

### F. Continuous Volatility-Targeted Position Sizing
Zero-lookahead risk parity backtesting engine adjusting daily weights to achieve target portfolio risk $\sigma_{\text{target}}$:

$$w_t = \min\left( \text{Max Leverage}, \; \frac{\sigma_{\text{target}}}{\hat{\sigma}_{t-1}} \right)$$

Evaluated against a benchmark buy-and-hold strategy including transaction friction ($5.0\,\text{bps}$).

---

## 3. Terminal Command Specification (Bloomberg CLI)

The terminal is operated via an omnibox command prompt triggered globally via `/` or `Ctrl+K`. Commands follow standard Bloomberg mnemonic conventions:

| Mnemonic | Function Name | Description | Syntax Examples |
| :--- | :--- | :--- | :--- |
| **`DES`** | Security Description | Equity tear-sheet: company profile, financials, 52W range, business overview, venue | `RELIANCE DES`, `DES TCS`, `BTC DES` |
| **`GP`** | Price Chart | Candlestick charting with TradingView engine, multi-timeframes & overlays | `BTC GP`, `RELIANCE GP`, `TCS GP` |
| **`OB`** | Order Book Ladder | Real-time 20-level depth ladder, spread in bps & imbalance meter | `BTC OB`, `SOL OB` |
| **`OFI`** | Microstructure Alpha | Stoikov micro-price, Cont OFI Z-score, Kyle's lambda & VPIN gauge | `BTC OFI`, `ETH OFI` |
| **`TS`** | Time & Sales | Live virtualized trade tape with block-trade filters ($>\$1\text{K}, >\$10\text{K}, >\$50\text{K}$) | `BTC TS`, `SOL TS` |
| **`VOL`** | HAR Volatility | Econometric realized volatility forecast across daily, weekly, monthly horizons | `BTC VOL`, `RELIANCE VOL` |
| **`BT`** | Strategy Backtest | Volatility-targeting dynamic leverage equity curve vs benchmark | `BTC BT`, `TCS BT` |
| **`WL`** | Streaming Watchlist | Multi-asset streaming watchlist with HTML5 Canvas micro-sparklines | `WL` |
| **`ADD`** | Add Symbol | Subscribe and add ticker to active streaming watchlist | `ADD RELIANCE`, `ADD TCS`, `ADD SOL` |
| **`DEL`** | Remove Symbol | Unsubscribe ticker from watchlist | `DEL SOLUSDT` |
| **`METRICS`**| System Telemetry | Ingestion throughput (ticks/sec), p50/p99 latency, and feed health | `METRICS` |
| **`HELP`** | System Catalog | Display complete shortcut table and function index | `HELP`, `?` |

### Global Keyboard Shortcuts
* **`F1`**: Focus / Open Streaming Watchlist (`WL`)
* **`F2`**: Focus / Open Candlestick Chart (`GP`)
* **`F3`**: Focus / Open 20-Level Depth Ladder (`OB`)
* **`F4`**: Focus / Open Time & Sales Tape (`TS`)
* **`F5`**: Open HAR Volatility Forecast (`VOL`)
* **`F6`**: Open Vol-Target Strategy Backtest (`BT`)
* **`F7`**: Telemetry & Pipeline Latency (`METRICS`)
* **`F8`**: Command Catalog & Help (`HELP`)
* **`F9`**: Market Microstructure & OFI Engine (`OFI`)
* **`F10`**: Bloomberg Security Description Tear-Sheet (`DES`)
* **`Escape`**: Close active focused tab

---

## 4. Multi-Venue Market Data Feed Engine

Finevers decouples data ingestion across venues behind a unified `Tick` protocol:

```python
@dataclass(slots=True)
class Tick:
    venue: str        # "BINANCE" or "NSE"
    symbol: str       # Normalized ticker: "BTCUSDT", "RELIANCE", "TCS"
    price: float      # Execution or best mid price
    qty: float        # Executed size or top level volume
    exch_ts_ms: int   # Exchange engine timestamp
    recv_ts_ms: int   # Local node socket receipt timestamp
```

### Supported Asset Classes
1. **Cryptocurrency Derivatives & Spot (Binance):**
   * Real-time WebSocket depth stream (`@depth20@100ms`) and trade aggregates.
   * Automatic geo-blocking fallback (`api.binance.com` $\to$ `api.binance.us`).
2. **Indian Equities & Indices (NSE India):**
   * **Zero-Auth Open Feed**: Streams live intraday 1m/5m/15m/1d candles and real-time tick telemetry via the Yahoo Finance Public Engine (`RELIANCE.NS`, `TCS.NS`, `INFY.NS`, `HDFCBANK.NS`, `ICICIBANK.NS`, `^NSEI` [NIFTY 50], `^NSEBANK` [BANK NIFTY]).
   * No API keys, credentials, or KYC required.
   * **Broker WebSocket Mode**: Ready for Indian discount broker integration (Dhan HQ API / Fyers Data API / Zerodha Kite Connect) via environment configuration.
3. **Security Description Knowledge Graph (`DES`):**
   * Aggregates real-time price quotes, 52-week high/low range, day range, volume, official logos, and corporate filings into an equity tear-sheet.

---

## 5. Telemetry & Benchmark Specifications

Tested on production hardware (Ubuntu Linux / Python 3.11 / Uvicorn Asyncio Engine / Conflation Ring Buffer):

| Concurrent Sockets | Disconnect Rate | Aggregate Ingestion | Pipeline Latency p50 | Pipeline Latency p99 | Backpressure Strategy |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **10 Clients** | **0.0%** | 61.2 ticks/sec | 0.20 ms | 0.78 ms | Direct Push (No Backpressure) |
| **100 Clients** | **0.0%** | 2,966.8 ticks/sec | 0.12 ms | 0.77 ms | 100ms Conflation Window |
| **250 Clients** | **0.0%** | 1,425.9 ticks/sec | 0.13 ms | 2.31 ms | Drop-Oldest Ring Buffer |

* **Zero Memory Leak Guarantee**: Ring buffers utilize bounded `deque(maxlen=N)` across all rolling volatility, OFI, and trade histories.
* **Staleness Watchdog**: Front-end visual opacity dims automatically if no tick packet arrives within 5,000 milliseconds.

---

## 6. Quick Start & Local Setup

### Prerequisites
* **Python**: 3.11+
* **Node.js**: 20+ LTS (with npm)
* **Docker & Docker Compose** (optional for production containerization)

### Local Development Setup

```bash
# 1. Clone repository
git clone https://github.com/nivrutti1113/Bloomberg-style-terminal-application.git
cd Bloomberg-style-terminal-application

# 2. Start Backend (Terminal 1)
cd backend
python -m pip install -r requirements.txt
python app.py
# Backend runs at http://localhost:8000 (Healthcheck: http://localhost:8000/health)

# 3. Start Frontend (Terminal 2)
cd ../frontend
npm install
npm run dev
# Open http://localhost:3000 in your browser
```

---

## 7. Production Deployment (Docker Compose)

The production stack provisions four isolated containers with healthcheck dependencies:
1. `terminal_timescaledb`: TimescaleDB / PostgreSQL hypertable storage.
2. `terminal_redis`: Redis 7 Pub/Sub bus for horizontal WebSocket distribution.
3. `terminal_backend`: Python 3.11 FastAPI asynchronous streaming core.
4. `terminal_frontend`: Next.js 16 production server with Turbopack standalone output.

```bash
# Build and launch production stack in detached mode
docker compose build
docker compose up -d

# Verify healthy containers
docker compose ps

# Inspect real-time streaming logs
docker compose logs -f backend
```

---

## 8. License

Distributed under the MIT License. See [LICENSE](file:///c:/Users/welcome/OneDrive/Desktop/Finevers/LICENSE) for full details.
