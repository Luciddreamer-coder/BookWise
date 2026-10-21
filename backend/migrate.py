"""Apply the SQLAlchemy schema and seed the read-only book catalog."""

from .app import create_app
from .database import init_db


if __name__ == "__main__":
    create_app()
    init_db()
    print("Database schema is up to date.")
