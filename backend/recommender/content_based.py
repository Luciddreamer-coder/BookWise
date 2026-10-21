"""Model 2: Content-Based Filtering Recommender.

Finds books with similar characteristics based on:
- Authors (normalized tokens)
- Title keywords
- Clean descriptive tags (e.g. fantasy, magic, dystopia, philosophy)
- Primary genre

Techniques:
- TF-IDF Vectorization of metadata soup.
- Pairwise Cosine Similarity:
    Cosine(u, v) = (u . v) / (||u|| * ||v||)
- User Profile Centroid:
    Constructs a user taste vector by computing a rating-weighted average
    of the TF-IDF vectors of books the user enjoyed.
"""

import os
import json
import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import linear_kernel
from .safe_pickle import load_artifact

ARTIFACTS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../artifacts")
)
PROCESSED_BOOKS_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../data/processed/books_clean.csv")
)

class ContentBasedRecommender:
    def __init__(self, books_df: pd.DataFrame = None):
        if books_df is not None:
            self.books = books_df.copy()
        elif os.path.exists(PROCESSED_BOOKS_PATH):
            self.books = pd.read_csv(PROCESSED_BOOKS_PATH)
        else:
            self.books = pd.DataFrame()
            
        self.id_to_idx = {row["book_id"]: i for i, row in self.books.iterrows()}
        self.idx_to_id = {i: row["book_id"] for i, row in self.books.iterrows()}
        
        # Load artifacts if available
        self.tfidf_matrix = None
        self.tfidf_vectorizer = None
        self.similarity_lookup = {}
        
        sim_path = os.path.join(ARTIFACTS_DIR, "content_similarity_top30.json")
        if os.path.exists(sim_path):
            with open(sim_path, "r") as f:
                raw_lookup = json.load(f)
                self.similarity_lookup = {int(k): v for k, v in raw_lookup.items()}
                
        matrix_path = os.path.join(ARTIFACTS_DIR, "tfidf_matrix.pkl")
        if os.path.exists(matrix_path):
            try:
                self.tfidf_matrix = load_artifact(matrix_path, ARTIFACTS_DIR)
            except Exception as exc:
                print(f"Could not safely load TF-IDF matrix: {exc}")
                self.tfidf_matrix = None
                
        vec_path = os.path.join(ARTIFACTS_DIR, "tfidf_vectorizer.pkl")
        if os.path.exists(vec_path):
            try:
                self.tfidf_vectorizer = load_artifact(vec_path, ARTIFACTS_DIR)
            except Exception as exc:
                print(f"Could not safely load TF-IDF vectorizer: {exc}")
                self.tfidf_vectorizer = None

    def recommend_similar_books(self, book_id: int, n: int = 10):
        """Get top N similar books for a single book_id using cosine similarity."""
        book_id = int(book_id)
        if book_id not in self.id_to_idx:
            return []
            
        target_book = self.books.loc[self.books["book_id"] == book_id].iloc[0]
        
        # Fast path: use precomputed lookup table
        if book_id in self.similarity_lookup and self.similarity_lookup[book_id]:
            neighbors = self.similarity_lookup[book_id][:n]
            results = []
            for item in neighbors:
                b_id = item["book_id"]
                score = item["score"]
                b_row = self.books.loc[self.books["book_id"] == b_id]
                if not b_row.empty:
                    rec = b_row.iloc[0].to_dict()
                    rec["similarity_score"] = score
                    rec["algorithm"] = "Content-Based Filtering (TF-IDF Cosine)"
                    rec["explanation"] = self._generate_pair_explanation(target_book, rec)
                    results.append(rec)
            return results

        # Slow fallback: live calculation
        if self.tfidf_matrix is not None:
            idx = self.id_to_idx[book_id]
            cosine_sim = linear_kernel(self.tfidf_matrix[idx], self.tfidf_matrix).flatten()
            top_indices = np.argsort(cosine_sim)[::-1]
            results = []
            for tidx in top_indices:
                if tidx == idx:
                    continue
                score = float(cosine_sim[tidx])
                b_id = self.idx_to_id[tidx]
                b_row = self.books.loc[self.books["book_id"] == b_id].iloc[0]
                rec = b_row.to_dict()
                rec["similarity_score"] = round(score, 3)
                rec["algorithm"] = "Content-Based Filtering (TF-IDF Cosine)"
                rec["explanation"] = self._generate_pair_explanation(target_book, rec)
                results.append(rec)
                if len(results) >= n:
                    break
            return results

        return []

    def recommend_for_user_profile(self, user_ratings: list[dict], n: int = 10, exclude_rated: bool = True):
        """Recommend books based on a user's rating history.
        
        user_ratings: list of dicts with keys 'book_id' and 'rating' (1-5)
        Constructs user taste profile centroid vector:
            v_user = sum(weight_i * v_book_i) / sum(weight_i)
        """
        if not user_ratings or self.tfidf_matrix is None:
            return []

        rated_book_ids = set()
        user_vector = None
        total_weight = 0.0

        for ur in user_ratings:
            b_id = int(ur["book_id"])
            rating = float(ur.get("rating", 3.0))
            rated_book_ids.add(b_id)
            
            # Focus on positively rated books (>= 3.0)
            if rating >= 3.0 and b_id in self.id_to_idx:
                weight = rating - 2.5  # 5 -> 2.5, 4 -> 1.5, 3 -> 0.5
                idx = self.id_to_idx[b_id]
                book_vec = self.tfidf_matrix[idx].toarray().flatten()
                
                if user_vector is None:
                    user_vector = weight * book_vec
                else:
                    user_vector += weight * book_vec
                total_weight += weight

        if user_vector is None or total_weight == 0:
            return []

        user_vector = user_vector / total_weight
        # Compute cosine similarity between user taste vector and all books
        user_norm = np.linalg.norm(user_vector)
        if user_norm > 0:
            user_vector = user_vector / user_norm

        # Matrix multiply (10000 x vocab) dot (vocab,)
        all_scores = self.tfidf_matrix.dot(user_vector).flatten()
        top_indices = np.argsort(all_scores)[::-1]

        results = []
        for tidx in top_indices:
            b_id = self.idx_to_id[tidx]
            if exclude_rated and b_id in rated_book_ids:
                continue
            score = float(all_scores[tidx])
            if score <= 0.001:
                break
            b_row = self.books.loc[self.books["book_id"] == b_id].iloc[0]
            rec = b_row.to_dict()
            rec["score"] = round(score, 4)
            rec["algorithm"] = "Content-Based Taste Profile"
            rec["explanation"] = f"Strong alignment ({round(score*100)}% match) with your preferred themes and authors."
            results.append(rec)
            if len(results) >= n:
                break

        return results

    def _generate_pair_explanation(self, source, target):
        """Generate human-readable justification for why two books match."""
        explanations = []
        
        # Author match
        s_authors = set(str(source.get("authors", "")).lower().split(","))
        t_authors = set(str(target.get("authors", "")).lower().split(","))
        if s_authors & t_authors:
            explanations.append(f"Written by {target.get('authors')}")
            
        # Genre match
        if source.get("primary_genre") and source.get("primary_genre") == target.get("primary_genre"):
            explanations.append(f"Shares the {source['primary_genre']} genre")
            
        # Common tags
        s_tags = set([t.strip().lower() for t in str(source.get("top_tags", "")).split(",") if t.strip()])
        t_tags = set([t.strip().lower() for t in str(target.get("top_tags", "")).split(",") if t.strip()])
        common = list(s_tags & t_tags)
        if common:
            tags_str = ", ".join(common[:3]).replace("-", " ")
            explanations.append(f"Common themes: {tags_str}")
            
        if explanations:
            return " • ".join(explanations)
        return "High lexical and thematic similarity based on reader tags and metadata."
