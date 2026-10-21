import os
import pandas as pd
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, scoped_session
from .config import Config
from .models.database_models import Base, Book, User, Rating, Favorite, ReadingListItem, FeedbackEvent

def _create_engine(database_url):
    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False} if database_url.startswith("sqlite") else {},
        pool_pre_ping=True,
    )
    if database_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    return engine


engine = _create_engine(Config.SQLALCHEMY_DATABASE_URI)

SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))


def configure_database(database_url):
    """Rebind the session factory, primarily for app factories and tests."""
    global engine, SessionLocal
    SessionLocal.remove()
    engine = _create_engine(database_url)
    SessionLocal.configure(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Create all tables and seed books from processed CSV if table is empty."""
    print("Initializing database tables...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        book_count = db.query(Book).count()
        if book_count == 0:
            csv_path = Config.BOOKS_CSV
            if os.path.exists(csv_path):
                print(f"Seeding books table from {csv_path}...")
                books_df = pd.read_csv(csv_path)
                
                # Bulk insert in batches
                batch = []
                for _, row in books_df.iterrows():
                    book = Book(
                        book_id=int(row["book_id"]),
                        goodreads_book_id=int(row.get("goodreads_book_id", 0)),
                        best_book_id=int(row.get("best_book_id", 0)),
                        work_id=int(row.get("work_id", 0)),
                        books_count=int(row.get("books_count", 1)),
                        isbn=str(row.get("isbn", "")) if pd.notna(row.get("isbn")) else None,
                        isbn13=str(row.get("isbn13", "")) if pd.notna(row.get("isbn13")) else None,
                        authors=str(row.get("authors", "Unknown")),
                        original_publication_year=int(row.get("original_publication_year", 0)),
                        original_title=str(row.get("original_title", row.get("title", ""))),
                        title=str(row.get("title", "")),
                        language_code=str(row.get("language_code", "eng")),
                        average_rating=float(row.get("average_rating", 0.0)),
                        ratings_count=int(row.get("ratings_count", 0)),
                        work_ratings_count=int(row.get("work_ratings_count", 0)),
                        work_text_reviews_count=int(row.get("work_text_reviews_count", 0)),
                        ratings_1=int(row.get("ratings_1", 0)),
                        ratings_2=int(row.get("ratings_2", 0)),
                        ratings_3=int(row.get("ratings_3", 0)),
                        ratings_4=int(row.get("ratings_4", 0)),
                        ratings_5=int(row.get("ratings_5", 0)),
                        image_url=str(row.get("image_url", "")),
                        small_image_url=str(row.get("small_image_url", "")),
                        primary_genre=str(row.get("primary_genre", "Fiction")),
                        top_tags=str(row.get("top_tags", "")),
                        weighted_rating=float(row.get("weighted_rating", 0.0)),
                        has_valid_cover=bool(row.get("has_valid_cover", True))
                    )
                    batch.append(book)
                    if len(batch) >= 1000:
                        db.bulk_save_objects(batch)
                        db.commit()
                        batch = []
                if batch:
                    db.bulk_save_objects(batch)
                    db.commit()
                print(f"Successfully seeded {len(books_df):,} books into database.")
            else:
                print(f"Warning: Clean books CSV not found at {csv_path}")

    except Exception as e:
        print(f"Error in init_db: {e}")
        db.rollback()
    finally:
        db.close()
