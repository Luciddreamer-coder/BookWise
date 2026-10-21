"""Writable, project-local paths for isolated backend tests."""

from pathlib import Path
from tempfile import TemporaryDirectory


TEST_TMP_ROOT = Path(__file__).resolve().parents[2] / ".test-tmp"
TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)


def temporary_test_directory(prefix="bookwise-test-"):
    """Create a disposable directory where SQLite can create a database."""
    return TemporaryDirectory(prefix=prefix, dir=TEST_TMP_ROOT)
