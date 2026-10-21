"""Authentication helpers for the BookWise API.

The API uses short-lived, signed bearer tokens so it does not need server-side
session storage. Passwords are hashed with Werkzeug's PBKDF2 implementation.
"""

from functools import wraps

from flask import current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from .database import SessionLocal
from .models.database_models import User


def hash_password(password):
    return generate_password_hash(password)


def verify_password(password_hash, password):
    return bool(password_hash) and check_password_hash(password_hash, password)


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="bookwise-auth")


def create_access_token(user):
    return _serializer().dumps({"sub": user.id, "username": user.username})


def _token_user():
    authorization = request.headers.get("Authorization", "")
    if authorization:
        if not authorization.startswith("Bearer "):
            return None
        token = authorization[7:].strip()
    else:
        token = request.cookies.get(current_app.config["AUTH_COOKIE_NAME"], "").strip()
    if not token:
        return None

    try:
        payload = _serializer().loads(
            token, max_age=current_app.config["AUTH_TOKEN_MAX_AGE"]
        )
    except (BadSignature, SignatureExpired, TypeError, ValueError):
        return None

    db = SessionLocal()
    try:
        return db.query(User).filter(User.id == payload.get("sub")).first()
    finally:
        db.close()


def current_user():
    if not hasattr(g, "bookwise_user"):
        g.bookwise_user = _token_user()
    return g.bookwise_user


def auth_error(message="Authentication required", code="authentication_required", status=401):
    return jsonify({"error": {"code": code, "message": message}}), status


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return auth_error()
        g.bookwise_user = user
        return view(*args, **kwargs)

    return wrapped


def require_owner(user_id):
    user = current_user()
    if user is None:
        return auth_error()
    if int(user.id) != int(user_id):
        return auth_error(
            "You may only access your own library",
            code="forbidden",
            status=403,
        )
    return None


def set_auth_cookie(response, token):
    response.set_cookie(
        current_app.config["AUTH_COOKIE_NAME"],
        token,
        max_age=current_app.config["AUTH_TOKEN_MAX_AGE"],
        httponly=current_app.config["AUTH_COOKIE_HTTPONLY"],
        secure=current_app.config["AUTH_COOKIE_SECURE"],
        samesite=current_app.config["AUTH_COOKIE_SAMESITE"],
    )
    return response


def clear_auth_cookie(response):
    response.delete_cookie(
        current_app.config["AUTH_COOKIE_NAME"],
        httponly=current_app.config["AUTH_COOKIE_HTTPONLY"],
        secure=current_app.config["AUTH_COOKIE_SECURE"],
        samesite=current_app.config["AUTH_COOKIE_SAMESITE"],
    )
    return response
