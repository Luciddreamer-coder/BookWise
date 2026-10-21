"""Private reader records and explicitly published community content."""

from datetime import datetime, timezone
import unicodedata

from sqlalchemy import CheckConstraint, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint

from .database_models import Base


def utcnow():
    return datetime.now(timezone.utc)


def _author_key(context):
    return unicodedata.normalize("NFKC", context.get_current_parameters()["author"]).casefold()


class ReadingProgress(Base):
    __tablename__ = "reader_progress"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id", ondelete="CASCADE"), nullable=False, index=True)
    percent = Column(Float, nullable=False, default=0)
    current_page = Column(Integer)
    total_pages = Column(Integer)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint("user_id", "book_id"),
        CheckConstraint("percent >= 0 AND percent <= 100"),
        CheckConstraint("(current_page IS NULL AND total_pages IS NULL) OR "
                        "(current_page IS NOT NULL AND total_pages IS NOT NULL AND "
                        "total_pages > 0 AND total_pages <= 100000 AND current_page >= 0 AND current_page <= total_pages)"),
    )


class ReaderNote(Base):
    __tablename__ = "reader_notes"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(10), nullable=False)
    text = Column(Text, nullable=False)
    page = Column(Integer)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (CheckConstraint("kind IN ('note', 'quote')"), CheckConstraint("page IS NULL OR (page >= 1 AND page <= 100000)"))


class ReaderReview(Base):
    __tablename__ = "reader_reviews"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id", ondelete="CASCADE"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    visibility = Column(String(10), nullable=False, default="private", index=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (UniqueConstraint("user_id", "book_id"), CheckConstraint("visibility IN ('private', 'public')"))


class ReaderComment(Base):
    __tablename__ = "reader_comments"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id", ondelete="CASCADE"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class ReaderShelf(Base):
    __tablename__ = "reader_shelves"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    name_key = Column(String(300), nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "name_key"),)


class ReaderShelfBook(Base):
    __tablename__ = "reader_shelf_books"
    shelf_id = Column(Integer, ForeignKey("reader_shelves.id", ondelete="CASCADE"), primary_key=True)
    book_id = Column(Integer, ForeignKey("books.book_id", ondelete="CASCADE"), primary_key=True)


class FollowedAuthor(Base):
    __tablename__ = "reader_followed_authors"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    author = Column(String(200), nullable=False)
    author_key = Column(String(600), nullable=False, default=_author_key)
    __table_args__ = (UniqueConstraint("user_id", "author_key"),)


class ReaderList(Base):
    __tablename__ = "reader_lists"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(100), nullable=False)
    title_key = Column(String(300), nullable=False)
    share_token = Column(String(64), unique=True, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    __table_args__ = (UniqueConstraint("user_id", "title_key"),)


class ReaderListBook(Base):
    __tablename__ = "reader_list_books"
    list_id = Column(Integer, ForeignKey("reader_lists.id", ondelete="CASCADE"), primary_key=True)
    book_id = Column(Integer, ForeignKey("books.book_id", ondelete="CASCADE"), primary_key=True)
    position = Column(Integer, nullable=False)
