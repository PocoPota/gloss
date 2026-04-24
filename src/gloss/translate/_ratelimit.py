"""Simple thread-safe rate limiter shared by LLM translators.

Usage:
    limiter = RateLimiter(rpm=10)
    with limiter:            # or limiter.acquire()
        call_api(...)

Implementation: minimum-interval limiter. `rpm=10` means requests are
serialised so at most 10 start per minute (≈ one every 6s). This sacrifices
burstiness but is trivial to reason about and safe for free-tier quotas.

Set `rpm=0` (or None) to disable — acquire() becomes a no-op.
"""

from __future__ import annotations

import threading
import time


class RateLimiter:
    def __init__(self, rpm: int | float | None):
        rpm = float(rpm) if rpm else 0.0
        self._interval = 60.0 / rpm if rpm > 0 else 0.0
        self._lock = threading.Lock()
        self._next_allowed = 0.0  # monotonic time of next permitted request

    @property
    def enabled(self) -> bool:
        return self._interval > 0.0

    def acquire(self) -> None:
        if not self.enabled:
            return
        with self._lock:
            now = time.monotonic()
            wait = self._next_allowed - now
            if wait > 0:
                self._next_allowed = self._next_allowed + self._interval
            else:
                wait = 0.0
                self._next_allowed = now + self._interval
        if wait > 0:
            time.sleep(wait)

    def __enter__(self) -> "RateLimiter":
        self.acquire()
        return self

    def __exit__(self, *_exc) -> None:
        return None
