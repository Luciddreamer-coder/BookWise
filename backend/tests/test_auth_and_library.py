import time
import unittest

from backend.app import create_app
from backend.rate_limit import InMemoryRateLimiter


class TestAuthenticatedLibraryAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config["TESTING"] = True
        cls.client = cls.app.test_client()
        username = f"library_test_{time.time_ns()}"
        response = cls.client.post(
            "/api/auth/register",
            json={"username": username, "email": f"{username}@example.com", "password": "test-pass-123"},
        )
        assert response.status_code == 201
        payload = response.get_json()
        cls.user_id = payload["user"]["id"]
        cls.headers = {"Authorization": f"Bearer {payload['token']}"}

    def test_authentication_and_ownership(self):
        unauthenticated = self.app.test_client()
        self.assertEqual(unauthenticated.get(f"/api/users/{self.user_id}/ratings").status_code, 401)
        self.assertEqual(
            self.client.get(f"/api/users/{self.user_id}/ratings", headers=self.headers).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(f"/api/users/{self.user_id + 1}/ratings", headers=self.headers).status_code,
            403,
        )

    def test_login_and_json_api_errors(self):
        response = self.client.post(
            "/api/auth/login",
            json={"username": "does-not-exist", "password": "wrong-password"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "invalid_credentials")
        missing = self.client.get("/api/does-not-exist")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.get_json()["error"]["code"], "not_found")

    def test_duplicate_registration_returns_conflict(self):
        duplicate_username = self.client.post(
            "/api/auth/register",
            json={"username": "library_test_duplicate", "email": "unique-duplicate@example.com", "password": "test-pass-123"},
        )
        if duplicate_username.status_code == 201:
            duplicate_username = self.client.post(
                "/api/auth/register",
                json={"username": "library_test_duplicate", "email": "another@example.com", "password": "test-pass-123"},
            )
        self.assertEqual(duplicate_username.status_code, 409)
        self.assertEqual(duplicate_username.get_json()["error"]["code"], "conflict")

    def test_auth_cookie_is_httponly_and_works_without_bearer_header(self):
        response = self.client.post(
            "/api/auth/login",
            json={"username": self.client.get("/api/auth/me", headers=self.headers).get_json()["user"]["username"], "password": "test-pass-123"},
        )
        self.assertEqual(response.status_code, 200)
        cookie = response.headers.get("Set-Cookie", "")
        self.assertIn("HttpOnly", cookie)
        cookie_client = self.app.test_client()
        cookie_client.set_cookie("bookwise_access_token", response.get_json()["token"])
        self.assertEqual(cookie_client.get("/api/auth/me").status_code, 200)

    def test_rate_limits_login_registration_feedback_and_rating(self):
        keys = ("LOGIN", "REGISTER", "FEEDBACK", "RATING")
        original = {key: self.app.config[f"RATE_LIMIT_{key}_MAX"] for key in keys}
        try:
            for key in keys:
                self.app.config[f"RATE_LIMIT_{key}_MAX"] = 1
            self.app.extensions["bookwise_rate_limiter"] = InMemoryRateLimiter()
            client = self.app.test_client()
            self.assertEqual(client.post("/api/auth/login", json={}).status_code, 401)
            self.assertEqual(client.post("/api/auth/login", json={}).status_code, 429)
            self.assertEqual(client.post("/api/auth/register", json={}).status_code, 400)
            self.assertEqual(client.post("/api/auth/register", json={}).status_code, 429)
            self.assertEqual(client.post("/api/feedback", json={}).status_code, 401)
            self.assertEqual(client.post("/api/feedback", json={}).status_code, 429)
            self.assertEqual(client.post("/api/ratings", json={}).status_code, 401)
            self.assertEqual(client.post("/api/ratings", json={}).status_code, 429)
        finally:
            for key, value in original.items():
                self.app.config[f"RATE_LIMIT_{key}_MAX"] = value
            self.app.extensions["bookwise_rate_limiter"] = InMemoryRateLimiter()

    def test_invalid_book_ids_return_consistent_not_found_errors(self):
        for endpoint, payload in (
            ("/api/ratings", {"book_id": 999999, "rating": 4}),
            ("/api/favorites", {"book_id": 999999}),
            ("/api/reading-list", {"book_id": 999999, "status": "read"}),
        ):
            response = self.client.post(endpoint, json=payload, headers=self.headers)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.get_json()["error"]["code"], "not_found")

    def test_favorite_toggle(self):
        first = self.client.post("/api/favorites", json={"book_id": 1}, headers=self.headers)
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.get_json()["is_favorite"])
        second = self.client.post("/api/favorites", json={"book_id": 1}, headers=self.headers)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.get_json()["is_favorite"])

    def test_reading_list_transitions_and_filters(self):
        for status in ("want_to_read", "currently_reading", "read"):
            response = self.client.post(
                "/api/reading-list",
                json={"book_id": 2, "status": status},
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["status"], status)
            filtered = self.client.get(
                f"/api/users/{self.user_id}/reading-list?status={status}",
                headers=self.headers,
            )
            self.assertEqual(filtered.status_code, 200)
            self.assertEqual(filtered.get_json()["count"], 1)
        invalid = self.client.get(
            f"/api/users/{self.user_id}/reading-list?status=unknown",
            headers=self.headers,
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.get_json()["error"]["code"], "validation_error")
        removed = self.client.post(
            "/api/reading-list", json={"book_id": 2, "status": "remove"}, headers=self.headers
        )
        self.assertEqual(removed.status_code, 200)
        self.assertIsNone(removed.get_json()["status"])

    def test_mismatched_user_id_cannot_mutate(self):
        response = self.client.post(
            "/api/favorites",
            json={"user_id": self.user_id + 1, "book_id": 1},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"]["code"], "forbidden")


if __name__ == "__main__":
    unittest.main()
