from flask import Blueprint, request, jsonify
from sqlalchemy import or_, desc, asc
from ..database import SessionLocal
from ..models.database_models import Book
from ..recommender.content_based import ContentBasedRecommender
from ..recommender.collaborative import CollaborativeRecommender

books_bp = Blueprint("books", __name__)
content_recommender = ContentBasedRecommender()
collaborative_recommender = CollaborativeRecommender()

@books_bp.route("/books", methods=["GET"])
def get_books():
    """Browse, search, filter, and paginate books."""
    db = SessionLocal()
    try:
        page = int(request.args.get("page", 1))
        limit = min(int(request.args.get("limit", 24)), 100)
        query_str = request.args.get("q", "").strip()
        genre = request.args.get("genre", "").strip()
        sort_by = request.args.get("sort_by", "popularity")  # popularity, rating, year, title
        order = request.args.get("order", "desc")
        
        query = db.query(Book)
        
        # Search title and authors
        if query_str:
            search_pattern = f"%{query_str}%"
            query = query.filter(
                or_(
                    Book.title.ilike(search_pattern),
                    Book.authors.ilike(search_pattern),
                    Book.original_title.ilike(search_pattern),
                    Book.top_tags.ilike(search_pattern)
                )
            )
            
        # Filter genre
        if genre and genre.lower() != "all":
            query = query.filter(Book.primary_genre.ilike(genre))
            
        # Sorting
        if sort_by == "popularity":
            sort_col = Book.weighted_rating
        elif sort_by == "rating":
            sort_col = Book.average_rating
        elif sort_by == "year":
            sort_col = Book.original_publication_year
        elif sort_by == "ratings_count":
            sort_col = Book.ratings_count
        else:
            sort_col = Book.title
            
        if order.lower() == "asc":
            query = query.order_by(asc(sort_col))
        else:
            query = query.order_by(desc(sort_col))
            
        total_books = query.count()
        total_pages = (total_books + limit - 1) // limit
        
        books = query.offset((page - 1) * limit).limit(limit).all()
        
        return jsonify({
            "page": page,
            "limit": limit,
            "total_books": total_books,
            "total_pages": total_pages,
            "books": [b.to_dict() for b in books]
        })
    finally:
        db.close()

@books_bp.route("/books/<int:book_id>", methods=["GET"])
def get_book_details(book_id):
    """Retrieve full metadata for a single book."""
    db = SessionLocal()
    try:
        book = db.query(Book).filter(Book.book_id == book_id).first()
        if not book:
            return jsonify({"error": {"code": "not_found", "message": "Book not found"}}), 404
        return jsonify(book.to_dict())
    finally:
        db.close()

@books_bp.route("/books/<int:book_id>/similar", methods=["GET"])
def get_similar_books(book_id):
    """Get content-based and collaborative similar books for a specific book."""
    n = int(request.args.get("n", 10))
    algorithm = request.args.get("algorithm", "content")  # content, collaborative, or blended
    
    if algorithm == "collaborative":
        similar = collaborative_recommender.get_similar_books_cf(book_id=book_id, n=n)
    else:
        similar = content_recommender.recommend_similar_books(book_id=book_id, n=n)
        
    return jsonify({
        "book_id": book_id,
        "algorithm": algorithm,
        "count": len(similar),
        "similar_books": similar
    })

@books_bp.route("/genres", methods=["GET"])
def get_genres():
    """Retrieve all available genres with book counts."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        genres = db.query(
            Book.primary_genre,
            func.count(Book.book_id).label("count")
        ).group_by(Book.primary_genre).order_by(desc("count")).all()
        
        return jsonify({
            "genres": [{"name": g[0], "count": g[1]} for g in genres if g[0]]
        })
    finally:
        db.close()
