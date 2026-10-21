import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
    # Supports SQLite by default for instant zero-dependency execution,
    # or PostgreSQL via DATABASE_URL: postgresql://user:pass@localhost:5432/bookwise
    DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'backend', 'bookwise.db')}")
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgres://") :]
    elif DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgresql://") :]
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    AUTH_TOKEN_MAX_AGE = int(os.getenv("AUTH_TOKEN_MAX_AGE", "86400"))
    AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "bookwise_access_token")
    AUTH_COOKIE_SAMESITE = os.getenv("AUTH_COOKIE_SAMESITE", "Lax")
    AUTH_COOKIE_HTTPONLY = True
    AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "").lower() in {"1", "true", "yes"}
    RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
    RATE_LIMIT_LOGIN_MAX = int(os.getenv("RATE_LIMIT_LOGIN_MAX", "10"))
    RATE_LIMIT_REGISTER_MAX = int(os.getenv("RATE_LIMIT_REGISTER_MAX", "10"))
    RATE_LIMIT_FEEDBACK_MAX = int(os.getenv("RATE_LIMIT_FEEDBACK_MAX", "60"))
    RATE_LIMIT_RATING_MAX = int(os.getenv("RATE_LIMIT_RATING_MAX", "30"))
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ]
    
    DATA_DIR = os.path.join(BASE_DIR, "data")
    PROCESSED_DATA_DIR = os.path.join(DATA_DIR, "processed")
    ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")
    
    BOOKS_CSV = os.path.join(PROCESSED_DATA_DIR, "books_clean.csv")
    RATINGS_CSV = os.path.join(PROCESSED_DATA_DIR, "train_ratings.csv")

    @classmethod
    def validate(cls):
        environment = os.getenv("FLASK_ENV", os.getenv("APP_ENV", "development")).lower()
        if environment == "production":
            secret = str(cls.SECRET_KEY or "").strip()
            placeholders = {
                "dev-only-change-me",
                "replace-with-a-long-random-value",
                "change-me",
                "secret",
                "secret-key",
            }
            lowered = secret.lower()
            is_placeholder = lowered in placeholders or any(
                marker in lowered for marker in ("replace-with", "change-me", "your-secret", "example", "dev-only")
            )
            if is_placeholder or len(secret) < 32:
                raise RuntimeError("SECRET_KEY must be a long, non-default random value in production")
            cls.AUTH_COOKIE_SECURE = True
