"""
database.py - TimescaleDB Storage & High-Throughput Batch Ingestion Layer.
Supports TimescaleDB hypertables & continuous aggregates with a seamless
aiosqlite fallback for local zero-dependency testing.
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
import time
from typing import Any, Dict, List, Optional

from adapters import Tick

logger = logging.getLogger("terminal_db")

TIMESCALE_URL = os.getenv("TIMESCALE_URL", os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/market_data"))
SQLITE_DB_PATH = os.getenv("SQLITE_DB_PATH", "ticks.db")
RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "7"))

# DDL for TimescaleDB Hypertables, Retention Policies, and Continuous Aggregates
TIMESCALE_DDL = f"""
CREATE TABLE IF NOT EXISTS ticks (
    time TIMESTAMPTZ NOT NULL,
    venue VARCHAR(16) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    qty DOUBLE PRECISION NOT NULL,
    exch_ts_ms BIGINT NOT NULL,
    recv_ts_ms BIGINT NOT NULL
);

SELECT create_hypertable('ticks', 'time', if_not_exists => TRUE, migrate_data => TRUE);

CREATE INDEX IF NOT EXISTS idx_ticks_symbol_time ON ticks (symbol, time DESC);

-- Automated Data Retention Policy ({RETENTION_DAYS} days for raw tick data)
DO $$
BEGIN
    PERFORM add_retention_policy('ticks', INTERVAL '{RETENTION_DAYS} days', if_not_exists => TRUE);
EXCEPTION WHEN others THEN
    NULL;
END $$;

-- 1-Minute Continuous Aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    symbol,
    FIRST(price, time) AS open,
    MAX(price) AS high,
    MIN(price) AS low,
    LAST(price, time) AS close,
    SUM(qty) AS volume
FROM ticks
GROUP BY bucket, symbol
WITH NO DATA;

DO $$
BEGIN
    PERFORM add_continuous_aggregate_policy('candles_1m',
        start_offset => INTERVAL '1 hour',
        end_offset => INTERVAL '1 minute',
        schedule_interval => INTERVAL '1 minute',
        if_not_exists => TRUE);
EXCEPTION WHEN others THEN
    NULL;
END $$;

-- 5-Minute Continuous Aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    symbol,
    FIRST(price, time) AS open,
    MAX(price) AS high,
    MIN(price) AS low,
    LAST(price, time) AS close,
    SUM(qty) AS volume
FROM ticks
GROUP BY bucket, symbol
WITH NO DATA;

DO $$
BEGIN
    PERFORM add_continuous_aggregate_policy('candles_5m',
        start_offset => INTERVAL '6 hours',
        end_offset => INTERVAL '5 minutes',
        schedule_interval => INTERVAL '5 minutes',
        if_not_exists => TRUE);
EXCEPTION WHEN others THEN
    NULL;
END $$;

-- 1-Hour Continuous Aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    symbol,
    FIRST(price, time) AS open,
    MAX(price) AS high,
    MIN(price) AS low,
    LAST(price, time) AS close,
    SUM(qty) AS volume
FROM ticks
GROUP BY bucket, symbol
WITH NO DATA;

DO $$
BEGIN
    PERFORM add_continuous_aggregate_policy('candles_1h',
        start_offset => INTERVAL '1 day',
        end_offset => INTERVAL '1 hour',
        schedule_interval => INTERVAL '1 hour',
        if_not_exists => TRUE);
EXCEPTION WHEN others THEN
    NULL;
END $$;

-- 1-Day Continuous Aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1d
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    symbol,
    FIRST(price, time) AS open,
    MAX(price) AS high,
    MIN(price) AS low,
    LAST(price, time) AS close,
    SUM(qty) AS volume
FROM ticks
GROUP BY bucket, symbol
WITH NO DATA;

DO $$
BEGIN
    PERFORM add_continuous_aggregate_policy('candles_1d',
        start_offset => INTERVAL '7 days',
        end_offset => INTERVAL '1 day',
        schedule_interval => INTERVAL '1 day',
        if_not_exists => TRUE);
EXCEPTION WHEN others THEN
    NULL;
END $$;
"""

SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS ticks (
    time_iso TEXT NOT NULL,
    venue TEXT NOT NULL,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    qty REAL NOT NULL,
    exch_ts_ms INTEGER NOT NULL,
    recv_ts_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticks_symbol_time ON ticks (symbol, exch_ts_ms DESC);

CREATE TABLE IF NOT EXISTS closed_candles (
    timeframe TEXT NOT NULL,
    symbol TEXT NOT NULL,
    time_sec INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (symbol, timeframe, time_sec)
);
"""


class DatabaseManager:
    def __init__(self):
        self.is_timescale = False
        self.pool = None
        self._sqlite_conn = None
        self._batch_queue: asyncio.Queue[Tick] = asyncio.Queue(maxsize=50000)
        self._writer_task: Optional[asyncio.Task] = None
        self._running = False
        self.total_inserted = 0

    async def connect(self):
        self._running = True
        # Try connecting to TimescaleDB first
        try:
            import asyncpg
            self.pool = await asyncpg.create_pool(
                dsn=TIMESCALE_URL,
                min_size=2,
                max_size=10,
                timeout=3.0,
                command_timeout=5.0,
            )
            async with self.pool.acquire() as conn:
                try:
                    await conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")
                    await conn.execute(TIMESCALE_DDL)
                    self.is_timescale = True
                    logger.info("Connected to TimescaleDB. Hypertables and indexes initialized.")
                except Exception as ex:
                    logger.warning(f"TimescaleDB extension setup: {ex}")
                    self.is_timescale = True
        except Exception as e:
            logger.info(f"TimescaleDB not available ({e}). Falling back to high-performance local SQLite engine.")
            self.is_timescale = False
            self.pool = None

        if not self.is_timescale:
            import aiosqlite
            self._sqlite_conn = await aiosqlite.connect(SQLITE_DB_PATH)
            await self._sqlite_conn.executescript(SQLITE_DDL)
            await self._sqlite_conn.commit()
            logger.info(f"Initialized local aiosqlite tick database at {SQLITE_DB_PATH}.")

        # Start background batch flush worker
        self._writer_task = asyncio.create_task(self._batch_writer_loop())

    async def enqueue_tick(self, tick: Tick):
        try:
            self._batch_queue.put_nowait(tick)
        except asyncio.QueueFull:
            pass

    async def _batch_writer_loop(self):
        """Asynchronously batch inserts ticks every 250ms or when batch reaches 200 items."""
        batch: List[Tick] = []
        last_flush = time.time()

        while self._running:
            try:
                # Wait for next tick with short timeout to enforce periodic flushing
                try:
                    tick = await asyncio.wait_for(self._batch_queue.get(), timeout=0.25)
                    batch.append(tick)
                except asyncio.TimeoutError:
                    pass

                now = time.time()
                if len(batch) >= 200 or (batch and (now - last_flush) >= 0.5):
                    await self._flush_batch(batch)
                    self.total_inserted += len(batch)
                    batch.clear()
                    last_flush = now

            except asyncio.CancelledError:
                if batch:
                    await self._flush_batch(batch)
                break
            except Exception as e:
                logger.error(f"Error in tick batch writer: {e}")
                await asyncio.sleep(0.5)

    async def _flush_batch(self, batch: List[Tick]):
        if not batch:
            return

        if self.is_timescale and self.pool:
            try:
                records = [
                    (
                        datetime.datetime.fromtimestamp(t.exch_ts_ms / 1000.0, tz=datetime.timezone.utc),
                        t.venue,
                        t.symbol,
                        t.price,
                        t.qty,
                        t.exch_ts_ms,
                        t.recv_ts_ms,
                    )
                    for t in batch
                ]
                async with self.pool.acquire() as conn:
                    await conn.copy_records_to_table(
                        "ticks",
                        records=records,
                        columns=["time", "venue", "symbol", "price", "qty", "exch_ts_ms", "recv_ts_ms"],
                    )
                return
            except Exception as err:
                logger.error(f"TimescaleDB batch insert failed: {err}")

        if self._sqlite_conn:
            try:
                rows = [
                    (
                        datetime.datetime.fromtimestamp(t.exch_ts_ms / 1000.0, tz=datetime.timezone.utc).isoformat(),
                        t.venue,
                        t.symbol,
                        t.price,
                        t.qty,
                        t.exch_ts_ms,
                        t.recv_ts_ms,
                    )
                    for t in batch
                ]
                await self._sqlite_conn.executemany(
                    "INSERT INTO ticks (time_iso, venue, symbol, price, qty, exch_ts_ms, recv_ts_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    rows,
                )
                await self._sqlite_conn.commit()
            except Exception as e:
                logger.error(f"SQLite batch insert failed: {e}")

    async def store_closed_candle(self, symbol: str, timeframe: str, candle: Dict[str, Any]):
        if self._sqlite_conn:
            try:
                await self._sqlite_conn.execute(
                    """
                    INSERT OR REPLACE INTO closed_candles (symbol, timeframe, time_sec, open, high, low, close, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        symbol,
                        timeframe,
                        candle["time"],
                        candle["open"],
                        candle["high"],
                        candle["low"],
                        candle["close"],
                        candle["volume"],
                    ),
                )
                await self._sqlite_conn.commit()
            except Exception as e:
                logger.error(f"Error storing closed candle: {e}")

    async def get_db_candles(self, symbol: str, timeframe: str, limit: int = 100) -> List[Dict[str, Any]]:
        candles = []
        if self._sqlite_conn:
            try:
                cursor = await self._sqlite_conn.execute(
                    """
                    SELECT time_sec, open, high, low, close, volume
                    FROM closed_candles
                    WHERE symbol = ? AND timeframe = ?
                    ORDER BY time_sec DESC
                    LIMIT ?
                    """,
                    (symbol.upper(), timeframe, limit),
                )
                rows = await cursor.fetchall()
                for r in reversed(rows):
                    candles.append({
                        "time": r[0],
                        "open": r[1],
                        "high": r[2],
                        "low": r[3],
                        "close": r[4],
                        "volume": r[5],
                    })
            except Exception as e:
                logger.error(f"Error fetching DB candles: {e}")
        return candles

    def get_status(self) -> dict:
        return {
            "driver": "TIMESCALE" if self.is_timescale else "SQLITE_DEV_FALLBACK",
            "is_timescale": self.is_timescale,
            "total_inserted": self.total_inserted,
            "retention_days": RETENTION_DAYS if self.is_timescale else None,
            "continuous_aggregates": ["1m", "5m", "1h", "1d"] if self.is_timescale else [],
            "queue_pending": self._batch_queue.qsize(),
        }

    async def is_healthy(self) -> bool:
        if self.is_timescale and self.pool:
            try:
                async with self.pool.acquire() as conn:
                    val = await conn.fetchval("SELECT 1")
                    return val == 1
            except Exception:
                return False
        elif self._sqlite_conn:
            try:
                cur = await self._sqlite_conn.execute("SELECT 1")
                row = await cur.fetchone()
                return row is not None and row[0] == 1
            except Exception:
                return False
        return False

    async def close(self):
        self._running = False
        if self._writer_task:
            self._writer_task.cancel()
            try:
                await self._writer_task
            except asyncio.CancelledError:
                pass
        if self.pool:
            await self.pool.close()
        if self._sqlite_conn:
            await self._sqlite_conn.close()
        logger.info("Database connection closed.")
