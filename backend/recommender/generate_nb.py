import json
import os

notebook_data = {
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "# BookWise — Machine Learning Book Recommendation Platform\n",
    "## Phase 1 & 2: Exploratory Data Analysis, Sparsity Analysis & Algorithm Evaluation\n",
    "\n",
    "**Author:** BookWise Engineering & ML Research  \n",
    "**Dataset:** Goodbooks-10k (~10,000 books, ~6 million ratings, 53,424 users)  \n",
    "\n",
    "---\n",
    "### Abstract & Objectives\n",
    "1. **Exploratory Data Analysis**: Inspect data types, distributions, missing values, and book-user interactions.\n",
    "2. **Sparsity Analysis**: Empirically evaluate the density and sparsity of the user-item interaction matrix.\n",
    "3. **Model 1: Popularity Baseline**: Implement IMDB weighted rating formula $WR = \\frac{v}{v+m}R + \\frac{m}{v+m}C$.\n",
    "4. **Model 2: Content-Based Filtering**: Construct metadata soup, TF-IDF vectorization, and cosine similarity.\n",
    "5. **Model 3: Collaborative Filtering**: Latent factor matrix factorization using Truncated SVD.\n",
    "6. **Model 4: Hybrid Recommender**: Ensembled ranking with cold-start gating and explainability."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "import os\n",
    "import numpy as np\n",
    "import pandas as pd\n",
    "import matplotlib.pyplot as plt\n",
    "from sklearn.feature_extraction.text import TfidfVectorizer\n",
    "from sklearn.metrics.pairwise import linear_kernel\n",
    "from scipy.sparse import csr_matrix\n",
    "from sklearn.decomposition import TruncatedSVD\n",
    "\n",
    "DATA_DIR = '../data/raw'\n",
    "PROCESSED_DIR = '../data/processed'\n",
    "print('Data paths configured successfully.')"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 1. Inspecting the Datasets\n",
    "Let's load `books.csv`, `ratings.csv`, `tags.csv`, and `book_tags.csv`."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "books = pd.read_csv(os.path.join(DATA_DIR, 'books.csv'))\n",
    "ratings = pd.read_csv(os.path.join(DATA_DIR, 'ratings.csv'))\n",
    "tags = pd.read_csv(os.path.join(DATA_DIR, 'tags.csv'))\n",
    "book_tags = pd.read_csv(os.path.join(DATA_DIR, 'book_tags.csv'))\n",
    "\n",
    "print(f'Books count: {len(books):,}')\n",
    "print(f'Ratings count: {len(ratings):,}')\n",
    "print(f'Tags count: {len(tags):,}')\n",
    "print(f'Book-Tag associations: {len(book_tags):,}')"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 2. Sparsity Analysis of User-Item Matrix\n",
    "In recommendation systems, sparsity is a fundamental challenge.\n",
    "$$\\text{Sparsity (\\%)} = \\left(1 - \\frac{\\text{Total Ratings}}{\\text{Total Users} \\times \\text{Total Books}}\\right) \\times 100$$"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "n_users = ratings['user_id'].nunique()\n",
    "n_books = ratings['book_id'].nunique()\n",
    "n_ratings = len(ratings)\n",
    "total_cells = n_users * n_books\n",
    "sparsity = (1.0 - (n_ratings / total_cells)) * 100\n",
    "\n",
    "print(f'Total Users: {n_users:,}')\n",
    "print(f'Total Books: {n_books:,}')\n",
    "print(f'Total Non-Zero Ratings: {n_ratings:,}')\n",
    "print(f'Matrix Density: {(n_ratings / total_cells) * 100:.4f}%')\n",
    "print(f'Matrix Sparsity: {sparsity:.4f}%')\n",
    "print('\\nAcademic Implication: 98.88% sparsity confirms why pure collaborative filtering fails for cold-start users and requires content inductive bias.')"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 3. Rating Distribution & Descriptive Statistics"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "ratings_dist = ratings['rating'].value_counts().sort_index()\n",
    "print('Rating Distribution:')\n",
    "for r, count in ratings_dist.items():\n",
    "    pct = (count / n_ratings) * 100\n",
    "    print(f'  {r} Stars: {count:,} ({pct:.2f}%)')\n",
    "\n",
    "print(f'\\nGlobal Mean Rating: {ratings[\"rating\"].mean():.2f}')\n",
    "print(f'Median ratings per user: {ratings.groupby(\"user_id\").size().median():.0f}')\n",
    "print(f'Median ratings per book: {ratings.groupby(\"book_id\").size().median():.0f}')"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 4. Model 1: Popularity-Based Recommender (IMDB Weighted Rating)\n",
    "$$WR = \\frac{v}{v+m} R + \\frac{m}{v+m} C$$\n",
    "- $v$: ratings count for the book\n",
    "- $m$: 85th percentile minimum votes threshold\n",
    "- $R$: average rating of the book\n",
    "- $C$: global mean rating"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "C = books['average_rating'].mean()\n",
    "m = books['ratings_count'].quantile(0.85)\n",
    "print(f'Global Mean C = {C:.2f}')\n",
    "print(f'Minimum Votes Threshold m = {m:,.0f}')\n",
    "\n",
    "def weighted_rating(x, m=m, C=C):\n",
    "    v = x['ratings_count']\n",
    "    R = x['average_rating']\n",
    "    return (v / (v + m) * R) + (m / (v + m) * C)\n",
    "\n",
    "books['weighted_rating'] = books.apply(weighted_rating, axis=1)\n",
    "top_popular = books.sort_values('weighted_rating', ascending=False)[['title', 'authors', 'average_rating', 'ratings_count', 'weighted_rating']].head(10)\n",
    "top_popular"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 5. Model 2: Content-Based Filtering (TF-IDF + Cosine Similarity)\n",
    "We compute cosine similarity over the metadata soup (title, author tokens, genre, and filtered descriptive tags)."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "# Preprocessed clean books with metadata soup\n",
    "books_clean = pd.read_csv(os.path.join(PROCESSED_DIR, 'books_clean.csv'))\n",
    "print('Sample metadata soup:')\n",
    "print(books_clean[['title', 'metadata_soup']].head(3).to_dict(orient='records'))\n",
    "\n",
    "tfidf = TfidfVectorizer(stop_words='english', max_features=5000)\n",
    "tfidf_mat = tfidf.fit_transform(books_clean['metadata_soup'])\n",
    "print(f'TF-IDF vocabulary: {len(tfidf.get_feature_names_out()):,} terms')"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "## 6. Academic Evaluation Summary\n",
    "Evaluation metrics computed on held-out 20% test ratings."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "import json\n",
    "with open('../artifacts/evaluation_results.json') as f:\n",
    "    eval_data = json.load(f)\n",
    "\n",
    "metrics_df = pd.DataFrame(eval_data['metrics_summary']).T\n",
    "metrics_df"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "codemirror_mode": {
    "name": "ipython",
    "version": 3
   },
   "file_extension": ".py",
   "mimetype": "text/x-python",
   "name": "python",
   "nbformat": 4,
   "nbformat_minor": 2,
   "pygments_lexer": "ipython3",
   "version": "3.12.4"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 2
}

output_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../notebooks/01_data_exploration.ipynb"))
os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(notebook_data, f, indent=1)
print("Saved 01_data_exploration.ipynb successfully.")
