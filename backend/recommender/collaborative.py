"""Model 3: Collaborative Filtering Recommender.

Explores reader-rating patterns using:
1. Matrix Factorization via SVD (Singular Value Decomposition / Latent Factor Model):
    r_hat(u, i) = mu + b_u + b_i + (p_u . q_i)
    Where:
        mu  = global mean rating
        b_u = user bias
        b_i = book bias
        p_u = user latent factor vector (dim k)
        q_i = book latent factor vector (dim k)
2. Item-based Collaborative Filtering:
    Computes cosine similarity across item rating vectors in the sparse interaction matrix.
"""

import os
import pickle
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.decomposition import TruncatedSVD
from sklearn.metrics.pairwise import cosine_similarity
from .safe_pickle import load_artifact

ARTIFACTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../artifacts"))
PROCESSED_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data/processed"))

class CollaborativeRecommender:
    def __init__(self, k_factors: int = 40):
        self.k_factors = k_factors
        self.mu = 3.85
        self.user_biases = {}
        self.book_biases = {}
        self.user_factors = None   # shape: (n_users, k)
        self.book_factors = None   # shape: (n_books, k)
        
        self.user_id_to_idx = {}
        self.idx_to_user_id = {}
        self.book_id_to_idx = {}
        self.idx_to_book_id = {}
        
        self.books_df = None
        self.item_sim_matrix = None  # for item-item CF
        
        # Try loading pre-trained model
        self.model_path = os.path.join(ARTIFACTS_DIR, "svd_model.pkl")
        self.load_model()
        
        books_path = os.path.join(PROCESSED_DATA_DIR, "books_clean.csv")
        if os.path.exists(books_path):
            self.books_df = pd.read_csv(books_path)

    def fit(self, train_ratings_df: pd.DataFrame = None, max_users: int = 25000, min_user_ratings: int = 5):
        """Train SVD Latent Factor model and compute item similarities on training ratings."""
        print("Training SVD Matrix Factorization collaborative model...")
        if train_ratings_df is None:
            train_path = os.path.join(PROCESSED_DATA_DIR, "train_ratings.csv")
            train_ratings_df = pd.read_csv(train_path)

        # To keep training fast and memory efficient, focus on active users (>= 5 ratings)
        user_counts = train_ratings_df["user_id"].value_counts()
        active_users = user_counts[user_counts >= min_user_ratings].head(max_users).index
        df_sub = train_ratings_df[train_ratings_df["user_id"].isin(active_users)].copy()
        if df_sub.empty:
            return self
        
        # Build mapping
        unique_users = df_sub["user_id"].unique()
        unique_books = df_sub["book_id"].unique()
        
        self.user_id_to_idx = {uid: i for i, uid in enumerate(unique_users)}
        self.idx_to_user_id = {i: uid for i, uid in enumerate(unique_users)}
        
        self.book_id_to_idx = {bid: i for i, bid in enumerate(unique_books)}
        self.idx_to_book_id = {i: bid for i, bid in enumerate(unique_books)}
        
        n_users = len(unique_users)
        n_books = len(unique_books)
        
        print(f"Collaborative matrix: {n_users:,} users x {n_books:,} books with {len(df_sub):,} ratings.")
        
        # Calculate global mean and biases
        self.mu = float(df_sub["rating"].mean())
        
        book_means = df_sub.groupby("book_id")["rating"].mean()
        self.book_biases = {bid: float(mean - self.mu) for bid, mean in book_means.items()}
        
        user_means = df_sub.groupby("user_id")["rating"].mean()
        self.user_biases = {uid: float(mean - self.mu) for uid, mean in user_means.items()}
        
        # Construct centered sparse matrix
        rows = [self.user_id_to_idx[uid] for uid in df_sub["user_id"]]
        cols = [self.book_id_to_idx[bid] for bid in df_sub["book_id"]]
        # Mean-centered ratings
        vals = [r - self.mu for r in df_sub["rating"]]
        
        sparse_mat = csr_matrix((vals, (rows, cols)), shape=(n_users, n_books), dtype=np.float32)
        
        # Decompose using Truncated SVD
        n_components = min(self.k_factors, n_books - 1)
        if n_components < 1:
            # A one-book update can still refresh the bias terms, but SVD needs
            # at least one latent dimension.
            self.user_factors = np.zeros((n_users, 1), dtype=np.float32)
            self.book_factors = np.zeros((n_books, 1), dtype=np.float32)
            self.save_model()
            return self
        svd = TruncatedSVD(n_components=n_components, random_state=42)
        self.user_factors = svd.fit_transform(sparse_mat)  # (n_users, k)
        self.book_factors = svd.components_.T              # (n_books, k)
        
        explained_variance = float(svd.explained_variance_ratio_.sum())
        print(f"SVD fit complete with {n_components} factors (explained variance: {explained_variance:.2%}).")
        
        self.save_model()
        return self

    def retrain_from_new_ratings(self, ratings_df: pd.DataFrame):
        """Refresh the model from application feedback without re-reading the CSV.

        The route passes only newly captured ratings, keeping this hook cheap and
        deterministic for local deployments.  Callers may provide a combined
        frame when a full refresh is desired.
        """
        required = {"user_id", "book_id", "rating"}
        if ratings_df is None or not required.issubset(ratings_df.columns):
            raise ValueError("ratings_df must contain user_id, book_id, and rating columns")
        cleaned = ratings_df[["user_id", "book_id", "rating"]].copy()
        cleaned["user_id"] = cleaned["user_id"].astype(int)
        cleaned["book_id"] = cleaned["book_id"].astype(int)
        cleaned["rating"] = cleaned["rating"].astype(float)
        return self.fit(cleaned, max_users=25_000, min_user_ratings=1)

    def predict_rating(self, user_id: int, book_id: int) -> float:
        """Predict numerical rating r_hat for a user-book pair."""
        user_id = int(user_id)
        book_id = int(book_id)
        
        b_bias = self.book_biases.get(book_id, 0.0)
        u_bias = self.user_biases.get(user_id, 0.0)
        
        pred = self.mu + u_bias + b_bias
        
        # If both user and book are known in latent factor space
        if (self.user_factors is not None and self.book_factors is not None and
            user_id in self.user_id_to_idx and book_id in self.book_id_to_idx):
            u_idx = self.user_id_to_idx[user_id]
            b_idx = self.book_id_to_idx[book_id]
            interaction = np.dot(self.user_factors[u_idx], self.book_factors[b_idx])
            pred += interaction
            
        # Clip to valid rating range [1.0, 5.0]
        return float(np.clip(pred, 1.0, 5.0))

    def recommend_for_user(self, user_id: int, n: int = 10, rated_book_ids: set = None):
        """Generate top N collaborative recommendations for a specific user ID."""
        user_id = int(user_id)
        if rated_book_ids is None:
            rated_book_ids = set()

        # If user is in latent factor space
        if self.user_factors is not None and user_id in self.user_id_to_idx:
            u_idx = self.user_id_to_idx[user_id]
            u_vec = self.user_factors[u_idx]
            u_bias = self.user_biases.get(user_id, 0.0)
            
            # Predict scores for all books in collaborative vocabulary
            # shape: (n_books,)
            scores = self.mu + u_bias + np.array([self.book_biases.get(self.idx_to_book_id[i], 0.0) for i in range(len(self.idx_to_book_id))]) + np.dot(self.book_factors, u_vec)
            
            # Sort descending
            ranked_indices = np.argsort(scores)[::-1]
            
            results = []
            for b_idx in ranked_indices:
                b_id = self.idx_to_book_id[b_idx]
                if b_id in rated_book_ids:
                    continue
                score = float(np.clip(scores[b_idx], 1.0, 5.0))
                
                b_row = self.books_df.loc[self.books_df["book_id"] == b_id] if self.books_df is not None else pd.DataFrame()
                if not b_row.empty:
                    rec = b_row.iloc[0].to_dict()
                    rec["predicted_rating"] = round(score, 2)
                    rec["score"] = round(score / 5.0, 3)  # normalized score
                    rec["algorithm"] = "Collaborative Filtering (SVD Matrix Factorization)"
                    rec["explanation"] = f"Predicted {score:.1f}★ rating based on readers with tastes matching yours."
                    results.append(rec)
                    if len(results) >= n:
                        break
            return results

        # Fallback for new user or unseen user in CF: return top books by item bias
        return []

    def get_similar_books_cf(self, book_id: int, n: int = 10):
        """Item-based CF: find books whose latent factor representations are most cosine-similar."""
        book_id = int(book_id)
        if self.book_factors is None or book_id not in self.book_id_to_idx:
            return []
            
        b_idx = self.book_id_to_idx[book_id]
        b_vec = self.book_factors[b_idx].reshape(1, -1)
        
        sims = cosine_similarity(b_vec, self.book_factors).flatten()
        top_indices = np.argsort(sims)[::-1]
        
        results = []
        for tidx in top_indices:
            if tidx == b_idx:
                continue
            sim_score = float(sims[tidx])
            other_bid = self.idx_to_book_id[tidx]
            b_row = self.books_df.loc[self.books_df["book_id"] == other_bid] if self.books_df is not None else pd.DataFrame()
            if not b_row.empty:
                rec = b_row.iloc[0].to_dict()
                rec["similarity_score"] = round(sim_score, 3)
                rec["algorithm"] = "Item-Based Collaborative Filtering (Latent Factor Cosine)"
                rec["explanation"] = f"Rated similarly by readers who read this book (similarity: {sim_score:.2f})."
                results.append(rec)
                if len(results) >= n:
                    break
        return results

    def save_model(self):
        """Persist SVD model state."""
        data = {
            "k_factors": self.k_factors,
            "mu": self.mu,
            "user_biases": self.user_biases,
            "book_biases": self.book_biases,
            "user_factors": self.user_factors,
            "book_factors": self.book_factors,
            "user_id_to_idx": self.user_id_to_idx,
            "idx_to_user_id": self.idx_to_user_id,
            "book_id_to_idx": self.book_id_to_idx,
            "idx_to_book_id": self.idx_to_book_id,
        }
        with open(self.model_path, "wb") as f:
            pickle.dump(data, f)
        print(f"Saved SVD Collaborative model to {self.model_path}")

    def load_model(self):
        """Load persisted SVD model state."""
        if os.path.exists(self.model_path):
            try:
                data = load_artifact(self.model_path, ARTIFACTS_DIR)
                if not isinstance(data, dict):
                    raise ValueError("SVD artifact must contain a dictionary")
                self.k_factors = data.get("k_factors", 40)
                self.mu = data.get("mu", 3.85)
                self.user_biases = data.get("user_biases", {})
                self.book_biases = data.get("book_biases", {})
                self.user_factors = data.get("user_factors")
                self.book_factors = data.get("book_factors")
                self.user_id_to_idx = data.get("user_id_to_idx", {})
                self.idx_to_user_id = data.get("idx_to_user_id", {})
                self.book_id_to_idx = data.get("book_id_to_idx", {})
                self.idx_to_book_id = data.get("idx_to_book_id", {})
                return True
            except Exception as e:
                print(f"Could not load SVD model: {e}")
        return False
