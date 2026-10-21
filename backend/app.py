import os
import math
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask.json.provider import DefaultJSONProvider
from werkzeug.exceptions import HTTPException
from .config import Config
from .database import init_db
from .routes.books import books_bp
from .routes.recommendations import recommendations_bp
from .routes.users import users_bp
from .routes.reader import reader_bp
from .routes.discovery import discovery_bp


def _sanitize_json(value):
    """Convert pandas/NumPy non-finite values into strict JSON nulls."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: _sanitize_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_json(item) for item in value]
    if hasattr(value, "item") and not isinstance(value, (str, bytes, bytearray)):
        try:
            return _sanitize_json(value.item())
        except (ValueError, TypeError):
            pass
    return value


class StrictJSONProvider(DefaultJSONProvider):
    def dumps(self, obj, **kwargs):
        return super().dumps(_sanitize_json(obj), **kwargs)


def create_app(config_class=Config):
    app = Flask(__name__)
    app.json = StrictJSONProvider(app)
    config_class.validate()
    app.config.from_object(config_class)
    app.config.setdefault("RATE_LIMIT_READER_MUTATION_MAX", 60)
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024

    from .database import configure_database
    configure_database(app.config["SQLALCHEMY_DATABASE_URI"])
    
    # Enable CORS for React frontend
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"], "supports_credentials": True}})
    
    # Register API blueprints
    app.register_blueprint(books_bp, url_prefix="/api")
    app.register_blueprint(recommendations_bp, url_prefix="/api")
    app.register_blueprint(users_bp, url_prefix="/api")
    app.register_blueprint(reader_bp, url_prefix="/api")
    app.register_blueprint(discovery_bp, url_prefix="/api")

    @app.before_request
    def protect_browser_writes():
        # All browser mutations are JSON or bodyless DELETE/POST. Reject
        # cross-site form submissions, including login CSRF, before handlers.
        if not request.path.startswith("/api/") or request.method in {"GET", "HEAD", "OPTIONS"}:
            return None
        origin = request.headers.get("Origin")
        allowed = set(app.config["CORS_ORIGINS"]) | {request.host_url.rstrip("/")}
        if origin and origin not in allowed:
            return jsonify({"error": {"code": "forbidden", "message": "Untrusted request origin"}}), 403
        if request.headers.get("Sec-Fetch-Site") == "cross-site" and not origin:
            return jsonify({"error": {"code": "forbidden", "message": "Cross-site write rejected"}}), 403
        if request.content_length and not request.is_json:
            return jsonify({"error": {"code": "unsupported_media_type", "message": "Use application/json"}}), 415

    @app.after_request
    def private_api_responses(response):
        if request.path.startswith(("/api/discovery/", "/api/auth/")):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        if request.path.startswith("/api/"):
            return jsonify({
                "error": {"code": error.name.lower().replace(" ", "_"), "message": error.description}
            }), error.code
        return error

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        app.logger.exception("Unhandled API error", exc_info=error)
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "internal_server_error", "message": "Internal server error"}}), 500
        raise error
    
    @app.route("/api/health", methods=["GET"])
    def health_check():
        from .database import SessionLocal
        from .models.database_models import Book, User
        db = SessionLocal()
        try:
            b_count = db.query(Book).count()
            u_count = db.query(User).count()
            return jsonify({
                "status": "healthy",
                "service": "BookWise Recommendation API",
                "version": "1.0.0",
                "database": {
                    "books_loaded": b_count,
                    "users_active": u_count
                },
                "algorithms": [
                    "Model 1: Popularity Baseline (IMDB Weighted Rating)",
                    "Model 2: Content-Based Filtering (TF-IDF + Cosine)",
                    "Model 3: Collaborative Filtering (Truncated SVD)",
                    "Model 4: Hybrid Recommender (Linear Ensemble + Cold-Start Gate)"
                ]
            })
        finally:
            db.close()
            
    # Auto-initialize database schema and seed books if needed
    with app.app_context():
        init_db()
        
    return app

if __name__ == "__main__":
    app = create_app()
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting BookWise API server on http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
