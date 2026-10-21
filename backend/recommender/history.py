"""Thread-safe cached access to the offline rating history.

The recommendation API is called frequently by the UI.  Loading the multi-million
row training CSV inside every request made cold-start users disproportionately
expensive, so the file is indexed once per process and returned as immutable-ish
copies to callers.
"""

import os
import threading
from typing import Dict, List

import pandas as pd

from ..config import Config

_lock = threading.RLock()
_history_by_user: Dict[int, tuple] = {}
_loaded_mtime: float | None = None


def _load_history_if_needed() -> None:
    global _history_by_user, _loaded_mtime
    path = Config.RATINGS_CSV
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = None

    if _loaded_mtime == mtime:
        return
    if mtime is None:
        _history_by_user = {}
        _loaded_mtime = None
        return

    # Only read columns used by recommendation profiles.  The resulting index is
    # kept in memory once, rather than re-reading the entire CSV per request.
    frame = pd.read_csv(path, usecols=("user_id", "book_id", "rating"))
    indexed: Dict[int, list] = {}
    for row in frame.itertuples(index=False):
        indexed.setdefault(int(row.user_id), []).append(
            {"book_id": int(row.book_id), "rating": float(row.rating)}
        )
    _history_by_user = {uid: tuple(rows) for uid, rows in indexed.items()}
    _loaded_mtime = mtime


def get_cached_user_history(user_id: int) -> List[dict]:
    """Return a fresh list for ``user_id`` from the cached training index."""
    with _lock:
        _load_history_if_needed()
        return [dict(item) for item in _history_by_user.get(int(user_id), ())]


def invalidate_user_history_cache(user_id: int | None = None) -> None:
    """Invalidate all or one cached history entry after data changes."""
    global _loaded_mtime
    with _lock:
        if user_id is None:
            _history_by_user.clear()
            _loaded_mtime = None
        else:
            # Application ratings are read from SQLite before this offline
            # history.  Keep the immutable CSV entry warm so saving a rating
            # does not force the multi-million-row file to be read again.
            return


def history_cache_info() -> dict:
    """Small diagnostic used by tests and operational checks."""
    with _lock:
        return {"loaded": _loaded_mtime is not None, "users": len(_history_by_user)}
