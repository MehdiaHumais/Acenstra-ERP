from __future__ import annotations

import time

_START = time.perf_counter()


def uptime_seconds() -> float:
    return time.perf_counter() - _START
