from flask import Blueprint, request, jsonify
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash
from ..database import SessionLocal
from ..models.database_models import User, Rating, Favorite, ReadingListItem, Book, FeedbackEvent
from ..recommender.history import invalidate_user_history_cache
from ..auth import create_access_token, clear_auth_cookie, current_user, hash_password, require_auth, require_owner, set_auth_cookie
from ..rate_limit import rate_limit

users_bp = Blueprint("users", __name__)


def _record_feedback(db, user_id, book_id, event_type, value=None):
    db.add(FeedbackEvent(
        user_id=int(user_id),
        book_id=int(book_id),
        event_type=event_type,
        value=float(value) if value is not None else None,
    ))

@users_bp.route("/users", methods=["GET"])
def list_users():
    """List public account identifiers for the existing profile picker."""
    db = SessionLocal()
    try:
        users = db.query(User).all()
        result = []
        for u in users:
            ratings_count = db.query(Rating).filter(Rating.user_id == u.id).count()
            favs_count = db.query(Favorite).filter(Favorite.user_id == u.id).count()
            read_count = db.query(ReadingListItem).filter(ReadingListItem.user_id == u.id).count()
            
            u_dict = {"id": u.id, "username": u.username}
            u_dict.update({
                "ratings_count": ratings_count,
                "favorites_count": favs_count,
                "reading_list_count": read_count,
                "persona": f"Reader {u.username}",
                "avatar": "📖"
            })
            result.append(u_dict)
        return jsonify({"users": result})
    finally:
        db.close()


@users_bp.route("/auth/register", methods=["POST"])
@rate_limit("register")
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower() or None
    password = data.get("password")
    if not username or not isinstance(password, str):
        return jsonify({"error": {"code": "validation_error", "message": "username and password are required"}}), 400
    if len(username) > 100 or len(password) < 8:
        return jsonify({"error": {"code": "validation_error", "message": "username must be <= 100 characters and password must be at least 8 characters"}}), 400

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            return jsonify({"error": {"code": "conflict", "message": "Username is already registered"}}), 409
        if email and db.query(User).filter(User.email == email).first():
            return jsonify({"error": {"code": "conflict", "message": "Email is already registered"}}), 409
        user = User(username=username, email=email, password_hash=hash_password(password))
        db.add(user)
        db.commit()
        token = create_access_token(user)
        response = jsonify({"user": user.to_dict(), "token": token})
        set_auth_cookie(response, token)
        return response, 201
    except IntegrityError:
        db.rollback()
        return jsonify({"error": {"code": "conflict", "message": "Username or email is already registered"}}), 409
    finally:
        db.close()


@users_bp.route("/auth/login", methods=["POST"])
@rate_limit("login")
def login():
    data = request.get_json(silent=True) or {}
    identifier = str(data.get("username", data.get("email", ""))).strip()
    password = data.get("password")
    db = SessionLocal()
    try:
        user = db.query(User).filter((User.username == identifier) | (User.email == identifier.lower())).first()
        if not user or not password or not user.password_hash or not check_password_hash(user.password_hash, password):
            return jsonify({"error": {"code": "invalid_credentials", "message": "Invalid username or password"}}), 401
        token = create_access_token(user)
        response = jsonify({"user": user.to_dict(), "token": token})
        set_auth_cookie(response, token)
        return response
    finally:
        db.close()


@users_bp.route("/auth/me", methods=["GET"])
@require_auth
def auth_me():
    return jsonify({"user": current_user().to_dict()})


@users_bp.route("/auth/logout", methods=["POST"])
def logout():
    response = jsonify({"success": True})
    return clear_auth_cookie(response)

@users_bp.route("/users/<int:user_id>", methods=["GET"])
def get_user_profile(user_id):
    """Retrieve full profile for a user."""
    db = SessionLocal()
    try:
        owner_error = require_owner(user_id)
        if owner_error:
            return owner_error
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return jsonify({"error": {"code": "not_found", "message": "User not found"}}), 404
            
        ratings_count = db.query(Rating).filter(Rating.user_id == user.id).count()
        favs_count = db.query(Favorite).filter(Favorite.user_id == user.id).count()
        read_count = db.query(ReadingListItem).filter(ReadingListItem.user_id == user.id).count()
        
        data = user.to_dict()
        data["ratings_count"] = ratings_count
        data["favorites_count"] = favs_count
        data["reading_list_count"] = read_count
        return jsonify(data)
    finally:
        db.close()

@users_bp.route("/users/<int:user_id>/ratings", methods=["GET"])
def get_user_ratings(user_id):
    """Get all books rated by a user."""
    db = SessionLocal()
    try:
        owner_error = require_owner(user_id)
        if owner_error:
            return owner_error
        if not db.query(User).filter(User.id == user_id).first():
            return jsonify({"error": {"code": "not_found", "message": "User not found"}}), 404
        ratings = db.query(Rating).filter(Rating.user_id == user_id).order_by(Rating.timestamp.desc()).all()
        return jsonify({
            "user_id": user_id,
            "count": len(ratings),
            "ratings": [r.to_dict() for r in ratings]
        })
    finally:
        db.close()

@users_bp.route("/ratings", methods=["POST"])
@rate_limit("rating")
def save_rating():
    """Save or update a rating for a book."""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    book_id = data.get("book_id")
    rating_val = data.get("rating")
    
    user = current_user()
    if user is None:
        return jsonify({"error": {"code": "authentication_required", "message": "Authentication required"}}), 401
    if user_id is not None and str(user_id) != str(user.id):
        return jsonify({"error": {"code": "forbidden", "message": "user_id must match the authenticated user"}}), 403
    user_id = user.id
    if not book_id or rating_val is None:
        return jsonify({"error": {"code": "validation_error", "message": "book_id and rating are required"}}), 400
        
    try:
        rating_val = float(rating_val)
        if not (1.0 <= rating_val <= 5.0):
            return jsonify({"error": {"code": "validation_error", "message": "Rating must be between 1.0 and 5.0"}}), 400
    except (TypeError, ValueError):
        return jsonify({"error": {"code": "validation_error", "message": "Invalid rating value"}}), 400
        
    db = SessionLocal()
    try:
        if not db.query(Book).filter(Book.book_id == book_id).first():
            return jsonify({"error": {"code": "not_found", "message": "Book not found"}}), 404
            
        # Check if existing rating
        existing = db.query(Rating).filter(Rating.user_id == user_id, Rating.book_id == book_id).first()
        if existing:
            existing.rating = rating_val
        else:
            new_rating = Rating(user_id=user_id, book_id=book_id, rating=rating_val)
            db.add(new_rating)
            
        db.commit()
        _record_feedback(db, user_id, book_id, "rating", rating_val)
        db.commit()
        invalidate_user_history_cache(user_id)
        return jsonify({"success": True, "user_id": user_id, "book_id": book_id, "rating": rating_val})
    except Exception as e:
        db.rollback()
        return jsonify({"error": {"code": "internal_server_error", "message": "Could not save rating"}}), 500
    finally:
        db.close()

@users_bp.route("/users/<int:user_id>/favorites", methods=["GET"])
def get_user_favorites(user_id):
    """Retrieve all favorited books for a user."""
    db = SessionLocal()
    try:
        owner_error = require_owner(user_id)
        if owner_error:
            return owner_error
        if not db.query(User).filter(User.id == user_id).first():
            return jsonify({"error": {"code": "not_found", "message": "User not found"}}), 404
        favorites = db.query(Favorite).filter(Favorite.user_id == user_id).order_by(Favorite.created_at.desc()).all()
        return jsonify({
            "user_id": user_id,
            "count": len(favorites),
            "favorites": [f.to_dict() for f in favorites]
        })
    finally:
        db.close()

@users_bp.route("/favorites", methods=["POST"])
def toggle_favorite():
    """Toggle a book in user's favorites list."""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    book_id = data.get("book_id")
    
    user = current_user()
    if user is None:
        return jsonify({"error": {"code": "authentication_required", "message": "Authentication required"}}), 401
    if user_id is not None and str(user_id) != str(user.id):
        return jsonify({"error": {"code": "forbidden", "message": "user_id must match the authenticated user"}}), 403
    user_id = user.id
    if not book_id:
        return jsonify({"error": {"code": "validation_error", "message": "book_id is required"}}), 400
        
    db = SessionLocal()
    try:
        if not db.query(Book).filter(Book.book_id == book_id).first():
            return jsonify({"error": {"code": "not_found", "message": "Book not found"}}), 404
        existing = db.query(Favorite).filter(Favorite.user_id == user_id, Favorite.book_id == book_id).first()
        if existing:
            db.delete(existing)
            db.commit()
            return jsonify({"is_favorite": False, "message": "Removed from favorites"})
        else:
            fav = Favorite(user_id=user_id, book_id=book_id)
            db.add(fav)
            db.commit()
            _record_feedback(db, user_id, book_id, "save")
            db.commit()
            return jsonify({"is_favorite": True, "message": "Added to favorites"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": {"code": "internal_server_error", "message": "Could not update favorites"}}), 500
    finally:
        db.close()


@users_bp.route("/feedback", methods=["POST"])
@rate_limit("feedback")
def record_feedback():
    """Record click/save/rating signals for future ranking refreshes."""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    book_id = data.get("book_id")
    event_type = data.get("event_type", data.get("event"))
    user = current_user()
    if user is None:
        return jsonify({"error": {"code": "authentication_required", "message": "Authentication required"}}), 401
    if user_id is not None and str(user_id) != str(user.id):
        return jsonify({"error": {"code": "forbidden", "message": "user_id must match the authenticated user"}}), 403
    user_id = user.id
    if book_id is None or event_type not in {"click", "save", "rating"}:
        return jsonify({"error": {"code": "validation_error", "message": "book_id and event_type (click, save, rating) are required"}}), 400
    try:
        book_id = int(book_id)
        value = float(data["value"]) if data.get("value") is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": {"code": "validation_error", "message": "book_id must be an integer; value must be numeric"}}), 400
    if event_type == "rating" and (value is None or not 1.0 <= value <= 5.0):
        return jsonify({"error": {"code": "validation_error", "message": "rating feedback value must be between 1.0 and 5.0"}}), 400

    db = SessionLocal()
    try:
        if not db.query(Book).filter(Book.book_id == book_id).first():
            return jsonify({"error": {"code": "not_found", "message": "Book not found"}}), 404
        _record_feedback(db, user_id, book_id, event_type, value)
        db.commit()
        return jsonify({"success": True, "user_id": user_id, "book_id": book_id, "event_type": event_type, "value": value})
    except Exception as e:
        db.rollback()
        return jsonify({"error": {"code": "internal_server_error", "message": "Could not record feedback"}}), 500
    finally:
        db.close()


@users_bp.route("/users/<int:user_id>/feedback", methods=["GET"])
def get_user_feedback(user_id):
    db = SessionLocal()
    try:
        owner_error = require_owner(user_id)
        if owner_error:
            return owner_error
        if not db.query(User).filter(User.id == user_id).first():
            return jsonify({"error": {"code": "not_found", "message": "User not found"}}), 404
        events = db.query(FeedbackEvent).filter(FeedbackEvent.user_id == user_id).order_by(FeedbackEvent.created_at.desc()).all()
        return jsonify({"user_id": user_id, "count": len(events), "feedback": [event.to_dict() for event in events]})
    finally:
        db.close()

@users_bp.route("/users/<int:user_id>/reading-list", methods=["GET"])
def get_user_reading_list(user_id):
    """Retrieve reading list items for a user, optionally filtered by status."""
    status = request.args.get("status")
    allowed_statuses = {"want_to_read", "currently_reading", "read"}
    if status and status not in allowed_statuses:
        return jsonify({"error": {"code": "validation_error", "message": "Invalid reading-list status"}}), 400
    db = SessionLocal()
    try:
        owner_error = require_owner(user_id)
        if owner_error:
            return owner_error
        if not db.query(User).filter(User.id == user_id).first():
            return jsonify({"error": {"code": "not_found", "message": "User not found"}}), 404
        query = db.query(ReadingListItem).filter(ReadingListItem.user_id == user_id)
        if status:
            query = query.filter(ReadingListItem.status == status)
        items = query.order_by(ReadingListItem.added_at.desc()).all()
        return jsonify({
            "user_id": user_id,
            "count": len(items),
            "reading_list": [i.to_dict() for i in items]
        })
    finally:
        db.close()

@users_bp.route("/reading-list", methods=["POST"])
def update_reading_list():
    """Add or update reading list status: 'want_to_read', 'currently_reading', 'read', or 'remove'."""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    book_id = data.get("book_id")
    status = data.get("status", "want_to_read")
    
    user = current_user()
    if user is None:
        return jsonify({"error": {"code": "authentication_required", "message": "Authentication required"}}), 401
    if user_id is not None and str(user_id) != str(user.id):
        return jsonify({"error": {"code": "forbidden", "message": "user_id must match the authenticated user"}}), 403
    user_id = user.id
    if not book_id:
        return jsonify({"error": {"code": "validation_error", "message": "book_id is required"}}), 400
    if status not in {"want_to_read", "currently_reading", "read", "remove"}:
        return jsonify({"error": {"code": "validation_error", "message": "Invalid reading-list status"}}), 400
        
    db = SessionLocal()
    try:
        if not db.query(Book).filter(Book.book_id == book_id).first():
            return jsonify({"error": {"code": "not_found", "message": "Book not found"}}), 404
        existing = db.query(ReadingListItem).filter(
            ReadingListItem.user_id == user_id,
            ReadingListItem.book_id == book_id
        ).first()
        
        if status == "remove":
            if existing:
                db.delete(existing)
                db.commit()
            return jsonify({"status": None, "message": "Removed from reading list"})
            
        if existing:
            existing.status = status
        else:
            item = ReadingListItem(user_id=user_id, book_id=book_id, status=status)
            db.add(item)
            
        db.commit()
        return jsonify({"success": True, "user_id": user_id, "book_id": book_id, "status": status})
    except Exception as e:
        db.rollback()
        return jsonify({"error": {"code": "internal_server_error", "message": "Could not update reading list"}}), 500
    finally:
        db.close()
