#!/usr/bin/env python3
"""
Simple stress test for the /translate endpoint.
Uses standard library only (urllib + ThreadPoolExecutor) to avoid extra deps.

Metrics reported:
- Total requests, successes, failures
- Requests/sec (successes only)
- Latency percentiles (p50/p90/p99)

Example:
  python scripts/benchmark_translate.py --word 先生 --concurrency 32 --duration 15
"""
from __future__ import annotations

import argparse
import json
import threading
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from statistics import median


def percentile(values, p):
    if not values:
        return None
    values_sorted = sorted(values)
    k = (len(values_sorted) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(values_sorted) - 1)
    if f == c:
        return values_sorted[f]
    d0 = values_sorted[f] * (c - k)
    d1 = values_sorted[c] * (k - f)
    return d0 + d1


def do_request(url: str, payload: dict, timeout: float) -> tuple[bool, float]:
    start = time.perf_counter()
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            # Read response to completion to avoid socket reuse issues
            _ = resp.read()
            ok = 200 <= resp.status < 300
    except Exception:
        ok = False
    end = time.perf_counter()
    return ok, (end - start)


def worker_loop(url: str, word: str, end_time: float, timeout: float, counters, latencies):
    payload = {"word": word}
    while time.perf_counter() < end_time:
        ok, dur = do_request(url, payload, timeout)
        with counters["lock"]:
            counters["total"] += 1
            if ok:
                counters["success"] += 1
                latencies.append(dur)
            else:
                counters["fail"] += 1


def main():
    parser = argparse.ArgumentParser(description="Stress test /translate throughput")
    parser.add_argument("--url", default="http://127.0.0.1:7752/translate", help="Translate endpoint URL")
    parser.add_argument("--word", default="先生", help="Word to translate repeatedly")
    parser.add_argument("--concurrency", type=int, default=16, help="Number of parallel workers")
    parser.add_argument("--duration", type=float, default=10.0, help="Test duration in seconds")
    parser.add_argument("--timeout", type=float, default=5.0, help="Per-request timeout in seconds")
    parser.add_argument("--warmup", type=float, default=1.0, help="Warmup duration in seconds (excluded from metrics)")
    args = parser.parse_args()

    # Warm-up (optional): run a few sequential requests to prime caches
    warmup_until = time.perf_counter() + max(0.0, args.warmup)
    try:
        while time.perf_counter() < warmup_until:
            do_request(args.url, {"word": args.word}, args.timeout)
    except Exception:
        pass

    counters = {"total": 0, "success": 0, "fail": 0, "lock": threading.Lock()}
    latencies = []  # seconds

    end_time = time.perf_counter() + args.duration
    start_time = time.perf_counter()

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = [
            ex.submit(worker_loop, args.url, args.word, end_time, args.timeout, counters, latencies)
            for _ in range(args.concurrency)
        ]
        for _ in as_completed(futures):
            # All workers run until time; completion is expected when duration elapses
            pass

    elapsed = time.perf_counter() - start_time

    # Compute metrics
    p50 = percentile(latencies, 50)
    p90 = percentile(latencies, 90)
    p99 = percentile(latencies, 99)

    def fmt(v):
        return f"{v*1000:.1f} ms" if v is not None else "n/a"

    print("\nTranslate benchmark results")
    print("-" * 32)
    print(f"URL           : {args.url}")
    print(f"Word          : {args.word}")
    print(f"Concurrency   : {args.concurrency}")
    print(f"Duration      : {elapsed:.2f} s (excl. warmup {args.warmup:.1f}s)")
    print(f"Total         : {counters['total']}")
    print(f"Success       : {counters['success']}")
    print(f"Failures      : {counters['fail']}")
    qps = (counters["success"] / elapsed) if elapsed > 0 else 0.0
    print(f"Requests/sec  : {qps:.1f} (success only)")
    print(f"Latency p50   : {fmt(p50)}")
    print(f"Latency p90   : {fmt(p90)}")
    print(f"Latency p99   : {fmt(p99)}")


if __name__ == "__main__":
    main()
