"""
Cache Service — Two-tier caching for sub-second repeat queries.

L1: In-memory dict (instant, per-process)
L2: Azure Cache for Redis (shared, survives restarts)

Cache key = hash of (normalized question + role_name + row_scope)
Different roles get different cache entries since RBAC produces
different results for the same question.

Graceful degradation: if Redis is down, L1-only. Never breaks the app.
"""

import hashlib
import json
import time
import os
from typing import Optional
from dataclasses import dataclass


@dataclass
class CacheEntry:
    data: dict
    timestamp: float
    ttl: int


class CacheService:

    DEFAULT_TTL = 3600  # 1 hour

    def __init__(self):
        self._l1: dict[str, CacheEntry] = {}
        self._l1_max = 200
        self._redis = None
        self._redis_ok = None
        self._redis_url = os.getenv("REDIS_URL", "")

    def _get_redis(self):
        if self._redis_ok is False:
            return None
        if self._redis is None and self._redis_url:
            try:
                import redis
                self._redis = redis.Redis.from_url(
                    self._redis_url, decode_responses=True,
                    socket_timeout=2, socket_connect_timeout=2,
                )
                self._redis.ping()
                self._redis_ok = True
            except Exception as e:
                print(f"Redis unavailable: {e}")
                self._redis = None
                self._redis_ok = False
        return self._redis

    def _key(self, question: str, role: str, scope: str) -> str:
        raw = f"{question.lower().strip()}|{role}|{scope}"
        return f"q2i:{hashlib.sha256(raw.encode()).hexdigest()[:16]}"

    def get(self, question: str, role: str, scope: str) -> Optional[dict]:
        key = self._key(question, role, scope)
        # L1
        entry = self._l1.get(key)
        if entry and (time.time() - entry.timestamp) < entry.ttl:
            return entry.data
        self._l1.pop(key, None)
        # L2
        r = self._get_redis()
        if r:
            try:
                raw = r.get(key)
                if raw:
                    data = json.loads(raw)
                    self._l1[key] = CacheEntry(data=data, timestamp=time.time(), ttl=self.DEFAULT_TTL)
                    return data
            except Exception:
                pass
        return None

    def put(self, question: str, role: str, scope: str, data: dict, ttl: int = None):
        ttl = ttl or self.DEFAULT_TTL
        key = self._key(question, role, scope)
        if len(self._l1) >= self._l1_max:
            oldest = min(self._l1, key=lambda k: self._l1[k].timestamp)
            del self._l1[oldest]
        self._l1[key] = CacheEntry(data=data, timestamp=time.time(), ttl=ttl)
        r = self._get_redis()
        if r:
            try:
                r.setex(key, ttl, json.dumps(data))
            except Exception:
                pass

    def stats(self) -> dict:
        return {
            "l1_entries": len(self._l1),
            "l2_available": self._redis_ok or False,
        }
