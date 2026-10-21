import os
import json
import threading
from functools import lru_cache
import pandas as pd
from flask import Blueprint, request, jsonify
from ..database import SessionLocal
from ..models.database_models import Rating, Book
from ..recommender.popularity import PopularityRecommender
from ..recommender.content_based import ContentBasedRecommender
from ..recommender.collaborative import CollaborativeRecommender
from ..recommender.hybrid import HybridRecommender
from ..config import Config
from ..recommender.history import get_cached_user_history, history_cache_info, invalidate_user_history_cache
from ..auth import current_user, require_auth, require_owner

recommendations_bp = Blueprint("recommendations", __name__)

popularity_model = PopularityRecommender()
content_model = ContentBasedRecommender()
collaborative_model = CollaborativeRecommender()
hybrid_model = HybridRecommender()
_model_lock = threading.RLock()


@lru_cache(maxsize=128)
def _cached_popular_recommendations(filter_type, n, genre):
    if filter_type == "gems":
        results = popularity_model.get_hidden_gems(n=n)
    elif filter_type == "trending":
        results = popularity_model.get_trending(n=n)
    else:
        results = popularity_model.get_top_n(n=n, genre=genre)
    return tuple(dict(item) for item in results)


def _query_int(name, default, minimum, maximum):
    raw = request.args.get(name)
    if raw is None:
        return default, None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None, (jsonify({"error": {"code": "validation_error", "message": f"{name} must be an integer"}}), 400)
    if not minimum <= value <= maximum:
        return None, (jsonify({"error": {"code": "validation_error", "message": f"{name} must be between {minimum} and {maximum}"}}), 400)
    return value, None


def _query_float(name, default, minimum, maximum):
    raw = request.args.get(name)
    if raw is None:
        return default, None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None, (jsonify({"error": {"code": "validation_error", "message": f"{name} must be a number"}}), 400)
    if not minimum <= value <= maximum:
        return None, (jsonify({"error": {"code": "validation_error", "message": f"{name} must be between {minimum} and {maximum}"}}), 400)
    return value, None


def _load_user_ratings(db, user_id):
    rows = db.query(Rating).filter(Rating.user_id == user_id).all()
    if rows:
        return [{"book_id": r.book_id, "rating": float(r.rating)} for r in rows]
    return get_cached_user_history(user_id)

@recommendations_bp.route("/recommendations/popular", methods=["GET"])
def get_popular():
    """Retrieve top books by weighted rating (Model 1 Baseline)."""
    n, error = _query_int("n", 12, 1, 50)
    if error:
        return error
    genre = request.args.get("genre", None)
    filter_type = request.args.get("type", "popular")  # popular, trending, gems
    if filter_type not in {"popular", "trending", "gems"}:
        return jsonify({"error": {"code": "validation_error", "message": "type must be one of: popular, trending, gems"}}), 400
    
    results = [dict(item) for item in _cached_popular_recommendations(filter_type, n, genre)]
        
    return jsonify({
        "type": filter_type,
        "genre": genre or "all",
        "count": len(results),
        "recommendations": results
    })

@recommendations_bp.route("/recommendations/user/<int:user_id>", methods=["GET"])
def get_user_recommendations(user_id):
    """Retrieve personalized recommendations for a user via the Hybrid Engine (Model 4)."""
    n, error = _query_int("n", 30, 1, 50)
    if error:
        return error
    alpha_param = request.args.get("alpha", None)
    genre_filter = request.args.get("genre", None)
    alpha, error = _query_float("alpha", 0.55, 0.0, 1.0)
    if error:
        return error
    owner_error = require_owner(user_id)
    if owner_error:
        return owner_error
    
    db = SessionLocal()
    try:
        # 1. Fetch user's ratings from database
        user_ratings_list = _load_user_ratings(db, user_id)
                    
        # 3. Generate hybrid recommendations
        with _model_lock:
            recs = hybrid_model.recommend(
                user_id=user_id,
                user_ratings=user_ratings_list,
                n=n,
                alpha=alpha,
                genre_filter=genre_filter
            )
        
        return jsonify({
            "user_id": user_id,
            "ratings_count": len(user_ratings_list),
            "alpha": alpha,
            "genre_filter": genre_filter or "all",
            "is_cold_start": len(user_ratings_list) < 3,
            "count": len(recs),
            "recommendations": recs
        })
    finally:
        db.close()

@recommendations_bp.route("/recommendations/compare", methods=["GET"])
@require_auth
def compare_models():
    """Side-by-side comparison of all 4 recommendation approaches."""
    _legacy_user_id, error = _query_int("user_id", None, 1, 10_000_000)
    if error:
        return error
    book_id, error = _query_int("book_id", 1, 1, 10_000_000)
    if error:
        return error
    n, error = _query_int("n", 5, 1, 20)
    if error:
        return error

    # The token is authoritative.  Ignore a legacy/client-supplied user_id so
    # stale dashboard state cannot cause a false 403 or select another account.
    user_id = int(current_user().id)

    with _model_lock:
        comparison = hybrid_model.compare_models(user_id=user_id, book_id=book_id, n=n)
    return jsonify(comparison)


@recommendations_bp.route("/recommendations/cache", methods=["GET"])
def get_recommendation_cache_info():
    """Expose lightweight cache diagnostics for deterministic operational tests."""
    return jsonify({
        "history": history_cache_info(),
        "models_cached": True,
        "popular_cache_entries": _cached_popular_recommendations.cache_info().currsize,
    })


@recommendations_bp.route("/recommendations/retrain", methods=["POST"])
@require_auth
def retrain_recommender():
    """Retrain collaborative factors from ratings captured by the application."""
    db = SessionLocal()
    try:
        rows = db.query(Rating).all()
        if not rows:
            return jsonify({"error": {"code": "validation_error", "message": "No application ratings available for retraining"}}), 400
        frame = pd.DataFrame([{"user_id": r.user_id, "book_id": r.book_id, "rating": r.rating} for r in rows])
        with _model_lock:
            hybrid_model.collaborative_model.retrain_from_new_ratings(frame)
        invalidate_user_history_cache()
        return jsonify({"success": True, "ratings_used": len(frame), "model": "collaborative_svd"})
    finally:
        db.close()

@recommendations_bp.route("/evaluation/metrics", methods=["GET"])
def get_evaluation_metrics():
    """Return academic evaluation metrics, model comparison tables, and sparsity stats."""
    eval_file = os.path.join(Config.ARTIFACTS_DIR, "evaluation_results.json")
    if os.path.exists(eval_file):
        with open(eval_file, "r") as f:
            data = json.load(f)
        return jsonify(data)
    else:
        return jsonify({"status": "Evaluation in progress or artifacts not yet compiled."}), 202
