"""Isolated reader API checks. Never create the main app or touch its database."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from flask import Flask
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import scoped_session, sessionmaker

from backend.auth import create_access_token
from backend.models.database_models import Base, Book, ReadingListItem, User
from backend.models.reader_models import FollowedAuthor, ReaderList, ReaderNote, ReaderShelf, ReadingProgress
from backend.routes.reader import reader_bp
from backend.tests.test_paths import temporary_test_directory


class TestReaderAPI(unittest.TestCase):
    def setUp(self):
        self.tempdir = temporary_test_directory(prefix="bookwise-reader-test-")
        self.engine = create_engine("sqlite:///" + str(Path(self.tempdir.name) / "reader.db"),
                                    connect_args={"check_same_thread": False})

        @event.listens_for(self.engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.sessions = scoped_session(sessionmaker(bind=self.engine, autoflush=False))
        self.auth_patch = patch("backend.auth.SessionLocal", self.sessions)
        self.route_patch = patch("backend.routes.reader.SessionLocal", self.sessions)
        self.auth_patch.start()
        self.route_patch.start()
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SECRET_KEY="isolated-reader-test", AUTH_COOKIE_NAME="reader_token",
                               AUTH_TOKEN_MAX_AGE=3600, RATE_LIMIT_READER_MUTATION_MAX=1000,
                               RATE_LIMIT_READER_USER_MAX=1000)
        self.app.register_blueprint(reader_bp, url_prefix="/api")
        self.client = self.app.test_client()
        with self.sessions() as db:
            users = [User(id=1, username="alice", email="private@example.test"), User(id=2, username="bob")]
            db.add_all(users)
            db.add_all([Book(book_id=i, title=f"Book {i}", authors="Author One", average_rating=4) for i in (1, 2, 3)])
            db.commit()
            with self.app.app_context():
                self.headers = {i: {"Authorization": f"Bearer {create_access_token(user)}"} for i, user in enumerate(users, 1)}

    def tearDown(self):
        self.sessions.remove()
        self.auth_patch.stop()
        self.route_patch.stop()
        self.engine.dispose()
        self.tempdir.cleanup()

    def call(self, method, path, data=None, user=1, status=200):
        response = self.client.open("/api/reader" + path, method=method, json=data,
                                    headers=self.headers[user] if user else {})
        self.assertEqual(response.status_code, status, response.get_data(as_text=True))
        return response.get_json()

    def test_all_private_routes_require_authentication(self):
        endpoints = [
            ("GET", "/books/1"), ("PUT", "/books/1/progress"), ("GET", "/progress"),
            ("POST", "/books/1/notes"), ("DELETE", "/notes/1"),
            ("PUT", "/books/1/review"), ("DELETE", "/books/1/review"),
            ("POST", "/books/1/comments"), ("DELETE", "/comments/1"),
            ("GET", "/shelves"), ("POST", "/shelves"), ("PATCH", "/shelves/1"),
            ("DELETE", "/shelves/1"), ("PUT", "/shelves/1/books/1"), ("DELETE", "/shelves/1/books/1"),
            ("GET", "/authors"), ("POST", "/authors"), ("DELETE", "/authors"),
            ("GET", "/lists"), ("POST", "/lists"), ("DELETE", "/lists/1"),
            ("POST", "/lists/1/share"), ("DELETE", "/lists/1/share"),
        ]
        for method, path in endpoints:
            with self.subTest(method=method, path=path):
                self.call(method, path, {}, user=None, status=401)

    def test_workspace_defaults_and_unknown_books(self):
        state = self.call("GET", "/books/1")
        self.assertEqual(state, {"progress": {"percent": 0, "current_page": None, "total_pages": None},
                                 "notes": [], "review": None, "followed_authors": [], "shelves": [],
                                 "comments": [], "reviews": []})
        for method, path, data in [
            ("GET", "/books/999", None), ("PUT", "/books/999/progress", {"percent": 20}),
            ("POST", "/books/999/notes", {"kind": "note", "text": "hello"}),
            ("PUT", "/books/999/review", {"text": "hello"}),
            ("POST", "/books/999/comments", {"text": "hello"}),
        ]:
            self.call(method, path, data, status=404)

    def test_progress_round_trip_reading_status_and_isolation(self):
        self.call("PUT", "/books/1/progress", {"current_page": 25, "total_pages": 100})
        self.assertEqual(self.call("GET", "/books/1")["progress"]["percent"], 25)
        with self.sessions() as db:
            self.assertEqual(db.query(ReadingListItem).one().status, "currently_reading")
        self.call("PUT", "/books/1/progress", {"percent": 100, "current_page": 100, "total_pages": 100})
        with self.sessions() as db:
            self.assertEqual(db.query(ReadingListItem).one().status, "read")
            self.assertEqual(db.query(ReadingProgress).count(), 1)
        rows = self.call("GET", "/progress")["progress"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["book"]["book_id"], 1)
        self.assertTrue(rows[0]["updated_at"].endswith("+00:00"))
        self.assertEqual(self.call("GET", "/progress", user=2)["progress"], [])
        self.assertEqual(self.call("GET", "/books/1", user=2)["progress"]["percent"], 0)
        self.call("PUT", "/books/1/progress", {"percent": 40})
        self.assertIsNone(self.call("GET", "/books/1")["progress"]["total_pages"])

    def test_progress_invalid_numbers_and_inconsistent_pages(self):
        invalid = [
            {}, {"percent": True}, {"percent": "10"}, {"percent": -1}, {"percent": 101}, {"percent": 10 ** 1000},
            {"percent": float("nan")}, {"percent": float("inf")}, {"percent": -float("inf")},
            {"percent": 50, "current_page": 1}, {"current_page": 1, "total_pages": 0},
            {"current_page": -1, "total_pages": 100}, {"current_page": 101, "total_pages": 100},
            {"current_page": 1.5, "total_pages": 100}, {"current_page": True, "total_pages": 100},
            {"percent": 90, "current_page": 10, "total_pages": 100},
            {"percent": 100, "current_page": 999, "total_pages": 1000},
            {"percent": 99.9, "current_page": 1000, "total_pages": 1000},
            {"current_page": 0, "total_pages": 100001},
        ]
        for data in invalid:
            with self.subTest(data=data):
                self.call("PUT", "/books/1/progress", data, status=400)
        self.assertEqual(self.call("GET", "/progress")["progress"], [])
        self.call("PUT", "/books/1/progress", {"percent": 33.3, "current_page": 1, "total_pages": 3})

    def test_notes_quotes_plain_text_and_owner_deletion(self):
        text = '<script>alert("literal text")</script>'
        note = self.call("POST", "/books/1/notes", {"kind": "note", "text": text, "page": 12}, status=201)["note"]
        quote = self.call("POST", "/books/1/notes", {"kind": "quote", "text": "A quotation"}, status=201)["note"]
        self.assertEqual(note["text"], text)
        self.assertIsNone(quote["page"])
        self.assertEqual(len(self.call("GET", "/books/1")["notes"]), 2)
        self.assertEqual(self.call("GET", "/books/1", user=2)["notes"], [])
        self.call("DELETE", f"/notes/{note['id']}", user=2, status=404)
        self.call("DELETE", f"/notes/{note['id']}")
        self.call("DELETE", f"/notes/{quote['id']}")
        self.assertEqual(self.call("GET", "/books/1")["notes"], [])

    def test_reviews_publication_privacy_and_deletion(self):
        review = self.call("PUT", "/books/1/review", {"text": "Private thoughts"})["review"]
        self.assertEqual(review["visibility"], "private")
        other = self.call("GET", "/books/1", user=2)
        self.assertIsNone(other["review"])
        self.assertEqual(other["reviews"], [])
        self.call("PUT", "/books/1/review", {"text": "Public thoughts", "visibility": "public"})
        public = self.call("GET", "/books/1", user=2)["reviews"]
        self.assertEqual(public, [{"id": review["id"], "text": "Public thoughts", "username": "alice", "user_id": 1}])
        self.call("DELETE", "/books/1/review", user=2, status=404)
        self.call("PUT", "/books/1/review", {"text": "Private again", "visibility": "private"})
        self.assertEqual(self.call("GET", "/books/1", user=2)["reviews"], [])
        self.call("DELETE", "/books/1/review")
        self.assertIsNone(self.call("GET", "/books/1")["review"])

    def test_public_comments_and_owner_deletion(self):
        comment = self.call("POST", "/books/1/comments", {"text": "A public comment"}, status=201)["comment"]
        self.assertEqual(self.call("GET", "/books/1", user=2)["comments"], [comment])
        self.call("DELETE", f"/comments/{comment['id']}", user=2, status=404)
        self.call("DELETE", f"/comments/{comment['id']}")
        self.assertEqual(self.call("GET", "/books/1")["comments"], [])

    def test_shelf_crud_membership_duplicate_names_and_isolation(self):
        shelf = self.call("POST", "/shelves", {"name": "Favorites"}, status=201)["shelf"]
        sid = shelf["id"]
        self.assertEqual(shelf["books"], [])
        self.call("POST", "/shelves", {"name": " favorites "}, status=409)
        self.call("POST", "/shelves", {"name": "Favorites"}, user=2, status=201)
        self.call("PUT", f"/shelves/{sid}/books/1")
        self.call("PUT", f"/shelves/{sid}/books/1")
        self.call("PUT", f"/shelves/{sid}/books/999", status=404)
        self.call("PATCH", f"/shelves/{sid}", {"name": "Weekend"})
        self.assertEqual(self.call("GET", "/shelves")["shelves"][0]["book_ids"], [1])
        self.assertEqual(self.call("GET", "/books/1")["shelves"], [{"id": sid, "name": "Weekend"}])
        self.assertEqual(self.call("GET", "/books/1", user=2)["shelves"], [])
        for method, path, data in [
            ("PATCH", f"/shelves/{sid}", {"name": "Stolen"}), ("DELETE", f"/shelves/{sid}", None),
            ("PUT", f"/shelves/{sid}/books/2", None), ("DELETE", f"/shelves/{sid}/books/1", None),
        ]:
            self.call(method, path, data, user=2, status=404)
        self.call("DELETE", f"/shelves/{sid}/books/1")
        self.assertEqual(self.call("GET", "/shelves")["shelves"][0]["book_ids"], [])
        self.call("PUT", f"/shelves/{sid}/books/2")
        self.call("DELETE", f"/shelves/{sid}")
        self.assertEqual(self.call("GET", "/shelves")["shelves"], [])

    def test_following_idempotence_and_isolation(self):
        self.assertEqual(self.call("POST", "/authors", {"author": "Author One"})["authors"], ["Author One"])
        self.call("POST", "/authors", {"author": "author one"})
        self.assertEqual(self.call("GET", "/authors")["authors"], ["Author One"])
        self.assertEqual(self.call("GET", "/books/1")["followed_authors"], ["Author One"])
        self.assertEqual(self.call("GET", "/authors", user=2)["authors"], [])
        self.call("DELETE", "/authors", {"author": "Author One"}, user=2)
        with self.sessions() as db:
            self.assertEqual(db.query(FollowedAuthor).one().user_id, 1)
        self.call("DELETE", "/authors", {"author": "AUTHOR ONE"})
        self.assertEqual(self.call("GET", "/authors")["authors"], [])

    def test_list_creation_publication_revocation_and_deletion(self):
        self.call("POST", "/books/1/notes", {"kind": "note", "text": "secret note"}, status=201)
        self.call("PUT", "/books/1/review", {"text": "secret review"})
        row = self.call("POST", "/lists", {"title": "Recommended", "book_ids": [2, 1]}, status=201)
        lid = row["id"]
        self.assertIsNone(row["share_token"])
        self.assertEqual(self.call("GET", "/lists")["lists"], [row])
        self.assertEqual(self.call("GET", "/lists", user=2)["lists"], [])
        self.call("GET", f"/shared/{lid}", user=None, status=404)
        for method, path in [("POST", f"/lists/{lid}/share"), ("DELETE", f"/lists/{lid}/share"), ("DELETE", f"/lists/{lid}")]:
            self.call(method, path, user=2, status=404)
        token = self.call("POST", f"/lists/{lid}/share")["share_token"]
        self.assertEqual(len(token), 43)
        shared = self.call("GET", f"/shared/{token}", user=None)
        self.assertEqual(set(shared), {"title", "books"})
        self.assertEqual([book["book_id"] for book in shared["books"]], [2, 1])
        self.assertEqual(set(shared["books"][0]), {"book_id", "title", "authors", "image_url", "small_image_url",
                                                   "average_rating", "primary_genre", "original_publication_year"})
        self.assertNotIn("secret", str(shared))
        self.assertNotIn("private@example.test", str(shared))
        self.call("DELETE", f"/lists/{lid}/share")
        self.call("GET", f"/shared/{token}", user=None, status=404)
        new_token = self.call("POST", f"/lists/{lid}/share")["share_token"]
        self.assertNotEqual(token, new_token)
        self.call("GET", f"/shared/{token}", user=None, status=404)
        self.call("DELETE", f"/lists/{lid}")
        self.call("GET", f"/shared/{new_token}", user=None, status=404)
        self.assertEqual(self.call("GET", "/lists")["lists"], [])

    def test_validation_limits_and_atomic_rejection(self):
        invalid = [
            ("POST", "/shelves", {"name": ""}), ("POST", "/shelves", {"name": "n" * 101}),
            ("POST", "/authors", {"author": "a" * 201}),
            ("POST", "/books/1/notes", {"kind": "html", "text": "test"}),
            ("POST", "/books/1/notes", {"kind": "note", "text": "test", "page": -1}),
            ("POST", "/books/1/notes", {"kind": "note", "text": "x" * 5001}),
            ("POST", "/books/1/notes", {"kind": "note", "text": "bad\x00text"}),
            ("POST", "/books/1/comments", {"text": "x" * 2001}),
            ("POST", "/books/1/comments", {"text": []}),
            ("PUT", "/books/1/review", {"text": "x" * 10001}),
            ("PUT", "/books/1/review", {"text": "x", "visibility": "friends"}),
            ("POST", "/lists", {"title": "test", "book_ids": []}),
            ("POST", "/lists", {"title": "test", "book_ids": [1] * 101}),
            ("POST", "/lists", {"title": "test", "book_ids": [1, 1]}),
            ("POST", "/lists", {"title": "test", "book_ids": [True]}),
            ("POST", "/lists", {"title": "test", "book_ids": ["1"]}),
            ("POST", "/shelves", []), ("POST", "/shelves", "name"),
        ]
        for method, path, data in invalid:
            with self.subTest(path=path, data=data):
                self.call(method, path, data, status=400)
        self.call("POST", "/lists", {"title": "test", "book_ids": [1, 999]}, status=404)
        self.assertEqual(self.call("GET", "/lists")["lists"], [])
        self.call("POST", "/lists", {"title": "Unique", "book_ids": [1]}, status=201)
        self.call("POST", "/lists", {"title": "unique", "book_ids": [2]}, status=409)
        self.assertEqual(len(self.call("GET", "/lists")["lists"]), 1)
        self.call("POST", "/shelves", {"name": "Spoofed", "user_id": 2}, status=403)

    def test_database_constraints_prevent_duplicate_concurrent_records(self):
        # Bypass route prechecks, as a competing transaction would: the database
        # itself must enforce uniqueness and leave the existing row intact.
        self.call("POST", "/shelves", {"name": "Unique"}, status=201)
        self.call("PUT", "/books/1/progress", {"percent": 10})
        for duplicate in [ReaderShelf(user_id=1, name="unique", name_key="unique"),
                          ReadingProgress(user_id=1, book_id=1, percent=20)]:
            with self.sessions() as db:
                db.add(duplicate)
                with self.assertRaises(IntegrityError):
                    db.commit()
                db.rollback()
        self.assertEqual(self.call("GET", "/books/1")["progress"]["percent"], 10)

    def test_rate_limits_json_headers_and_rejected_write(self):
        self.app.config["RATE_LIMIT_READER_USER_MAX"] = 1
        self.call("POST", "/shelves", {"name": "First"}, status=201)
        response = self.client.post("/api/reader/shelves", json={"name": "Second"}, headers=self.headers[1])
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.get_json()["error"]["code"], "rate_limited")
        self.assertIn("Retry-After", response.headers)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.call("POST", "/shelves", {"name": "Other user"}, user=2, status=201)
        self.assertEqual(len(self.call("GET", "/shelves")["shelves"]), 1)

    def test_oversized_route_identifiers_are_clean_validation_errors(self):
        huge = str(10 ** 100)
        for method, path in [("GET", f"/books/{huge}"), ("DELETE", f"/notes/{huge}"),
                             ("DELETE", f"/books/{huge}/review"), ("DELETE", f"/shelves/{huge}"),
                             ("POST", f"/lists/{huge}/share")]:
            self.call(method, path, status=400)

    def test_followed_author_can_be_created_with_contract_fields(self):
        with self.sessions() as db:
            db.add(FollowedAuthor(user_id=1, author="Author Two"))
            db.commit()
        self.assertEqual(self.call("GET", "/authors")["authors"], ["Author Two"])
        self.call("DELETE", "/authors", {"author": "author two"})
        self.assertEqual(self.call("GET", "/authors")["authors"], [])

    def test_simultaneous_creates_preserve_database_integrity(self):
        barrier = Barrier(2)

        def create_same_shelf(_):
            try:
                with self.app.test_client() as client:
                    barrier.wait(timeout=10)
                    response = client.post("/api/reader/shelves", json={"name": "Concurrent"}, headers=self.headers[1])
                    return response.status_code
            finally:
                self.sessions.remove()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(create_same_shelf, range(2)))
        self.assertEqual(sorted(statuses), [201, 409])
        self.assertEqual(len(self.call("GET", "/shelves")["shelves"]), 1)


if __name__ == "__main__":
    unittest.main()
