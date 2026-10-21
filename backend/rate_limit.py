"""Small dependency-free, process-local request rate limiter.

The API is normally run behind a single Gunicorn process group in local and
small deployments.  This limiter intentionally keeps state in the application
process so it adds no service dependency; production deployments that need
cross-worker/global limits can replace it with an edge or shared-store limit.
"""

from collections import defaultdict, deque
from functools import wraps
from threading import RLock
from time import monotonic

from flask import current_app, jsonify, request


class InMemoryRateLimiter:
    def __init__(self):
        self._requests = defaultdict(deque)
        self._lock = RLock()

    def check(self, key, limit, window_seconds):
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            # Evict inactive keys instead of retaining every historical visitor.
            for old_key in list(self._requests):
                queue = self._requests[old_key]
                if not queue or queue[-1] <= cutoff:
                    del self._requests[old_key]
            bucket = self._requests[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(1, int(bucket[0] + window_seconds - now + 0.999))
                return False, retry_after
            bucket.append(now)
            return True, None


def _request_key(name):
    # Arbitrary/rotating Authorization strings must not create fresh quotas.
    # Login/registration always use IP; verified mutation users use stable IDs.
    if name not in {"login", "register"}:
        from .auth import current_user
        user = current_user()
        if user is not None:
            return name, "user", user.id
    return name, "ip", request.remote_addr or "unknown"


def rate_limit(name):
    """Limit an endpoint using ``RATE_LIMIT_<NAME>_MAX`` config values."""

    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            limit = int(current_app.config.get(f"RATE_LIMIT_{name.upper()}_MAX", 10))
            window = int(current_app.config.get("RATE_LIMIT_WINDOW_SECONDS", 60))
            limiter = current_app.extensions.setdefault("bookwise_rate_limiter", InMemoryRateLimiter())
            allowed, retry_after = limiter.check(_request_key(name), limit, window)
            if not allowed:
                response = jsonify({
                    "error": {
                        "code": "rate_limited",
                        "message": "Too many requests. Please try again later.",
                    }
                })
                response.headers["Retry-After"] = str(retry_after)
                return response, 429
            return view(*args, **kwargs)

        return wrapped

    return decorator
