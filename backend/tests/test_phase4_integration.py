"""Factory-level cookie, discovery and reader integration on disposable data."""
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import create_app
from backend.config import Config
from backend import database
from backend.models.database_models import Book
from backend.tests.test_paths import temporary_test_directory


class PhaseFourIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = temporary_test_directory(prefix="bookwise-phase4-")

        class TestConfig(Config):
            TESTING = True
            SECRET_KEY = "isolated-integration-key-not-for-production"
            SQLALCHEMY_DATABASE_URI = "sqlite:///" + str(Path(self.tmp.name) / "phase4.db")
            CORS_ORIGINS = ["http://localhost:5188"]
            AUTH_COOKIE_SECURE = False

            @classmethod
            def validate(cls):
                pass

        with patch.object(Config, "BOOKS_CSV", ""):
            self.app = create_app(TestConfig)
        with database.SessionLocal() as db:
            db.add_all(Book(book_id=i, title=f"Integration book {i}", authors=f"Writer {i % 4}",
                            primary_genre="Fantasy", top_tags="magic,adventure", average_rating=4.2,
                            weighted_rating=4.1, ratings_count=i * 50) for i in range(1, 31))
            db.commit()
        self.client = self.app.test_client()
        response = self.client.post("/api/auth/register", json={"username": "integration", "password": "test-password-123"})
        self.assertEqual(response.status_code, 201)
        self.user_id = response.get_json()["user"]["id"]

    def tearDown(self):
        database.SessionLocal.remove()
        database.engine.dispose()
        self.tmp.cleanup()

    def test_cookie_reader_discovery_and_public_share_flow(self):
        # No Authorization header: all private requests use the issued cookie.
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)
        self.assertEqual(self.client.put("/api/reader/books/1/progress", json={"percent": 25}).status_code, 200)
        continued = self.client.get("/api/discovery/feed?mode=continue_reading").get_json()
        self.assertEqual([book["book_id"] for book in continued["recommendations"]], [1])
        self.assertIn("25%", continued["recommendations"][0]["explanation"])
        self.assertEqual(self.client.post("/api/reader/authors", json={"author": "Writer 2"}).status_code, 200)
        authors = self.client.get("/api/discovery/feed?mode=favorite_author").get_json()
        self.assertTrue(authors["recommendations"])
        self.assertTrue(all(book["authors"] == "Writer 2" for book in authors["recommendations"]))
        self.client.post("/api/reader/books/1/notes", json={"kind": "note", "text": "PRIVATE integration note"})
        saved = self.client.post("/api/reader/lists", json={"title": "Public collection", "book_ids": [1, 2]}).get_json()
        token = self.client.post(f"/api/reader/lists/{saved['id']}/share").get_json()["share_token"]
        guest = self.app.test_client()
        response = guest.get(f"/api/reader/shared/{token}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["books"]), 2)
        self.assertNotIn("PRIVATE", response.get_data(as_text=True))
        self.assertEqual(guest.get("/api/reader/books/1").status_code, 401)
        self.client.delete(f"/api/reader/lists/{saved['id']}/share")
        self.assertEqual(guest.get(f"/api/reader/shared/{token}").status_code, 404)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/discovery/preferences").status_code, 401)

    def test_cookie_writes_reject_untrusted_origins_and_form_bodies(self):
        path = "/api/reader/books/1/progress"
        response = self.client.put(path, json={"percent": 20}, headers={"Origin": "https://attacker.invalid"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.post("/api/auth/logout", headers={"Origin": "https://attacker.invalid"}).status_code, 403)
        self.assertEqual(self.client.put(path, data={"percent": "20"}).status_code, 415)
        self.assertEqual(self.client.put(path, json={"percent": 20}, headers={"Origin": "http://localhost:5188"}).status_code, 200)
        self.assertEqual(self.client.get("/api/discovery/preferences").headers["Cache-Control"], "no-store")

    def test_login_limit_cannot_be_bypassed_with_arbitrary_tokens(self):
        self.app.config["RATE_LIMIT_LOGIN_MAX"] = 1
        guest = self.app.test_client()
        self.assertEqual(guest.post("/api/auth/login", json={}, headers={"Authorization": "Bearer random-one"}).status_code, 401)
        response = guest.post("/api/auth/login", json={}, headers={"Authorization": "Bearer random-two"})
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)


if __name__ == "__main__":
    unittest.main()
