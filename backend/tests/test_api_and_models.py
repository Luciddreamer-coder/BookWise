import unittest
import os
import json
import time
from backend.app import create_app
from backend.database import SessionLocal
from backend.models.database_models import Book, User, Rating
from backend.recommender.popularity import PopularityRecommender
from backend.recommender.content_based import ContentBasedRecommender
from backend.recommender.collaborative import CollaborativeRecommender
from backend.recommender.hybrid import HybridRecommender

class TestBookWiseBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config["TESTING"] = True
        cls.client = cls.app.test_client()

    def test_01_health_check(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["database"]["books_loaded"], 10000)

    def test_02_popularity_recommender(self):
        pop = PopularityRecommender()
        top10 = pop.get_top_n(n=10)
        self.assertEqual(len(top10), 10)
        self.assertGreaterEqual(top10[0]["weighted_rating"], top10[1]["weighted_rating"])

    def test_03_content_recommender(self):
        cb = ContentBasedRecommender()
        similar = cb.recommend_similar_books(book_id=1, n=5)
        self.assertGreater(len(similar), 0)
        self.assertIn("explanation", similar[0])

    def test_04_collaborative_recommender(self):
        cf = CollaborativeRecommender()
        pred = cf.predict_rating(user_id=1, book_id=1)
        self.assertTrue(1.0 <= pred <= 5.0)

    def test_05_hybrid_recommender(self):
        hybrid = HybridRecommender(alpha=0.5)
        recs = hybrid.recommend(user_id=1, user_ratings=[{"book_id": 1, "rating": 5.0}], n=5)
        self.assertEqual(len(recs), 5)
        self.assertIn("explanation", recs[0])

    def test_06_books_api(self):
        res = self.client.get("/api/books?limit=5")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(len(data["books"]), 5)
        self.assertEqual(data["total_books"], 10000)

    def test_07_book_detail_api(self):
        res = self.client.get("/api/books/1")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["book_id"], 1)
        self.assertIn("Hunger Games", data["title"])

    def test_08_evaluation_metrics_api(self):
        res = self.client.get("/api/evaluation/metrics")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("metrics_summary", data)
        self.assertIn("Hybrid Recommender", data["metrics_summary"])
        self.assertIn("sparsity_analysis", data)

    def test_09_user_rating_flow(self):
        username = f"legacy_test_{time.time_ns()}"
        auth = self.client.post(
            "/api/auth/register",
            json={"username": username, "email": f"{username}@example.com", "password": "test-pass-123"},
        )
        self.assertEqual(auth.status_code, 201)
        token = auth.get_json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        res = self.client.post("/api/ratings", json={"book_id": 42, "rating": 5.0}, headers=headers)
        self.assertEqual(res.status_code, 200)
        user_id = auth.get_json()["user"]["id"]
        res_list = self.client.get(f"/api/users/{user_id}/ratings", headers=headers)
        self.assertEqual(res_list.status_code, 200)
        data = res_list.get_json()
        self.assertTrue(any(r["book_id"] == 42 for r in data["ratings"]))

if __name__ == "__main__":
    unittest.main()
