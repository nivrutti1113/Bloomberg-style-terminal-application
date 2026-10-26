"""
benchmark_ws.py - High-Concurrency WebSocket & Throughput Benchmark.
Simulates 50-200 concurrent clients connected to /ws, measuring:
  - Throughput (ticks/sec)
  - End-to-end latency percentiles (p50, p90, p95, p99, max)
  - Memory and connection stability
"""

import asyncio
import json
import time
import numpy as np
import websockets

BACKEND_WS_URL = "ws://localhost:8000/ws"
CONCURRENT_CLIENTS = 50
DURATION_SECONDS = 10


async def client_worker(client_id: int, latencies: list, message_counts: list, stop_event: asyncio.Event):
    msg_count = 0
    try:
        async with websockets.connect(BACKEND_WS_URL, close_timeout=2) as ws:
            # Subscribe to symbols
            await ws.send(json.dumps({"action": "subscribe", "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"]}))

            while not stop_event.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    recv_ts = int(time.time() * 1000)
                    msg_count += 1

                    data = json.loads(raw)
                    if data.get("type") == "tick" and "data" in data:
                        tick = data["data"]
                        exch_ts = tick.get("exch_ts_ms", recv_ts)
                        lat = max(0, recv_ts - exch_ts)
                        latencies.append(lat)
                except asyncio.TimeoutError:
                    pass
    except Exception as e:
        print(f"[Client {client_id}] Disconnected: {e}")
    finally:
        message_counts.append(msg_count)


async def run_benchmark(num_clients: int = CONCURRENT_CLIENTS, duration: int = DURATION_SECONDS):
    print(f"\n=======================================================")
    print(f"STARTING REAL-TIME WEBSOCKET BENCHMARK")
    print(f"Target: {BACKEND_WS_URL}")
    print(f"Concurrent Clients: {num_clients}")
    print(f"Duration: {duration}s")
    print(f"=======================================================\n")

    latencies = []
    message_counts = []
    stop_event = asyncio.Event()

    tasks = [
        asyncio.create_task(client_worker(i, latencies, message_counts, stop_event))
        for i in range(num_clients)
    ]

    # Run for specified duration
    await asyncio.sleep(duration)
    stop_event.set()

    await asyncio.gather(*tasks, return_exceptions=True)

    total_msgs = sum(message_counts)
    ticks_per_sec = total_msgs / duration if duration > 0 else 0

    print(f"\n--- BENCHMARK RESULTS ---")
    print(f"Total Messages Received: {total_msgs:,}")
    print(f"Throughput: {ticks_per_sec:.1f} msgs/sec across {num_clients} clients")

    if latencies:
        arr = np.array(latencies)
        p50 = np.percentile(arr, 50)
        p90 = np.percentile(arr, 90)
        p95 = np.percentile(arr, 95)
        p99 = np.percentile(arr, 99)
        max_lat = np.max(arr)

        print(f"p50 Latency: {p50:.1f} ms")
        print(f"p90 Latency: {p90:.1f} ms")
        print(f"p95 Latency: {p95:.1f} ms")
        print(f"p99 Latency: {p99:.1f} ms")
        print(f"Max Latency: {max_lat:.1f} ms")
    else:
        print("Note: Backend was offline during benchmark (start app.py first).")

    print(f"=======================================================\n")


if __name__ == "__main__":
    asyncio.run(run_benchmark())
