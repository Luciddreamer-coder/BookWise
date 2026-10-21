"""Authenticated discovery endpoints. Register with url_prefix='/api'."""
import json
import math
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.exc import IntegrityError

from ..auth import current_user, require_auth
from ..database import SessionLocal
from ..models.database_models import Book
from ..models.discovery_models import DiscoveryEvent, DiscoveryPreference, RecommendationExposure
from ..rate_limit import rate_limit
from ..recommender.personalization import (
    CAPABILITIES, MINIMUM_OBSERVATIONS, MODES, choose_alpha, experiment_summary,
    preferences_for, rank_feed, validate_preferences,
)

discovery_bp = Blueprint("discovery", __name__)
EVENT_TYPES = {"impression", "click", "like", "not_interested", "more_like_this", "less_like_this", "save", "skip", "rating"}


@discovery_bp.record_once
def configure_defaults(state):
    for name, value in {
        "DISCOVERY_ENABLED": True,
        "DISCOVERY_ENABLED_MODES": sorted(MODES),
        "DISCOVERY_EXPERIMENTS_ENABLED": True,
        "DISCOVERY_MIN_OBSERVATIONS": MINIMUM_OBSERVATIONS,
        "RATE_LIMIT_DISCOVERY_FEED_MAX": 30,
        "RATE_LIMIT_DISCOVERY_EVENTS_MAX": 120,
        "RATE_LIMIT_DISCOVERY_PREFERENCES_MAX": 30,
    }.items():
        state.app.config.setdefault(name, value)


def error(message, status=400, code="validation_error"):
    return jsonify({"error": {"code": code, "message": message}}), status


@discovery_bp.before_request
def check_enabled():
    if not current_app.config.get("DISCOVERY_ENABLED", True):
        return error("Discovery is disabled", 404, "feature_disabled")


@discovery_bp.route("/discovery/preferences", methods=["GET", "PUT"])
@require_auth
@rate_limit("discovery_preferences")
def preferences():
    db = SessionLocal()
    try:
        user_id = current_user().id
        settings = preferences_for(db, user_id)
        if request.method == "PUT":
            payload = request.get_json(silent=True)
            if isinstance(payload, dict) and set(payload) == {"preferences"}:
                payload = payload["preferences"]
            try:
                settings = validate_preferences(payload, settings)
            except ValueError as exc:
                return error(str(exc))
            row = db.get(DiscoveryPreference, user_id)
            if row is None:
                row = DiscoveryPreference(user_id=user_id)
                db.add(row)
            row.settings = json.dumps(settings, allow_nan=False)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                return error("Preferences changed in another request. Refresh and try again.", 409, "conflict")
        return jsonify({"preferences": settings, "capabilities": CAPABILITIES})
    finally:
        db.close()


def query_integer(name, default, minimum, maximum):
    raw = request.args.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an integer") from None
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@discovery_bp.route("/discovery/feed", methods=["GET"])
@require_auth
@rate_limit("discovery_feed")
def feed():
    try:
        if set(request.args) - {"mode", "offset", "limit", "anchor_book_id"}:
            raise ValueError("Unsupported feed parameter")
        mode = request.args.get("mode", "for_you")
        if mode not in MODES:
            raise ValueError("Invalid discovery mode")
        if mode not in current_app.config.get("DISCOVERY_ENABLED_MODES", MODES):
            return error("This discovery mode is disabled", 404, "feature_disabled")
        offset = query_integer("offset", 0, 0, 500)
        limit = query_integer("limit", 12, 1, 50)
        anchor = query_integer("anchor_book_id", None, 1, 2_147_483_647)
        if anchor is not None and mode != "because_you_rated":
            raise ValueError("anchor_book_id is only valid for because_you_rated")
    except ValueError as exc:
        return error(str(exc))
    db = SessionLocal()
    try:
        user_id = current_user().id
        settings = preferences_for(db, user_id)
        alpha, source, variant, alpha_notice = choose_alpha(db, user_id, settings, current_app.config)
        try:
            ranked, profile, notice = rank_feed(db, user_id, settings, alpha, mode, anchor)
        except ValueError as exc:
            return error(str(exc))
        request_id, results = str(uuid4()), []
        for item in ranked[offset:offset + limit]:
            book = item["book"]
            exposure_id = str(uuid4())
            db.add(RecommendationExposure(id=exposure_id, request_id=request_id, user_id=user_id,
                book_id=book.book_id, mode=mode, variant=variant, alpha=alpha, alpha_source=source))
            results.append({**book.to_dict(), "exposure_id": exposure_id,
                "explanation": item["reasons"][0]["text"], "reasons": item["reasons"],
                "scores": {"ranking": round(item["score"], 5), "content": round(item["content"], 5),
                           "collaborative": round(item["collaborative"], 5),
                           "collaborative_confidence": round(item["collaborative_confidence"], 5),
                           "popularity": round(item["popularity"], 5)}})
        db.commit()
        return jsonify({"recommendations": results, "has_more": offset + limit < len(ranked),
            "offset": offset, "request_id": request_id, "alpha": alpha, "alpha_source": source,
            "ratings_count": len(profile["rated_ids"]), "is_cold_start": len(profile["rated_ids"]) < 3,
            "collaborative_available": bool(profile["collaborative"]), "alpha_semantics": "collaborative_weight",
            "notice": " ".join(text for text in (notice, alpha_notice) if text), "capabilities": CAPABILITIES})
    finally:
        db.close()


@discovery_bp.route("/discovery/events", methods=["POST"])
@require_auth
@rate_limit("discovery_events")
def events():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) - {"book_id", "event_type", "exposure_id", "value"}:
        return error("Expected an event object with supported fields")
    book_id, event_type = payload.get("book_id"), payload.get("event_type")
    if isinstance(book_id, bool) or not isinstance(book_id, int) or not 1 <= book_id <= 2_147_483_647:
        return error("book_id must be a positive integer")
    if not isinstance(event_type, str) or event_type not in EVENT_TYPES:
        return error("Invalid event_type")
    value = payload.get("value")
    if "value" in payload and (isinstance(value, bool) or not isinstance(value, (int, float)) or not -10 <= value <= 10 or not math.isfinite(value)):
        return error("value must be a finite number between -10 and 10")
    if event_type == "rating" and (value is None or not 1 <= value <= 5):
        return error("rating events require a value between 1 and 5")
    exposure_id = payload.get("exposure_id")
    if "exposure_id" in payload and (not isinstance(exposure_id, str) or not 1 <= len(exposure_id) <= 36):
        return error("exposure_id must be a nonempty string of at most 36 characters")
    db = SessionLocal()
    try:
        user_id = current_user().id
        if db.get(Book, book_id) is None:
            return error("Book not found", 404, "not_found")
        if exposure_id is not None:
            exposure = db.query(RecommendationExposure).filter_by(id=exposure_id, user_id=user_id, book_id=book_id).first()
            if exposure is None:
                return error("Exposure not found for this reader and book", 404, "not_found")
            if db.query(DiscoveryEvent.id).filter_by(exposure_id=exposure_id, event_type=event_type).first():
                return jsonify({"success": True})
        db.add(DiscoveryEvent(user_id=user_id, book_id=book_id, event_type=event_type, exposure_id=exposure_id, value=value))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Only the same exposure/event uniqueness race is idempotent.
            if not exposure_id or not db.query(DiscoveryEvent.id).filter_by(exposure_id=exposure_id, event_type=event_type, user_id=user_id).first():
                raise
        return jsonify({"success": True})
    finally:
        db.close()


@discovery_bp.route("/discovery/experiments", methods=["GET"])
@require_auth
def experiments():
    if request.args:
        return error("Experiments are scoped to the signed-in reader; no parameters are supported")
    db = SessionLocal()
    try:
        return jsonify(experiment_summary(db, current_user().id,
            max(10, int(current_app.config.get("DISCOVERY_MIN_OBSERVATIONS", MINIMUM_OBSERVATIONS))),
            current_app.config.get("DISCOVERY_EXPERIMENTS_ENABLED", True)))
    finally:
        db.close()
