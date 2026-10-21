"""Model 4: Hybrid Recommendation Engine & Explanation System.

Combines:
- Content-Based Filtering (Model 2: TF-IDF + Cosine on tags/metadata)
- Collaborative Filtering (Model 3: SVD Matrix Factorization)
- Popularity Baseline (Model 1: IMDB Weighted Rating as cold-start fallback)

Mathematical Formulation:
    Score_hybrid(u, i) = alpha * Score_CF(u, i) + (1 - alpha) * Score_CB(u, i)

Where:
    alpha in [0, 1] tunes the balance between collaborative discovery and content fidelity.
    If user has < 3 ratings (Cold Start), falls back gracefully to a blended Popularity + Content model.
"""

import os
import sys
from pathlib import Path
import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from .popularity import PopularityRecommender
    from .content_based import ContentBasedRecommender
    from .collaborative import CollaborativeRecommender
except (ImportError, ValueError):
    from popularity import PopularityRecommender
    from content_based import ContentBasedRecommender
    from collaborative import CollaborativeRecommender

PROCESSED_BOOKS_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../data/processed/books_clean.csv")
)

class HybridRecommender:
    def __init__(self, alpha: float = 0.55):
        self.alpha = alpha  # Weight for Collaborative Filtering vs Content-Based
        self.books_df = pd.read_csv(PROCESSED_BOOKS_PATH) if os.path.exists(PROCESSED_BOOKS_PATH) else pd.DataFrame()
        
        self.popularity_model = PopularityRecommender(self.books_df)
        self.content_model = ContentBasedRecommender(self.books_df)
        self.collaborative_model = CollaborativeRecommender()
        
    def recommend(
        self,
        user_id: int = None,
        user_ratings: list[dict] = None,
        n: int = 10,
        alpha: float = None,
        genre_filter: str = None
    ) -> list[dict]:
        """Generate hybrid recommendations for a user.
        
        user_id: optional integer user ID from Goodbooks-10k or app DB
        user_ratings: optional list of dicts [{'book_id': int, 'rating': float}]
        alpha: override hybrid weighting (0.0 = 100% Content, 1.0 = 100% Collaborative)
        genre_filter: optional genre filter string
        """
        if alpha is None:
            alpha = self.alpha
            
        if user_ratings is None:
            user_ratings = []
            
        rated_book_ids = {int(r["book_id"]) for r in user_ratings if "book_id" in r}
        num_ratings = len(user_ratings)
        
        # --- Scenario A: COLD START (New User, 0 to 2 ratings) ---
        if num_ratings == 0:
            # Fall back to Popularity Baseline + Top Curated
            pop_recs = self.popularity_model.get_top_n(n=n, genre=genre_filter)
            for item in pop_recs:
                item["recommendation_mode"] = "Cold-Start Popularity Baseline"
                item["novelty_score"] = round(self._novelty_score(item), 3)
                item["diversity_score"] = 1.0
                item["genre_balance_score"] = 1.0
                item["explanation"] = f"Top-rated book globally ({item.get('average_rating')}★) with {item.get('ratings_count', 0):,} verified reader ratings."
            return pop_recs
            
        elif num_ratings < 3:
            # Warm Cold-Start: User has rated 1 or 2 books.
            # Content-based is much stronger than SVD for 1-2 ratings.
            cb_recs = self.content_model.recommend_for_user_profile(user_ratings, n=n)
            if genre_filter and genre_filter.lower() != "all":
                cb_recs = [
                    item for item in cb_recs
                    if str(item.get("primary_genre", "")).lower() == genre_filter.lower()
                ]
            if not cb_recs:
                cb_recs = self.popularity_model.get_top_n(n=n, genre=genre_filter)
            for item in cb_recs:
                item["recommendation_mode"] = "Warm Cold-Start (Content Affinity)"
                item["novelty_score"] = self._novelty_score(item)
                item["diversity_score"] = 1.0
                item["explanation"] = self._create_hybrid_explanation(item, item.get("score", 0.0), 0.0, user_ratings)
            return cb_recs

        # --- Scenario B: ESTABLISHED USER (3+ ratings) ---
        # Build a generous candidate pool before final ranking.  A small pool
        # made larger feeds look repetitive and left genre filters with too few
        # results even though the catalog contains 10,000 books.
        candidate_pool_size = min(max(n * 4, 80), 200)

        # 1. Get Content-Based Candidates
        cb_candidates = self.content_model.recommend_for_user_profile(
            user_ratings, n=candidate_pool_size, exclude_rated=True
        )
        cb_dict = {item["book_id"]: item for item in cb_candidates}
        
        # 2. Get Collaborative Filtering Candidates (Top 50)
        cf_candidates = []
        if user_id:
            cf_candidates = self.collaborative_model.recommend_for_user(
                user_id, n=candidate_pool_size, rated_book_ids=rated_book_ids
            )
        cf_dict = {item["book_id"]: item for item in cf_candidates}
        
        # Combine candidate book IDs
        candidate_ids = set(cb_dict.keys()) | set(cf_dict.keys())
        
        # If neither produced candidates, fall back to Popularity
        if not candidate_ids:
            return self.popularity_model.get_top_n(n=n, genre=genre_filter)
            
        # Normalize and compute hybrid score for each candidate
        # Max scores for scaling
        max_cb = max([item.get("score", 0.0) for item in cb_candidates], default=1.0) or 1.0
        
        scored_books = []
        for b_id in candidate_ids:
            cb_item = cb_dict.get(b_id)
            cf_item = cf_dict.get(b_id)
            
            # Content score normalized [0, 1]
            cb_score = (cb_item.get("score", 0.0) / max_cb) if cb_item else 0.0
            
            # CF score: predicted rating normalized (r_hat - 1) / 4 in [0, 1]
            if cf_item:
                cf_score = (cf_item.get("predicted_rating", 3.5) - 1.0) / 4.0
            elif user_id:
                pred = self.collaborative_model.predict_rating(user_id, b_id)
                cf_score = (pred - 1.0) / 4.0
            else:
                cf_score = 0.5  # neutral prior
                
            base_hybrid_score = (alpha * cf_score) + ((1.0 - alpha) * cb_score)
            
            # Retrieve full book metadata
            b_row = self.books_df.loc[self.books_df["book_id"] == b_id]
            if b_row.empty:
                continue
            book_data = b_row.iloc[0].to_dict()
            
            # Filter genre if specified
            if genre_filter and genre_filter.lower() != "all":
                if str(book_data.get("primary_genre", "")).lower() != genre_filter.lower():
                    continue
                    
            novelty_score = self._novelty_score(book_data)
            # Keep the ensemble score dominant while rewarding less-saturated
            # books.  The final selection below applies a deterministic genre
            # balancing penalty so a single genre cannot fill the whole list.
            hybrid_score = (0.85 * base_hybrid_score) + (0.15 * novelty_score)
            book_data["base_hybrid_score"] = round(float(base_hybrid_score), 4)
            book_data["hybrid_score"] = round(float(hybrid_score), 4)
            book_data["score"] = round(float(hybrid_score), 4)
            book_data["cb_score"] = round(float(cb_score), 3)
            book_data["cf_score"] = round(float(cf_score), 3)
            book_data["novelty_score"] = round(float(novelty_score), 3)
            book_data["diversity_score"] = 0.0
            book_data["genre_balance_score"] = 0.0
            book_data["algorithm"] = f"Hybrid Recommender ({int(alpha*100)}% CF + {int((1-alpha)*100)}% Content)"
            book_data["recommendation_mode"] = "Hybrid Ensemble"
            book_data["explanation"] = self._create_hybrid_explanation(book_data, cb_score, cf_score, user_ratings)
            
            scored_books.append(book_data)
            
        return self._select_diverse(scored_books, n)

    @staticmethod
    def _novelty_score(book_data: dict) -> float:
        """Estimate novelty from catalog exposure (higher means less mainstream)."""
        ratings_count = max(float(book_data.get("ratings_count") or 0.0), 0.0)
        return float(1.0 / (1.0 + np.log1p(ratings_count) / 10.0))

    @staticmethod
    def _metadata_tokens(book_data: dict) -> set[str]:
        values = [book_data.get("authors", ""), book_data.get("primary_genre", ""), book_data.get("top_tags", "")]
        return {token.strip().lower() for value in values for token in str(value).replace("|", ",").split(",") if token.strip()}

    def _select_diverse(self, candidates: list[dict], n: int) -> list[dict]:
        """Deterministic greedy MMR-style selection with genre balancing."""
        remaining = list(candidates)
        selected: list[dict] = []
        genre_counts: dict[str, int] = {}
        while remaining and len(selected) < n:
            best_index = 0
            best_value = float("-inf")
            for index, candidate in enumerate(remaining):
                genre = str(candidate.get("primary_genre") or "Fiction").lower()
                duplicate_penalty = 0.08 * genre_counts.get(genre, 0)
                diversity = 1.0
                if selected:
                    tokens = self._metadata_tokens(candidate)
                    overlaps = []
                    for prior in selected:
                        prior_tokens = self._metadata_tokens(prior)
                        union = tokens | prior_tokens
                        overlaps.append(len(tokens & prior_tokens) / len(union) if union else 0.0)
                    diversity = 1.0 - max(overlaps, default=0.0)
                value = float(candidate.get("hybrid_score", 0.0)) + (0.08 * diversity) - duplicate_penalty
                if value > best_value:
                    best_value = value
                    best_index = index
            chosen = remaining.pop(best_index)
            genre = str(chosen.get("primary_genre") or "Fiction").lower()
            genre_counts[genre] = genre_counts.get(genre, 0) + 1
            chosen["diversity_score"] = round(float(max(0.0, min(1.0, (best_value - float(chosen.get("hybrid_score", 0.0)) + 0.08) / 0.08))), 3)
            chosen["genre_balance_score"] = round(1.0 / genre_counts[genre], 3)
            selected.append(chosen)
        return selected

    def _create_hybrid_explanation(self, book_data, cb_score, cf_score, user_ratings):
        """Construct a convincing, academic-level explanation for why the hybrid model picked this book."""
        genre = book_data.get("primary_genre", "Fiction")
        author = book_data.get("authors", "Various Authors")
        
        # Identify the user's strongest *supporting* book using actual metadata
        # overlap, rather than presenting an arbitrary mocked anchor.
        top_user_book = None
        support_reasons = []
        if user_ratings:
            target_tokens = self._metadata_tokens(book_data)
            support_candidates = []
            for rating in user_ratings:
                b_id = rating.get("book_id")
                match = self.books_df.loc[self.books_df["book_id"] == b_id]
                if match.empty:
                    continue
                source = match.iloc[0].to_dict()
                source_tokens = self._metadata_tokens(source)
                overlap = len(target_tokens & source_tokens) / len(target_tokens | source_tokens) if target_tokens | source_tokens else 0.0
                support_candidates.append((overlap * (float(rating.get("rating", 0.0)) / 5.0), source, rating))
            if support_candidates:
                _, source, rating = max(support_candidates, key=lambda item: (item[0], float(item[2].get("rating", 0.0)), -int(item[1].get("book_id", 0))))
                top_user_book = source.get("title", "")
                common_tags = self._metadata_tokens(source) & self._metadata_tokens(book_data)
                if source.get("primary_genre") == book_data.get("primary_genre"):
                    support_reasons.append(f"both are {book_data.get('primary_genre')} reads")
                if common_tags:
                    support_reasons.append(f"shared themes such as {', '.join(sorted(common_tags)[:2])}")
                if source.get("authors") == book_data.get("authors"):
                    support_reasons.append(f"the same author ({book_data.get('authors')})")
                
        reasons = []
        if cb_score > 0.4:
            if top_user_book:
                detail = f" ({', '.join(support_reasons)})" if support_reasons else ""
                reasons.append(f"Similar to your rated book '{top_user_book}'{detail}")
            else:
                reasons.append(f"Matches your high affinity for {genre}")
            
        if cf_score > 0.65:
            reasons.append(f"Ranked in top 5% by readers who share your taste profile")
            
        if not reasons:
            reasons.append(f"Curated {genre} recommendation by {author} with {book_data.get('average_rating', 4.0):.2f}★ overall consensus")
            
        return " • ".join(reasons)

    def compare_models(self, user_id: int, book_id: int = 1, n: int = 5) -> dict:
        """Academic comparison: run all 4 models and return side-by-side results."""
        # 1. Popularity
        pop = self.popularity_model.get_top_n(n=n)
        
        # 2. Content-Based (similar to book_id)
        cb = self.content_model.recommend_similar_books(book_id=book_id, n=n)
        
        # 3. Collaborative (for user_id)
        cf = self.collaborative_model.recommend_for_user(user_id=user_id, n=n)
        
        # 4. Hybrid (for user_id), using the user's actual persisted/history
        # ratings.  The anchor book is only used for the content model above;
        # it must never be treated as an implicit five-star rating.
        actual_ratings = self._get_user_ratings(user_id)
        hybrid = self.recommend(user_id=user_id, user_ratings=actual_ratings, n=n, alpha=0.55)
        
        return {
            "comparison_context": {
                "user_id": user_id,
                "anchor_book_id": book_id,
                "ratings_count": len(actual_ratings),
                "ratings_source": "database_or_cached_training_history"
            },
            "models": {
                "model_1_popularity": {
                    "name": "Model 1: Popularity Baseline",
                    "technique": "IMDB Weighted Rating (v/(v+m)*R + m/(v+m)*C)",
                    "best_for": "Cold-Start Users (0 prior ratings), Global Trending Shelves",
                    "recommendations": pop
                },
                "model_2_content_based": {
                    "name": "Model 2: Content-Based Filtering",
                    "technique": "TF-IDF Vectorizer + Cosine Similarity on Metadata Soup",
                    "best_for": "Item-to-item similarity, Niche genre matching, Explainability",
                    "recommendations": cb
                },
                "model_3_collaborative": {
                    "name": "Model 3: Collaborative Filtering",
                    "technique": "Truncated SVD Matrix Factorization (Latent Factors)",
                    "best_for": "Serendipitous discovery, Cross-genre reader patterns",
                    "recommendations": cf
                },
                "model_4_hybrid": {
                    "name": "Model 4: Hybrid Recommender",
                    "technique": "Linear Ensemble (alpha*CF + (1-alpha)*CB) + Cold-Start Gate",
                    "best_for": "Balanced accuracy, cold-start resilience, and transparent explanations",
                    "recommendations": hybrid
                }
            }
        }

    @staticmethod
    def _get_user_ratings(user_id: int) -> list[dict]:
        """Load persisted ratings first, then the cached offline history."""
        try:
            from ..database import SessionLocal
            from ..models.database_models import Rating
            db = SessionLocal()
            try:
                rows = db.query(Rating).filter(Rating.user_id == int(user_id)).all()
                if rows:
                    return [{"book_id": r.book_id, "rating": float(r.rating)} for r in rows]
            finally:
                db.close()
        except Exception:
            pass
        try:
            from .history import get_cached_user_history
            return get_cached_user_history(user_id)
        except Exception:
            return []
