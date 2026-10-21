"""Reader workspace API. All data is private unless explicitly published."""

import math
import secrets
import unicodedata
from functools import wraps

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm.exc import StaleDataError

from ..auth import current_user, require_auth
from ..database import SessionLocal
from ..models.database_models import Book, ReadingListItem, User
from ..models.reader_models import (
    FollowedAuthor, ReaderComment, ReaderList, ReaderListBook, ReaderNote,
    ReaderReview, ReaderShelf, ReaderShelfBook, ReadingProgress, utcnow,
)
from ..rate_limit import InMemoryRateLimiter, rate_limit

reader_bp = Blueprint("reader", __name__)
MAX_BOOKS = 100


class ReaderError(Exception):
    def __init__(self, message, status=400, code="validation_error"):
        self.message, self.status, self.code = message, status, code


def _missing():
    raise ReaderError("Resource not found", 404, "not_found")


def _data():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ReaderError("A JSON object is required")
    if "user_id" in data and data["user_id"] != current_user().id:
        raise ReaderError("You may only modify your own reader data", 403, "forbidden")
    return data


def _text(data, field="text", maximum=5000):
    value = data.get(field)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ReaderError(f"{field} must contain 1–{maximum} characters")
    value = value.strip()
    if any(unicodedata.category(char) == "Cc" and char not in "\n\r\t" for char in value):
        raise ReaderError(f"{field} contains invalid control characters")
    # Stored and returned as text in JSON; clients must render text nodes.
    return value


def _key(value):
    return unicodedata.normalize("NFKC", value).casefold()


def _integer(value, field, minimum=1, maximum=100000):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ReaderError(f"{field} must be an integer between {minimum} and {maximum}")
    return value


def _book(db, book_id):
    book = db.get(Book, book_id)
    if book is None:
        _missing()
    return book


def _owned(db, model, row_id, user_id):
    row = db.query(model).filter_by(id=row_id, user_id=user_id).first()
    if row is None:
        _missing()
    return row


def _iso(value):
    from datetime import timezone
    return value.replace(tzinfo=timezone.utc).isoformat() if value.tzinfo is None else value.astimezone(timezone.utc).isoformat()


def _progress(row):
    return {"percent": row.percent if row else 0,
            "current_page": row.current_page if row else None,
            "total_pages": row.total_pages if row else None}


def _note(row):
    return {"id": row.id, "kind": row.kind, "text": row.text, "page": row.page,
            "created_at": _iso(row.created_at)}


def _review(row):
    return {"id": row.id, "text": row.text, "visibility": row.visibility} if row else None


def _public_text(row, username):
    return {"id": row.id, "text": row.text, "user_id": row.user_id, "username": username}


def _catalog(book):
    # Explicit allowlist: shared links never serialize users or reader records.
    return {field: getattr(book, field) for field in (
        "book_id", "title", "authors", "image_url", "small_image_url",
        "average_rating", "primary_genre", "original_publication_year",
    )}


def _shelf(db, row):
    books = db.query(Book).join(ReaderShelfBook, ReaderShelfBook.book_id == Book.book_id).filter(
        ReaderShelfBook.shelf_id == row.id).order_by(Book.book_id).all()
    return {"id": row.id, "name": row.name, "book_ids": [b.book_id for b in books],
            "books": [_catalog(b) for b in books]}


def _list(db, row):
    ids = db.query(ReaderListBook.book_id).filter_by(list_id=row.id).order_by(ReaderListBook.position).all()
    return {"id": row.id, "title": row.title, "book_ids": [item[0] for item in ids], "share_token": row.share_token}


def _endpoint(*, write=False, public=False):
    """Centralize rollback, scoped sessions, errors, and authenticated limits."""
    def decorate(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user_id = None if public else current_user().id
            if write:
                # Stable identity prevents a fresh bearer token bypassing quotas.
                limiter = current_app.extensions.setdefault("reader_identity_limiter", InMemoryRateLimiter())
                allowed, retry_after = limiter.check(
                    ("reader", user_id), int(current_app.config.get("RATE_LIMIT_READER_USER_MAX", 60)),
                    int(current_app.config.get("RATE_LIMIT_WINDOW_SECONDS", 60)))
                if not allowed:
                    response = jsonify({"error": {"code": "rate_limited", "message": "Too many reader updates. Try again later."}})
                    response.headers["Retry-After"] = str(retry_after)
                    return response, 429
            db = SessionLocal()
            try:
                for field, value in kwargs.items():
                    if field.endswith("_id"):
                        _integer(value, field, maximum=2147483647)
                result = view(db, user_id, *args, **kwargs)
                if write:
                    db.commit()
                return result
            except ReaderError as error:
                db.rollback()
                return jsonify({"error": {"code": error.code, "message": error.message}}), error.status
            except (IntegrityError, StaleDataError):
                db.rollback()
                return jsonify({"error": {"code": "conflict", "message": "This record already exists or changed. Refresh and try again."}}), 409
            except OperationalError as error:
                db.rollback()
                if "locked" not in str(error).lower() and "deadlock" not in str(error).lower():
                    raise
                return jsonify({"error": {"code": "conflict", "message": "A concurrent update is in progress. Try again."}}), 409
            finally:
                db.close()
        if write:
            wrapped = rate_limit("reader_mutation")(wrapped)
        return wrapped if public else require_auth(wrapped)
    return decorate


@reader_bp.after_request
def reader_response_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@reader_bp.get("/reader/books/<int:book_id>")
@_endpoint()
def get_book_workspace(db, user_id, book_id):
    _book(db, book_id)
    progress = db.query(ReadingProgress).filter_by(user_id=user_id, book_id=book_id).first()
    notes = db.query(ReaderNote).filter_by(user_id=user_id, book_id=book_id).order_by(ReaderNote.id.desc()).all()
    review = db.query(ReaderReview).filter_by(user_id=user_id, book_id=book_id).first()
    shelves = db.query(ReaderShelf).join(ReaderShelfBook, ReaderShelfBook.shelf_id == ReaderShelf.id).filter(
        ReaderShelf.user_id == user_id, ReaderShelfBook.book_id == book_id).order_by(ReaderShelf.name).all()
    comments = db.query(ReaderComment, User.username).join(User, User.id == ReaderComment.user_id).filter(
        ReaderComment.book_id == book_id).order_by(ReaderComment.id.desc()).limit(100).all()
    reviews = db.query(ReaderReview, User.username).join(User, User.id == ReaderReview.user_id).filter(
        ReaderReview.book_id == book_id, ReaderReview.visibility == "public").order_by(ReaderReview.updated_at.desc()).limit(100).all()
    authors = db.query(FollowedAuthor).filter_by(user_id=user_id).order_by(FollowedAuthor.author).all()
    return jsonify({"progress": _progress(progress), "notes": [_note(n) for n in notes], "review": _review(review),
                    "followed_authors": [a.author for a in authors], "shelves": [{"id": s.id, "name": s.name} for s in shelves],
                    "comments": [_public_text(row, name) for row, name in comments],
                    "reviews": [_public_text(row, name) for row, name in reviews]})


@reader_bp.put("/reader/books/<int:book_id>/progress")
@_endpoint(write=True)
def update_progress(db, user_id, book_id):
    _book(db, book_id)
    data = _data()
    page, total = data.get("current_page"), data.get("total_pages")
    if (page is None) != (total is None):
        raise ReaderError("current_page and total_pages must be provided together")
    if page is not None:
        _integer(total, "total_pages")
        _integer(page, "current_page", minimum=0, maximum=total)
    percent = data.get("percent", page / total * 100 if total else None)
    if type(percent) not in (int, float) or not 0 <= percent <= 100 or not math.isfinite(percent):
        raise ReaderError("percent must be a finite number between 0 and 100")
    if total and (abs(percent - page / total * 100) > 0.5 or (percent == 100) != (page == total)):
        raise ReaderError("percent must agree with current_page / total_pages (within 0.5 percentage points)")
    row = db.query(ReadingProgress).filter_by(user_id=user_id, book_id=book_id).first()
    if row is None:
        row = ReadingProgress(user_id=user_id, book_id=book_id)
        db.add(row)
    row.percent, row.current_page, row.total_pages, row.updated_at = percent, page, total, utcnow()
    item = db.query(ReadingListItem).filter_by(user_id=user_id, book_id=book_id).first()
    if item is None:
        item = ReadingListItem(user_id=user_id, book_id=book_id)
        db.add(item)
    item.status = "read" if percent == 100 else "currently_reading"
    return jsonify({"progress": _progress(row), "status": item.status})


@reader_bp.get("/reader/progress")
@_endpoint()
def get_progress(db, user_id):
    rows = db.query(ReadingProgress, Book).join(Book, Book.book_id == ReadingProgress.book_id).filter(
        ReadingProgress.user_id == user_id).order_by(ReadingProgress.updated_at.desc()).all()
    return jsonify({"progress": [{"book": _catalog(book), **_progress(row), "updated_at": _iso(row.updated_at)} for row, book in rows]})


@reader_bp.post("/reader/books/<int:book_id>/notes")
@_endpoint(write=True)
def create_note(db, user_id, book_id):
    _book(db, book_id)
    data = _data()
    kind = data.get("kind")
    if kind not in ("note", "quote"):
        raise ReaderError("kind must be note or quote")
    page = data.get("page")
    if page is not None:
        _integer(page, "page")
    row = ReaderNote(user_id=user_id, book_id=book_id, kind=kind, text=_text(data), page=page)
    db.add(row)
    db.flush()
    return jsonify({"note": _note(row)}), 201


@reader_bp.delete("/reader/notes/<int:note_id>")
@_endpoint(write=True)
def delete_note(db, user_id, note_id):
    db.delete(_owned(db, ReaderNote, note_id, user_id))
    return jsonify({"success": True})


@reader_bp.put("/reader/books/<int:book_id>/review")
@_endpoint(write=True)
def save_review(db, user_id, book_id):
    _book(db, book_id)
    data = _data()
    visibility = data.get("visibility", "private")
    if visibility not in ("private", "public"):
        raise ReaderError("visibility must be private or public")
    text = _text(data, maximum=10000)
    row = db.query(ReaderReview).filter_by(user_id=user_id, book_id=book_id).first()
    if row is None:
        row = ReaderReview(user_id=user_id, book_id=book_id)
        db.add(row)
    row.text, row.visibility, row.updated_at = text, visibility, utcnow()
    db.flush()
    return jsonify({"review": _review(row)})


@reader_bp.delete("/reader/books/<int:book_id>/review")
@_endpoint(write=True)
def delete_review(db, user_id, book_id):
    row = db.query(ReaderReview).filter_by(user_id=user_id, book_id=book_id).first()
    if row is None:
        _missing()
    db.delete(row)
    return jsonify({"success": True})


@reader_bp.post("/reader/books/<int:book_id>/comments")
@_endpoint(write=True)
def create_comment(db, user_id, book_id):
    _book(db, book_id)
    row = ReaderComment(user_id=user_id, book_id=book_id, text=_text(_data(), maximum=2000))
    db.add(row)
    db.flush()
    return jsonify({"comment": _public_text(row, current_user().username)}), 201


@reader_bp.delete("/reader/comments/<int:comment_id>")
@_endpoint(write=True)
def delete_comment(db, user_id, comment_id):
    db.delete(_owned(db, ReaderComment, comment_id, user_id))
    return jsonify({"success": True})


@reader_bp.get("/reader/shelves")
@_endpoint()
def get_shelves(db, user_id):
    rows = db.query(ReaderShelf).filter_by(user_id=user_id).order_by(ReaderShelf.name).all()
    return jsonify({"shelves": [_shelf(db, row) for row in rows]})


@reader_bp.post("/reader/shelves")
@_endpoint(write=True)
def create_shelf(db, user_id):
    name = _text(_data(), "name", 100)
    row = ReaderShelf(user_id=user_id, name=name, name_key=_key(name))
    db.add(row)
    db.flush()
    return jsonify({"shelf": _shelf(db, row)}), 201


@reader_bp.patch("/reader/shelves/<int:shelf_id>")
@_endpoint(write=True)
def rename_shelf(db, user_id, shelf_id):
    row = _owned(db, ReaderShelf, shelf_id, user_id)
    row.name = _text(_data(), "name", 100)
    row.name_key = _key(row.name)
    db.flush()
    return jsonify({"shelf": _shelf(db, row)})


@reader_bp.delete("/reader/shelves/<int:shelf_id>")
@_endpoint(write=True)
def delete_shelf(db, user_id, shelf_id):
    row = _owned(db, ReaderShelf, shelf_id, user_id)
    db.query(ReaderShelfBook).filter_by(shelf_id=row.id).delete(synchronize_session=False)
    db.delete(row)
    return jsonify({"success": True})


@reader_bp.route("/reader/shelves/<int:shelf_id>/books/<int:book_id>", methods=["PUT", "DELETE"])
@_endpoint(write=True)
def shelf_book(db, user_id, shelf_id, book_id):
    shelf = _owned(db, ReaderShelf, shelf_id, user_id)
    _book(db, book_id)
    row = db.get(ReaderShelfBook, (shelf_id, book_id))
    if request.method == "PUT" and row is None:
        db.add(ReaderShelfBook(shelf_id=shelf_id, book_id=book_id))
    elif request.method == "DELETE" and row is not None:
        db.delete(row)
    db.flush()
    return jsonify({"shelf": _shelf(db, shelf)})


@reader_bp.get("/reader/authors")
@_endpoint()
def get_authors(db, user_id):
    rows = db.query(FollowedAuthor).filter_by(user_id=user_id).order_by(FollowedAuthor.author).all()
    return jsonify({"authors": [row.author for row in rows]})


@reader_bp.route("/reader/authors", methods=["POST", "DELETE"])
@_endpoint(write=True)
def follow_author(db, user_id):
    author = _text(_data(), "author", 200)
    row = db.query(FollowedAuthor).filter_by(user_id=user_id, author_key=_key(author)).first()
    if request.method == "POST" and row is None:
        db.add(FollowedAuthor(user_id=user_id, author=author, author_key=_key(author)))
    elif request.method == "DELETE" and row is not None:
        db.delete(row)
    db.flush()
    rows = db.query(FollowedAuthor).filter_by(user_id=user_id).order_by(FollowedAuthor.author).all()
    return jsonify({"authors": [row.author for row in rows]})


@reader_bp.get("/reader/lists")
@_endpoint()
def get_lists(db, user_id):
    rows = db.query(ReaderList).filter_by(user_id=user_id).order_by(ReaderList.id.desc()).all()
    return jsonify({"lists": [_list(db, row) for row in rows]})


@reader_bp.post("/reader/lists")
@_endpoint(write=True)
def create_list(db, user_id):
    data = _data()
    title = _text(data, "title", 100)
    ids = data.get("book_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_BOOKS:
        raise ReaderError(f"book_ids must contain 1–{MAX_BOOKS} book IDs")
    for book_id in ids:
        _integer(book_id, "book_id", maximum=2147483647)
    if len(ids) != len(set(ids)):
        raise ReaderError("book_ids must not contain duplicates")
    if db.query(Book).filter(Book.book_id.in_(ids)).count() != len(ids):
        _missing()
    row = ReaderList(user_id=user_id, title=title, title_key=_key(title))
    db.add(row)
    db.flush()
    db.add_all([ReaderListBook(list_id=row.id, book_id=book_id, position=index) for index, book_id in enumerate(ids)])
    db.flush()
    return jsonify(_list(db, row)), 201


@reader_bp.route("/reader/lists/<int:list_id>/share", methods=["POST", "DELETE"])
@_endpoint(write=True)
def share_list(db, user_id, list_id):
    row = _owned(db, ReaderList, list_id, user_id)
    if request.method == "POST":
        # An explicit publication produces a fresh, 256-bit bearer capability.
        row.share_token = secrets.token_urlsafe(32)
    else:
        row.share_token = None
    db.flush()
    return jsonify({"share_token": row.share_token})


@reader_bp.delete("/reader/lists/<int:list_id>")
@_endpoint(write=True)
def delete_list(db, user_id, list_id):
    row = _owned(db, ReaderList, list_id, user_id)
    db.query(ReaderListBook).filter_by(list_id=row.id).delete(synchronize_session=False)
    db.delete(row)
    return jsonify({"success": True})


@reader_bp.get("/reader/shared/<token>")
@_endpoint(public=True)
def shared_list(db, user_id, token):
    if len(token) != 43:
        _missing()
    row = db.query(ReaderList).filter_by(share_token=token).first()
    if row is None:
        _missing()
    books = db.query(Book).join(ReaderListBook, ReaderListBook.book_id == Book.book_id).filter(
        ReaderListBook.list_id == row.id).order_by(ReaderListBook.position).all()
    return jsonify({"title": row.title, "books": [_catalog(book) for book in books]})
