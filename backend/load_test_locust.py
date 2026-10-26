"""
load_test_locust.py - Locust Load Testing Suite for Terminal Backend.
Tests REST endpoints (/prices, /metrics, /candles, /analytics) and WebSocket concurrency.
Run via:
    locust -f load_test_locust.py --headless -u 50 -r 10 -t 30s --host http://localhost:8000
"""

import json
import time
from locust import HttpUser, task, between
import websocket

class TerminalRestUser(HttpUser):
    wait_time = between(0.1, 0.5)

    @task(4)
    def test_get_prices(self):
        self.client.get("/prices", name="/prices")

    @task(3)
    def test_get_metrics(self):
        self.client.get("/metrics", name="/metrics")

    @task(2)
    def test_get_candles(self):
        self.client.get("/candles?symbol=BTCUSDT&tf=1m&limit=100", name="/candles?tf=1m")

    @task(1)
    def test_get_har_analytics(self):
        self.client.get("/analytics/har/BTCUSDT", name="/analytics/har")

    @task(1)
    def test_get_voltarget_analytics(self):
        self.client.get("/analytics/voltarget/BTCUSDT", name="/analytics/voltarget")


class TerminalWsUser(HttpUser):
    """Simulates persistent WebSocket connections subscribing to live market ticks."""
    wait_time = between(1.0, 3.0)

    @task
    def ws_session(self):
        ws_url = "ws://localhost:8000/ws"
        start_time = time.time()
        try:
            ws = websocket.create_connection(ws_url, timeout=5)
            # Subscribe to symbols
            sub_msg = json.dumps({"action": "subscribe", "symbols": ["BTCUSDT", "ETHUSDT"]})
            ws.send(sub_msg)

            # Read a few messages and record latency
            for _ in range(10):
                msg = ws.recv()
                data = json.loads(msg)
                if data.get("type") == "tick" and "data" in data:
                    t = data["data"]
                    # Calculate exchange to terminal latency
                    lat = max(0, t.get("recv_ts_ms", 0) - t.get("exch_ts_ms", 0))

            ws.close()
            total_time = int((time.time() - start_time) * 1000)
            self.environment.events.request.fire(
                request_type="WebSocket",
                name="/ws [ticks_stream]",
                response_time=total_time,
                response_length=10,
                exception=None,
                context={},
            )
        except Exception as e:
            total_time = int((time.time() - start_time) * 1000)
            self.environment.events.request.fire(
                request_type="WebSocket",
                name="/ws [ticks_stream]",
                response_time=total_time,
                response_length=0,
                exception=e,
                context={},
            )
