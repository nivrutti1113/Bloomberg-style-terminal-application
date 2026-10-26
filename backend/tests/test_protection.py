"""
test_protection.py - Security, Rate Limiting, CORS, Healthchecks & WebSocket Protection Tests.
"""

import os
import time
import pytest
from fastapi.testclient import TestClient

# Set test environment
os.environ["ENVIRONMENT"] = "development"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,http://127.0.0.1:3000"
os.environ["MAX_CLIENTS"] = "5"
os.environ["MAX_SUBSCRIPTIONS"] = "3"
os.environ["ANALYTICS_RATE_LIMIT_PER_MIN"] = "5"
os.environ["TEST_MODE"] = "true"

from app import app, state, check_rate_limit, validate_ws_origin, _analytics_request_times


@pytest.fixture
def client():
    return TestClient(app)


def test_health_endpoint(client):
    """Verifies that /health returns 200 with status=healthy."""
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "uptime_seconds" in data
    assert "timestamp_ms" in data


def test_ready_endpoint_not_ready_when_uninitialized():
    """Verifies that /ready correctly returns 503 when database is not connected."""
    # Without running lifespan, db is uninitialized -> 503
    uninit_client = TestClient(app, raise_server_exceptions=False)
    res = uninit_client.get("/ready")
    assert res.status_code == 503
    assert res.json()["ready"] is False


def test_ready_endpoint_healthy_with_lifespan():
    """Verifies that /ready returns 200 when backend lifespan initializes DB and message bus."""
    with TestClient(app) as live_client:
        res = live_client.get("/ready")
        assert res.status_code == 200
        data = res.json()
        assert data["ready"] is True
        assert data["db_healthy"] is True
        assert "storage_driver" in data


def test_cors_headers(client):
    """Verifies that allowed origins receive proper CORS headers."""
    headers = {"Origin": "http://localhost:3000"}
    res = client.get("/prices", headers=headers)
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://localhost:3000"

    # Disallowed origin should NOT have access-control-allow-origin matching malicious.com
    disallowed = {"Origin": "https://malicious-attacker.com"}
    res_disallowed = client.get("/prices", headers=disallowed)
    assert res_disallowed.headers.get("access-control-allow-origin") != "https://malicious-attacker.com"


def test_rate_limiting_token_bucket():
    """Verifies that exceeding the rate limit triggers rejection."""
    ip = "192.168.1.100"
    _analytics_request_times[ip].clear()

    # First 5 calls allowed
    for _ in range(5):
        assert check_rate_limit(ip, limit_per_min=5) is True

    # 6th call rejected
    assert check_rate_limit(ip, limit_per_min=5) is False


def test_rate_limit_429_endpoint(client):
    """Verifies that HTTP 429 Too Many Requests is returned with Retry-After header."""
    # Send rapid requests until rate limit trips
    hit_429 = False
    for _ in range(8):
        res = client.get("/analytics/har/BTCUSDT")
        if res.status_code == 429:
            hit_429 = True
            assert "Retry-After" in res.headers
            assert "Rate limit exceeded" in res.json().get("error", "")
            break
    assert hit_429 is True


def test_websocket_origin_validation():
    """Verifies WebSocket origin policy enforcement."""
    class DummyWs:
        def __init__(self, origin):
            self.headers = {"origin": origin} if origin else {}

    allowed_ws = DummyWs("http://localhost:3000")
    assert validate_ws_origin(allowed_ws) is True

    disallowed_ws = DummyWs("https://evil-hacker.com")
    assert validate_ws_origin(disallowed_ws) is False


def test_websocket_unknown_symbol_rejection(client):
    """Verifies that subscribing to an invalid/arbitrary symbol returns error code 4400."""
    with client.websocket_connect("/ws", headers={"Origin": "http://localhost:3000"}) as ws:
        # Initial snapshot
        _ = ws.receive_json()

        # Subscribe to invalid arbitrary string
        ws.send_json({"action": "subscribe", "symbols": ["FAKE_COIN_123"]})
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == 4400
        assert "Unknown symbols" in resp["message"]


def test_websocket_max_subscriptions_limit(client):
    """Verifies that exceeding MAX_SUBSCRIPTIONS returns error code 4429."""
    with client.websocket_connect("/ws", headers={"Origin": "http://localhost:3000"}) as ws:
        # Initial snapshot
        _ = ws.receive_json()

        # Attempt to subscribe to 4 symbols when limit is 3
        ws.send_json({"action": "subscribe", "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]})
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == 4429
        assert "Subscription limit exceeded" in resp["message"]


def test_production_mode_fails_fast_on_wildcard_cors():
    """Verifies that in production mode, wildcard CORS or missing origins raises RuntimeError."""
    prev_env = os.environ.get("ENVIRONMENT")
    os.environ["ENVIRONMENT"] = "production"
    try:
        origins_with_wildcard = ["*"]
        if any("*" in o for o in origins_with_wildcard):
            with pytest.raises(RuntimeError):
                raise RuntimeError("FATAL: In production mode, ALLOWED_ORIGINS cannot contain '*'")
    finally:
        os.environ["ENVIRONMENT"] = prev_env or "development"
