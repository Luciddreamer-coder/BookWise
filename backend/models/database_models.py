from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, Text, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(150), unique=True, nullable=True)
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    ratings = relationship("Rating", back_populates="user", cascade="all, delete-orphan")
    favorites = relationship("Favorite", back_populates="user", cascade="all, delete-orphan")
    reading_list = relationship("ReadingListItem", back_populates="user", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class Book(Base):
    __tablename__ = "books"
    
    book_id = Column(Integer, primary_key=True)  # maps to Goodbooks book_id (1..10000)
    goodreads_book_id = Column(Integer, index=True)
    best_book_id = Column(Integer)
    work_id = Column(Integer)
    books_count = Column(Integer)
    isbn = Column(String(50))
    isbn13 = Column(String(50))
    authors = Column(String(500), index=True)
    original_publication_year = Column(Integer, index=True)
    original_title = Column(String(500))
    title = Column(String(500), nullable=False, index=True)
    language_code = Column(String(20))
    average_rating = Column(Float, index=True)
    ratings_count = Column(Integer, index=True)
    work_ratings_count = Column(Integer)
    work_text_reviews_count = Column(Integer)
    ratings_1 = Column(Integer)
    ratings_2 = Column(Integer)
    ratings_3 = Column(Integer)
    ratings_4 = Column(Integer)
    ratings_5 = Column(Integer)
    image_url = Column(String(500))
    small_image_url = Column(String(500))
    primary_genre = Column(String(100), index=True)
    top_tags = Column(Text)
    weighted_rating = Column(Float, index=True)
    has_valid_cover = Column(Boolean, default=True)

    def to_dict(self):
        return {
            "book_id": self.book_id,
            "goodreads_book_id": self.goodreads_book_id,
            "title": self.title,
            "original_title": self.original_title or self.title,
            "authors": self.authors,
            "original_publication_year": self.original_publication_year,
            "language_code": self.language_code,
            "average_rating": round(float(self.average_rating or 0.0), 2),
            "ratings_count": self.ratings_count,
            "weighted_rating": round(float(self.weighted_rating or self.average_rating or 0.0), 2),
            "image_url": self.image_url,
            "small_image_url": self.small_image_url,
            "primary_genre": self.primary_genre or "Fiction",
            "top_tags": [t.strip() for t in (self.top_tags or "").split(",") if t.strip()][:10],
            "has_valid_cover": bool(self.has_valid_cover),
            "ratings_distribution": {
                "1": self.ratings_1 or 0,
                "2": self.ratings_2 or 0,
                "3": self.ratings_3 or 0,
                "4": self.ratings_4 or 0,
                "5": self.ratings_5 or 0,
            }
        }

class Rating(Base):
    __tablename__ = "ratings"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id"), nullable=False, index=True)
    rating = Column(Float, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship("User", back_populates="ratings")
    book = relationship("Book")
    
    __table_args__ = (
        Index("idx_user_book_rating", "user_id", "book_id", unique=True),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "book_id": self.book_id,
            "rating": self.rating,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "book": self.book.to_dict() if self.book else None
        }


class FeedbackEvent(Base):
    """Explicit recommendation feedback used for lightweight online signals."""
    __tablename__ = "feedback_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id"), nullable=False, index=True)
    event_type = Column(String(30), nullable=False, index=True)  # click, save, rating
    value = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "book_id": self.book_id,
            "event_type": self.event_type,
            "value": self.value,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class Favorite(Base):
    __tablename__ = "favorites"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship("User", back_populates="favorites")
    book = relationship("Book")
    
    __table_args__ = (
        Index("idx_user_book_fav", "user_id", "book_id", unique=True),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "book_id": self.book_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "book": self.book.to_dict() if self.book else None
        }

class ReadingListItem(Base):
    __tablename__ = "reading_list"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id"), nullable=False, index=True)
    # Status: 'want_to_read', 'currently_reading', 'read'
    status = Column(String(50), default="want_to_read", nullable=False, index=True)
    added_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship("User", back_populates="reading_list")
    book = relationship("Book")
    
    __table_args__ = (
        Index("idx_user_book_reading", "user_id", "book_id", unique=True),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "book_id": self.book_id,
            "status": self.status,
            "added_at": self.added_at.isoformat() if self.added_at else None,
            "book": self.book.to_dict() if self.book else None
        }
