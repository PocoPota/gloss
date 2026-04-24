import threading
import time

from gloss.translate._ratelimit import RateLimiter


def test_disabled_is_noop():
    lim = RateLimiter(0)
    assert not lim.enabled
    t0 = time.monotonic()
    for _ in range(100):
        lim.acquire()
    assert time.monotonic() - t0 < 0.05  # trivially fast


def test_serializes_requests():
    # 600 rpm -> 100ms minimum interval
    lim = RateLimiter(600)
    assert lim.enabled
    t0 = time.monotonic()
    for _ in range(3):
        lim.acquire()
    elapsed = time.monotonic() - t0
    # 3 requests must span >= 2 intervals (first is free-ish, next two wait)
    assert elapsed >= 0.18, elapsed
    assert elapsed < 0.5, elapsed


def test_thread_safe():
    lim = RateLimiter(1200)  # 50ms interval
    errors: list[BaseException] = []

    def worker():
        try:
            for _ in range(4):
                lim.acquire()
        except BaseException as e:  # pragma: no cover
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    t0 = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.monotonic() - t0
    # 16 acquires @ 50ms interval ≈ 15*0.05 = 0.75s at minimum
    assert not errors
    assert elapsed >= 0.7, elapsed
