import unittest

from backend.app import create_app
from backend.database import SessionLocal
from backend.models.database_models import Rating, User
from backend.recommender.history import get_cached_user_history, history_cache_info


class TestRecommendationQuality(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config["TESTING"] = True
        cls.client = cls.app.test_client()
        username = "recommendation_quality_test"
        response = cls.client.post(
            "/api/auth/register",
            json={"username": username, "email": "recommendation_quality_test@example.com", "password": "test-pass-123"},
        )
        if response.status_code == 409:
            response = cls.client.post(
                "/api/auth/login",
                json={"username": username, "password": "test-pass-123"},
            )
        payload = response.get_json()
        cls.user_id = payload["user"]["id"]
        cls.headers = {"Authorization": f"Bearer {payload['token']}"}

    def test_query_validation_returns_json_4xx(self):
        for url in (
            "/api/recommendations/popular?n=abc",
            "/api/recommendations/user/1?alpha=1.5",
        ):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 400)
            self.assertIsInstance(response.get_json(), dict)
            self.assertIn("error", response.get_json())
        response = self.client.get("/api/recommendations/compare?book_id=nope", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_compare_uses_authenticated_token_identity(self):
        response = self.client.get(
            "/api/recommendations/compare?user_id=1&book_id=1&n=2",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["comparison_context"]["user_id"], self.user_id)

    def test_compare_uses_persisted_rating_history(self):
        user_id = self.user_id
        db = SessionLocal()
        try:
            if not db.query(User).filter(User.id == user_id).first():
                db.add(User(id=user_id, username="comparison_test", email="comparison_test@bookwise.lib"))
            if not db.query(Rating).filter(Rating.user_id == user_id, Rating.book_id == 1).first():
                db.add(Rating(user_id=user_id, book_id=1, rating=2.0))
            db.commit()
        finally:
            db.close()

        response = self.client.get(f"/api/recommendations/compare?user_id={user_id}&book_id=1&n=2", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["comparison_context"]["ratings_count"], 1)
        self.assertEqual(data["comparison_context"]["ratings_source"], "database_or_cached_training_history")

    def test_history_index_is_reused_and_recommendations_expose_quality_scores(self):
        first = get_cached_user_history(1)
        second = get_cached_user_history(1)
        self.assertEqual(first, second)
        self.assertTrue(history_cache_info()["loaded"])

        response = self.client.get(f"/api/recommendations/user/{self.user_id}?n=5&genre=Fantasy", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        recommendations = response.get_json()["recommendations"]
        for item in recommendations:
            self.assertIn("novelty_score", item)
            self.assertIn("diversity_score", item)

    def test_feed_supports_larger_recommendation_page(self):
        response = self.client.get(
            f"/api/recommendations/user/{self.user_id}?n=30",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(response.get_json()["recommendations"]), 30)

    def test_recommendation_response_is_strict_json(self):
        response = self.client.get(
            f"/api/recommendations/user/{self.user_id}?n=5",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(b"NaN", response.data)
        self.assertNotIn(b"Infinity", response.data)

    def test_feedback_endpoint_tracks_click(self):
        response = self.client.post(
            "/api/feedback",
            json={"user_id": self.user_id, "book_id": 1, "event_type": "click"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["event_type"], "click")

    def test_retrain_requires_authentication(self):
        response = self.app.test_client().post("/api/recommendations/retrain")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "authentication_required")


if __name__ == "__main__":
    unittest.main()
