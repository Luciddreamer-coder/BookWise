"""Disposable local API for browser QA; never opens the user's application DB.

Run: python -m scripts.smoke_server --port 8019 --frontend-port 5190
Terminate after running scripts/phase4_browser_smoke.mjs with the browser skill.
"""
import argparse
import secrets
import tempfile
from pathlib import Path

from backend.app import create_app
from backend.config import Config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8019)
    parser.add_argument("--frontend-port", type=int, default=5190)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="bookwise-browser-qa-") as directory:
        class SmokeConfig(Config):
            SECRET_KEY = secrets.token_urlsafe(48)
            SQLALCHEMY_DATABASE_URI = "sqlite:///" + str(Path(directory) / "qa.db")
            AUTH_COOKIE_SECURE = False  # Loopback-only disposable HTTP QA.
            CORS_ORIGINS = [f"http://localhost:{args.frontend_port}", f"http://127.0.0.1:{args.frontend_port}"]

            @classmethod
            def validate(cls):
                pass

        app = create_app(SmokeConfig)
        app.run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
