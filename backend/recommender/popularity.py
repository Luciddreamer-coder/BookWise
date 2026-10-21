"""Model 1: Popularity-Based Recommender (Baseline).

Implements the IMDB weighted rating formula:
    WR = (v / (v + m)) * R + (m / (v + m)) * C

Where:
    v = number of ratings for the book (ratings_count)
    m = minimum ratings required to be listed (percentile threshold, e.g. 85th)
    R = average rating of the book (average_rating)
    C = mean rating across the entire catalog

Purpose:
- Handles new users with 0 ratings (Cold-Start solution).
- Provides solid, unpersonalized baseline recommendations.
- Supports genre-filtered trending/popular shelves.
"""

import os
import pandas as pd
import numpy as np

PROCESSED_BOOKS_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../data/processed/books_clean.csv")
)

class PopularityRecommender:
    def __init__(self, books_df: pd.DataFrame = None):
        if books_df is not None:
            self.books = books_df.copy()
        elif os.path.exists(PROCESSED_BOOKS_PATH):
            self.books = pd.read_csv(PROCESSED_BOOKS_PATH)
        else:
            self.books = pd.DataFrame()
            
        if not self.books.empty:
            self._compute_parameters()

    def _compute_parameters(self):
        """Compute catalog mean C and minimum ratings threshold m."""
        self.C = self.books["average_rating"].mean()
        self.m = self.books["ratings_count"].quantile(0.85)
        
        # Calculate weighted rating for every book if not present
        if "weighted_rating" not in self.books.columns:
            def wr(row):
                v = row["ratings_count"]
                R = row["average_rating"]
                return (v / (v + self.m) * R) + (self.m / (v + self.m) * self.C)
            self.books["weighted_rating"] = self.books.apply(wr, axis=1)
            
        self.sorted_books = self.books.sort_values("weighted_rating", ascending=False)

    def get_top_n(self, n: int = 10, genre: str = None, min_year: int = None, max_year: int = None):
        """Retrieve top N books by weighted rating, optionally filtered by genre or era."""
        df = self.sorted_books
        
        if genre and genre.lower() != "all":
            df = df[df["primary_genre"].str.lower() == genre.lower()]
            
        if min_year:
            df = df[df["original_publication_year"] >= min_year]
        if max_year:
            df = df[df["original_publication_year"] <= max_year]
            
        results = []
        for _, row in df.head(n).iterrows():
            item = row.to_dict()
            item["score"] = round(float(row["weighted_rating"]), 3)
            item["algorithm"] = "Popularity Baseline (IMDB Weighted Rating)"
            item["explanation"] = f"Top-ranked book with {row['ratings_count']:,} ratings and {row['average_rating']:.2f}★ average."
            results.append(item)
            
        return results

    def get_trending(self, n: int = 10):
        """Trending books: balancing high ratings count and recent publication or high engagement."""
        # Engaged books with strong modern presence
        modern = self.sorted_books[self.sorted_books["original_publication_year"] >= 2000]
        if len(modern) < n:
            modern = self.sorted_books
        return self.get_top_n(n=n)

    def get_hidden_gems(self, n: int = 10, max_ratings: int = 80000, min_rating: float = 4.2):
        """Find exceptionally high-rated books that are less mainstream."""
        gems = self.books[
            (self.books["average_rating"] >= min_rating) & 
            (self.books["ratings_count"] <= max_ratings) & 
            (self.books["ratings_count"] >= 5000)
        ].sort_values("average_rating", ascending=False)
        
        results = []
        for _, row in gems.head(n).iterrows():
            item = row.to_dict()
            item["score"] = round(float(row["average_rating"]), 3)
            item["algorithm"] = "Hidden Gem Discovery"
            item["explanation"] = f"Exceptional {row['average_rating']:.2f}★ rating from dedicated readers."
            results.append(item)
        return results
