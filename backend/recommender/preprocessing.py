"""Data Preprocessing & Feature Engineering for BookWise.

Handles:
- Loading raw Goodbooks-10k data (books.csv, ratings.csv, book_tags.csv, tags.csv).
- Data cleaning, null handling, type conversion.
- Tag cleaning & filtering (removing shelf noise like to-read, owned, etc.).
- Primary genre assignment and metadata soup construction.
- Train/test splitting (80/20) avoiding data leakage.
- Precomputing TF-IDF vectors and similarity indices.
"""

import os
import re
import json
import pickle
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
from sklearn.model_selection import train_test_split

DATA_RAW_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data/raw"))
DATA_PROCESSED_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data/processed"))
ARTIFACTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../artifacts"))

# Canonical genres mapping from tags
GENRE_KEYWORDS = {
    "Fantasy": ["fantasy", "magic", "wizards", "epic-fantasy", "high-fantasy", "urban-fantasy", "mythology", "fairies"],
    "Science Fiction": ["sci-fi", "science-fiction", "dystopia", "dystopian", "aliens", "space-opera", "time-travel", "post-apocalyptic", "cyberpunk"],
    "Romance": ["romance", "contemporary-romance", "chick-lit", "love", "romantic", "historical-romance"],
    "Mystery & Thriller": ["mystery", "thriller", "suspense", "crime", "detective", "murder", "psychological-thriller"],
    "Classics": ["classics", "classic", "literature", "literary-fiction", "victorian", "school"],
    "Historical Fiction": ["historical-fiction", "history", "historical", "war", "wwii", "world-war-ii"],
    "Young Adult": ["young-adult", "ya", "teen", "juvenile", "coming-of-age"],
    "Nonfiction": ["non-fiction", "nonfiction", "memoir", "biography", "autobiography", "philosophy", "psychology", "science", "history-biography", "self-help"],
    "Horror": ["horror", "scary", "ghosts", "vampires", "paranormal", "zombies", "dark"],
    "Adventure": ["adventure", "action", "survival", "quest", "pirates"]
}

# Shelf/noise tags that convey no topical meaning
NOISE_TAGS = {
    "to-read", "favorites", "owned", "books-i-own", "currently-reading", "library",
    "owned-books", "to-buy", "kindle", "default", "ebook", "my-books", "audiobook",
    "ebooks", "wish-list", "my-library", "audiobooks", "i-own", "favourites", "own-it",
    "audio", "read-in-2015", "read-in-2016", "read-in-2017", "read-in-2014", "read-in-2013",
    "read-in-2012", "all-time-favorites", "re-read", "have", "borrowed", "did-not-finish",
    "maybe", "favorite", "shelfari-favorites", "abandoned", "audio-book", "audio-books",
    "e-book", "e-books", "books", "novel", "novels", "fiction", "adult-fiction", "adult"
}

def clean_text(text: str) -> str:
    """Sanitize and clean text for processing."""
    if not isinstance(text, str):
        return ""
    text = re.sub(r"[^\w\s\-,]", " ", text)
    return " ".join(text.split())

def process_books_and_tags():
    """Clean books, extract clean tags, assign primary genres, and construct metadata soup."""
    os.makedirs(DATA_PROCESSED_DIR, exist_ok=True)
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    
    print("[1/5] Loading raw datasets...")
    books = pd.read_csv(os.path.join(DATA_RAW_DIR, "books.csv"))
    tags = pd.read_csv(os.path.join(DATA_RAW_DIR, "tags.csv"))
    book_tags = pd.read_csv(os.path.join(DATA_RAW_DIR, "book_tags.csv"))
    
    print(f"Loaded {len(books)} books, {len(tags)} tags, {len(book_tags)} book_tag associations.")
    
    # Clean tags
    print("[2/5] Cleaning tags and extracting book genres...")
    tags["clean_tag"] = tags["tag_name"].astype(str).str.strip().str.lower()
    
    # Filter out noise tags
    meaningful_tags = tags[~tags["clean_tag"].isin(NOISE_TAGS)]
    
    # Merge book_tags with clean tags
    bt_merged = book_tags.merge(meaningful_tags, on="tag_id")
    # Sort by tag count per book
    bt_sorted = bt_merged.sort_values(["goodreads_book_id", "count"], ascending=[True, False])
    
    # Group top 12 descriptive tags per goodreads_book_id
    tags_per_book = bt_sorted.groupby("goodreads_book_id")["clean_tag"].apply(lambda s: list(s.head(12))).to_dict()
    
    # Determine primary genre for each book
    def assign_genre(tag_list):
        if not tag_list:
            return "General Fiction"
        tag_set = set(tag_list)
        for genre, keywords in GENRE_KEYWORDS.items():
            if any(kw in tag_set or any(kw in t for t in tag_list) for kw in keywords):
                return genre
        return "General Fiction"
    
    # Map back to books.csv (using goodreads_book_id)
    book_genres = []
    book_tag_strings = []
    
    for _, row in books.iterrows():
        gr_id = row["goodreads_book_id"]
        t_list = tags_per_book.get(gr_id, [])
        genre = assign_genre(t_list)
        book_genres.append(genre)
        book_tag_strings.append(", ".join(t_list))
        
    books["primary_genre"] = book_genres
    books["top_tags"] = book_tag_strings
    
    # Clean metadata fields
    books["original_title"] = books["original_title"].fillna(books["title"])
    books["original_publication_year"] = books["original_publication_year"].fillna(0).astype(int)
    books["authors"] = books["authors"].fillna("Unknown")
    books["language_code"] = books["language_code"].fillna("eng")
    
    # Fallback image check
    books["has_valid_cover"] = ~books["image_url"].str.contains("nophoto", case=False, na=True)
    
    # Calculate IMDB Weighted Rating (Popularity Baseline)
    # Formula: WR = (v / (v + m)) * R + (m / (v + m)) * C
    C = books["average_rating"].mean()
    m = books["ratings_count"].quantile(0.85)  # 85th percentile threshold
    
    def weighted_rating(x, m=m, C=C):
        v = x["ratings_count"]
        R = x["average_rating"]
        return (v / (v + m) * R) + (m / (v + m) * C)
        
    books["weighted_rating"] = books.apply(weighted_rating, axis=1)
    
    # Metadata soup for Content-Based Recommender
    def create_soup(row):
        # Normalize authors: e.g. "J.K. Rowling" -> "jk_rowling"
        authors_clean = " ".join([a.strip().lower().replace(" ", "_") for a in str(row["authors"]).split(",")])
        tags_clean = " ".join([t.replace("-", "_") for t in str(row["top_tags"]).split(", ") if t])
        genre_clean = str(row["primary_genre"]).lower().replace(" ", "_").replace("&", "_")
        title_clean = str(row["title"]).lower()
        return f"{title_clean} {authors_clean} {genre_clean} {tags_clean}"
        
    books["metadata_soup"] = books.apply(create_soup, axis=1)
    
    # Save processed books
    output_books_path = os.path.join(DATA_PROCESSED_DIR, "books_clean.csv")
    books.to_csv(output_books_path, index=False)
    print(f"Saved cleaned books to {output_books_path} (shape: {books.shape})")
    
    # Precompute TF-IDF Matrix & Top-30 Content Similarity per book
    print("[3/5] Computing TF-IDF & pairwise cosine similarities...")
    tfidf = TfidfVectorizer(stop_words="english", max_features=10000)
    tfidf_matrix = tfidf.fit_transform(books["metadata_soup"])
    
    print(f"TF-IDF matrix shape: {tfidf_matrix.shape}")
    
    # Save TF-IDF model and matrix
    with open(os.path.join(ARTIFACTS_DIR, "tfidf_vectorizer.pkl"), "wb") as f:
        pickle.dump(tfidf, f)
    with open(os.path.join(ARTIFACTS_DIR, "tfidf_matrix.pkl"), "wb") as f:
        pickle.dump(tfidf_matrix, f)
        
    # Precompute top 30 content neighbors per book_id for lightning-fast retrieval
    print("Precomputing top-30 content similarity lookup table...")
    # Map index 0..N to book_id
    id_to_idx = {row["book_id"]: i for i, row in books.iterrows()}
    idx_to_id = {i: row["book_id"] for i, row in books.iterrows()}
    
    # We can compute cosine similarity in chunks to keep memory light
    similarity_lookup = {}
    chunk_size = 1000
    n_books = len(books)
    
    for start in range(0, n_books, chunk_size):
        end = min(start + chunk_size, n_books)
        chunk_sim = linear_kernel(tfidf_matrix[start:end], tfidf_matrix)
        for i in range(chunk_sim.shape[0]):
            book_idx = start + i
            book_id = int(idx_to_id[book_idx])
            # Argsort descending (excluding self)
            sim_scores = chunk_sim[i]
            top_indices = np.argsort(sim_scores)[::-1]
            top_neighbors = []
            for tidx in top_indices:
                if tidx == book_idx:
                    continue
                score = float(sim_scores[tidx])
                if score < 0.01:
                    break
                top_neighbors.append({"book_id": int(idx_to_id[tidx]), "score": round(score, 4)})
                if len(top_neighbors) >= 30:
                    break
            similarity_lookup[book_id] = top_neighbors

    with open(os.path.join(ARTIFACTS_DIR, "content_similarity_top30.json"), "w") as f:
        json.dump(similarity_lookup, f)
    print(f"Precomputed similarity lookup for {len(similarity_lookup)} books saved.")
    
    return books

def process_ratings_and_split():
    """Clean ratings, create stratified 80/20 train/test split without data leakage."""
    print("[4/5] Loading and splitting ratings...")
    ratings = pd.read_csv(os.path.join(DATA_RAW_DIR, "ratings.csv"))
    print(f"Raw ratings count: {len(ratings):,}")
    
    # Remove any duplicates (user_id, book_id)
    ratings = ratings.drop_duplicates(subset=["user_id", "book_id"])
    
    # Verify rating scale (1 to 5)
    ratings = ratings[(ratings["rating"] >= 1) & (ratings["rating"] <= 5)]
    
    # 80/20 train-test split
    # For recommender evaluation, we hold out 20% of ratings
    train_ratings, test_ratings = train_test_split(ratings, test_size=0.20, random_state=42)
    
    print(f"Train ratings: {len(train_ratings):,}, Test ratings: {len(test_ratings):,}")
    
    train_path = os.path.join(DATA_PROCESSED_DIR, "train_ratings.csv")
    test_path = os.path.join(DATA_PROCESSED_DIR, "test_ratings.csv")
    
    train_ratings.to_csv(train_path, index=False)
    test_ratings.to_csv(test_path, index=False)
    
    print(f"Saved train and test ratings to {DATA_PROCESSED_DIR}")
    
    # Calculate sparsity stats
    n_users = ratings["user_id"].nunique()
    n_books = ratings["book_id"].nunique()
    n_ratings = len(ratings)
    total_possible = n_users * n_books
    sparsity = (1.0 - (n_ratings / total_possible)) * 100.0
    
    sparsity_info = {
        "num_users": int(n_users),
        "num_books": int(n_books),
        "num_ratings": int(n_ratings),
        "train_ratings": int(len(train_ratings)),
        "test_ratings": int(len(test_ratings)),
        "matrix_density_pct": round((n_ratings / total_possible) * 100.0, 4),
        "sparsity_pct": round(sparsity, 4),
        "ratings_distribution": ratings["rating"].value_counts().sort_index().to_dict(),
        "ratings_per_user_mean": round(float(ratings.groupby("user_id").size().mean()), 2),
        "ratings_per_user_median": int(ratings.groupby("user_id").size().median()),
        "ratings_per_book_mean": round(float(ratings.groupby("book_id").size().mean()), 2),
        "ratings_per_book_median": int(ratings.groupby("book_id").size().median())
    }
    
    with open(os.path.join(ARTIFACTS_DIR, "dataset_stats.json"), "w") as f:
        json.dump(sparsity_info, f, indent=2)
    print("[5/5] Preprocessing and dataset statistics complete!")
    print(json.dumps(sparsity_info, indent=2))
    
    return train_ratings, test_ratings, sparsity_info

if __name__ == "__main__":
    process_books_and_tags()
    process_ratings_and_split()
