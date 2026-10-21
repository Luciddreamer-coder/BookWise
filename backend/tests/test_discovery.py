"""Isolated discovery contract tests: never seed or mutate the application DB."""
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.auth import create_access_token
from backend.models.database_models import Base, Book, Favorite, FeedbackEvent, Rating, ReadingListItem, User
from backend.models.discovery_models import DiscoveryAssignment, DiscoveryEvent, RecommendationExposure
from backend.recommender.personalization import DEFAULT_PREFERENCES, choose_alpha, profile_for, rank_feed, retrieve_candidates
from backend.routes.discovery import discovery_bp
from backend.tests.test_paths import temporary_test_directory


class DiscoveryAPITest(unittest.TestCase):
    def setUp(self):
        self.tmp = temporary_test_directory(prefix="bookwise-discovery-")
        self.engine = create_engine("sqlite:///" + str(Path(self.tmp.name) / "isolated.db"))
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.patches = [patch("backend.routes.discovery.SessionLocal", self.sessions),
                        patch("backend.auth.SessionLocal", self.sessions)]
        for item in self.patches:
            item.start()
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SECRET_KEY="isolated-tests", AUTH_COOKIE_NAME="test_auth",
            AUTH_TOKEN_MAX_AGE=3600, RATE_LIMIT_DISCOVERY_FEED_MAX=1000,
            RATE_LIMIT_DISCOVERY_EVENTS_MAX=1000, RATE_LIMIT_DISCOVERY_PREFERENCES_MAX=1000)
        self.app.register_blueprint(discovery_bp, url_prefix="/api")
        self.client = self.app.test_client()
        with self.sessions() as db:
            users = [User(id=1, username="reader_one"), User(id=2, username="reader_two")]
            db.add_all(users)
            for number in range(1, 61):
                db.add(Book(book_id=number, title=f"Book {number}", authors=f"Author {number % 6}",
                    primary_genre="Fantasy" if number % 2 else "History",
                    top_tags="fantasy,magic" if number % 2 else "history,war",
                    original_publication_year=2023 if number % 3 else 1950,
                    average_rating=4.0 + (number % 5) / 10, weighted_rating=4.1,
                    ratings_count=number * 100, has_valid_cover=True))
            db.commit()
            with self.app.app_context():
                self.headers = {"Authorization": "Bearer " + create_access_token(users[0])}
                self.other_headers = {"Authorization": "Bearer " + create_access_token(users[1])}

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.engine.dispose()
        self.tmp.cleanup()

    def get(self, path, headers=None):
        return self.client.get("/api/discovery/" + path, headers=headers or self.headers)

    def put(self, data):
        return self.client.put("/api/discovery/preferences", json=data, headers=self.headers)

    def event(self, book_id, event_type, exposure_id=None, headers=None, **extra):
        body = {"book_id": book_id, "event_type": event_type, **extra}
        if exposure_id is not None:
            body["exposure_id"] = exposure_id
        return self.client.post("/api/discovery/events", json=body, headers=headers or self.headers)

    def test_authentication_all_routes(self):
        for path in ("preferences", "feed", "experiments"):
            self.assertEqual(self.client.get("/api/discovery/" + path).status_code, 401)
        self.assertEqual(self.client.post("/api/discovery/events", json={}).status_code, 401)

    def test_preferences_roundtrip_and_ownership(self):
        settings = {**DEFAULT_PREFERENCES, "favorite_genres": [" Fantasy ", "fantasy"], "disliked_genres": ["History"], "length": "short", "alpha": 0.75}
        result = self.put({"preferences": settings})
        self.assertEqual(result.status_code, 200)
        result = self.get("preferences").get_json()
        self.assertEqual(result["preferences"]["favorite_genres"], ["Fantasy"])
        self.assertEqual(result["preferences"]["alpha"], 0.75)
        self.assertFalse(result["capabilities"]["length_available"])
        self.assertEqual(self.get("preferences", self.other_headers).get_json()["preferences"], DEFAULT_PREFERENCES)
        self.assertIn("unavailable", self.get("feed").get_json()["notice"])

    def test_preferences_invalid_input(self):
        for payload in ([1], None, {"user_id": 2}, {"novelty": float("nan")}, {"alpha": float("inf")},
                        {"diversity": True}, {"alpha": -0.1}, {"alpha": 10 ** 500}, {"novelty": "0.5"}, {"length": []},
                        {"favorite_genres": ["x"] * 21}, {"favorite_genres": [""]},
                        {"favorite_genres": "Fantasy"}, {"favorite_genres": [None]},
                        {"favorite_genres": ["Fantasy"], "disliked_genres": ["FANTASY"]}, {"era": "future"}):
            with self.subTest(payload=payload):
                self.assertEqual(self.put(payload).status_code, 400)

    def test_feed_pagination_and_provenance(self):
        first = self.get("feed?limit=12").get_json()
        second = self.get("feed?offset=12&limit=12").get_json()
        whole = self.get("feed?limit=24").get_json()
        ids = lambda payload: [book["book_id"] for book in payload["recommendations"]]
        self.assertEqual(ids(first) + ids(second), ids(whole))
        self.assertTrue(first["has_more"])
        self.assertEqual(first["ratings_count"], 0)
        self.assertTrue(first["is_cold_start"])
        with self.sessions() as db:
            for book in first["recommendations"]:
                exposure = db.get(RecommendationExposure, book["exposure_id"])
                self.assertEqual(exposure.user_id, 1)
                self.assertEqual(exposure.book_id, book["book_id"])
                self.assertEqual(exposure.request_id, first["request_id"])
                self.assertTrue(book["explanation"])
                self.assertTrue(book["reasons"])
                self.assertNotIn("top 5%", book["explanation"])
        self.assertEqual(self.get("feed?offset=500").get_json()["recommendations"], [])

    def test_bad_queries(self):
        for query in ("limit=0", "offset=-1", "offset=501", "limit=51", "offset=1.5", "mode=bad", "user_id=2", "anchor_book_id=1"):
            self.assertEqual(self.get("feed?" + query).status_code, 400)

    def test_exposure_ownership_book_binding_and_deduplication(self):
        book = self.get("feed").get_json()["recommendations"][0]
        book_id, exposure_id = book["book_id"], book["exposure_id"]
        self.assertEqual(self.event(book_id, "impression", exposure_id, headers=self.other_headers).status_code, 404)
        self.assertEqual(self.event(1 if book_id != 1 else 2, "click", exposure_id).status_code, 404)
        self.assertEqual(self.event(book_id, "click", "invented").status_code, 404)
        for kind in ("impression", "click", "like", "save"):
            for _ in range(2):
                self.assertEqual(self.event(book_id, kind, exposure_id).status_code, 200)
        with self.sessions() as db:
            self.assertEqual(db.query(DiscoveryEvent).count(), 4)

    def test_feedback_excludes_book_and_is_user_scoped(self):
        book = self.get("feed").get_json()["recommendations"][0]
        self.assertEqual(self.event(book["book_id"], "not_interested", book["exposure_id"]).status_code, 200)
        self.assertNotIn(book["book_id"], [item["book_id"] for item in self.get("feed?limit=50").get_json()["recommendations"]])
        self.assertIn(book["book_id"], [item["book_id"] for item in self.get("feed?limit=50", self.other_headers).get_json()["recommendations"]])

    def test_event_validation_and_limits(self):
        for payload in ({}, {"book_id": True, "event_type": "click"}, {"book_id": 1, "event_type": []},
                        {"book_id": 1, "event_type": "rating"}, {"book_id": 1, "event_type": "rating", "value": 6},
                        {"book_id": 1, "event_type": "click", "value": float("nan")},
                        {"book_id": 1, "event_type": "click", "value": 10 ** 500},
                        {"book_id": 1, "event_type": "click", "exposure_id": 3}):
            self.assertEqual(self.client.post("/api/discovery/events", json=payload, headers=self.headers).status_code, 400)
        self.assertEqual(self.event(999, "click").status_code, 404)
        self.app.config["RATE_LIMIT_DISCOVERY_EVENTS_MAX"] = 1
        self.app.extensions.clear()
        self.assertEqual(self.event(1, "click").status_code, 200)
        self.assertEqual(self.event(1, "click").status_code, 429)

    def test_experiment_assignment_is_stable_persisted(self):
        self.put({"alpha_mode": "experiment"})
        first, second = self.get("feed").get_json(), self.get("feed").get_json()
        self.assertEqual(first["alpha"], second["alpha"])
        self.assertIn(first["alpha"], (0.35, 0.55, 0.75))
        self.assertEqual(first["alpha_source"], "experiment")
        with self.sessions() as db:
            self.assertEqual(db.query(DiscoveryAssignment).count(), 1)
            self.assertEqual(db.get(DiscoveryAssignment, 1).alpha, first["alpha"])

    def test_experiments_require_impression_and_real_assignment(self):
        self.put({"alpha_mode": "experiment"})
        book = self.get("feed").get_json()["recommendations"][0]
        self.event(book["book_id"], "click", book["exposure_id"])
        self.event(book["book_id"], "like")  # unattributed, never an experiment observation
        summary = self.get("experiments").get_json()
        self.assertEqual(sum(row["positive_events"] for row in summary["variants"]), 0)
        self.event(book["book_id"], "impression", book["exposure_id"])
        self.event(book["book_id"], "save", book["exposure_id"])
        self.event(book["book_id"], "rating", book["exposure_id"], value=5)
        summary = self.get("experiments").get_json()
        self.assertEqual(sum(row["impressions"] for row in summary["variants"]), 1)
        self.assertEqual(sum(row["positive_events"] for row in summary["variants"]), 1)
        self.assertFalse(summary["eligible_for_learning"])
        other = self.get("experiments", self.other_headers).get_json()
        self.assertEqual(sum(row["impressions"] for row in other["variants"]), 0)
        self.assertEqual(self.get("experiments?user_id=2").status_code, 400)
        self.put({"alpha_mode": "manual"})
        manual = self.get("feed").get_json()["recommendations"][0]
        self.event(manual["book_id"], "impression", manual["exposure_id"])
        self.event(manual["book_id"], "like", manual["exposure_id"])
        self.assertEqual(sum(row["impressions"] for row in self.get("experiments").get_json()["variants"]), 1)

    def test_auto_learning_boundaries_and_flags(self):
        self.put({"alpha_mode": "auto"})
        self.assertEqual(self.get("feed").get_json()["alpha_source"], "auto_fallback")
        with self.sessions() as db:
            assignment = db.get(DiscoveryAssignment, 1)
            assignment.variant, assignment.alpha = "cf_v2_75", 0.75
            for number in range(30):
                exposure_id = str(uuid4())
                db.add(RecommendationExposure(id=exposure_id, request_id=str(uuid4()), user_id=1, book_id=number + 1,
                    mode="for_you", variant="cf_v2_75", alpha=0.75, alpha_source="experiment"))
                db.flush()
                db.add(DiscoveryEvent(user_id=1, book_id=number + 1, exposure_id=exposure_id, event_type="impression"))
                db.add(DiscoveryEvent(user_id=1, book_id=number + 1, exposure_id=exposure_id, event_type="like"))
                if number == 28:
                    db.flush()
                    alpha, source, _, _ = choose_alpha(db, 1, {**DEFAULT_PREFERENCES, "alpha_mode": "auto"}, self.app.config)
                    self.assertEqual((alpha, source), (0.55, "auto_fallback"))
            db.commit()
        result = self.get("feed").get_json()
        self.assertEqual(result["alpha_source"], "auto_smoothed")
        self.assertGreater(result["alpha"], 0.55)
        self.assertLessEqual(result["alpha"], 0.65)
        self.app.config["DISCOVERY_EXPERIMENTS_ENABLED"] = False
        self.assertEqual(self.get("feed").get_json()["alpha"], 0.55)
        self.assertFalse(self.get("experiments").get_json()["eligible_for_learning"])
        self.app.config["DISCOVERY_ENABLED_MODES"] = ["for_you"]
        self.assertEqual(self.get("feed?mode=explore").status_code, 404)
        self.app.config["DISCOVERY_ENABLED"] = False
        self.assertEqual(self.get("feed").status_code, 404)

    def test_modes_anchor_and_author_affinity(self):
        with self.sessions() as db:
            db.add_all([Rating(user_id=1, book_id=1, rating=5), Rating(user_id=2, book_id=2, rating=5),
                        Favorite(user_id=1, book_id=7), ReadingListItem(user_id=1, book_id=4, status="currently_reading"),
                        ReadingListItem(user_id=2, book_id=6, status="currently_reading")])
            db.commit()
        self.assertEqual(self.get("feed?mode=because_you_rated&anchor_book_id=2").status_code, 400)
        based = self.get("feed?mode=because_you_rated&anchor_book_id=1").get_json()
        self.assertTrue(based["recommendations"])
        self.assertTrue(all(item["book_id"] % 2 for item in based["recommendations"]))
        self.assertIn("Book 1", based["recommendations"][0]["explanation"])
        reading = self.get("feed?mode=continue_reading").get_json()
        self.assertEqual([book["book_id"] for book in reading["recommendations"]], [4])
        author = self.get("feed?mode=favorite_author").get_json()
        self.assertTrue(author["recommendations"])
        self.assertTrue(all(book["authors"] == "Author 1" for book in author["recommendations"]))
        orders = {}
        for mode in ("for_you", "hidden_gems", "explore"):
            response = self.get("feed?mode=" + mode)
            self.assertEqual(response.status_code, 200)
            orders[mode] = [book["book_id"] for book in response.get_json()["recommendations"]]
        self.assertNotEqual(orders["for_you"], orders["hidden_gems"])
        self.assertNotEqual(orders["for_you"], orders["explore"])

    def test_trending_uses_only_recent_app_activity(self):
        self.assertEqual(self.get("feed?mode=trending").get_json()["recommendations"], [])
        with self.sessions() as db:
            db.add(FeedbackEvent(user_id=1, book_id=2, event_type="click", created_at=datetime.now(timezone.utc) - timedelta(days=8)))
            db.add(FeedbackEvent(user_id=2, book_id=4, event_type="click"))
            db.add(DiscoveryEvent(user_id=2, book_id=4, event_type="like"))
            db.commit()
        books = self.get("feed?mode=trending").get_json()["recommendations"]
        self.assertEqual([book["book_id"] for book in books], [4])
        self.assertIn("1 app reader", books[0]["explanation"])

    def test_dislikes_and_more_less_feedback_change_similarity(self):
        self.put({"favorite_genres": ["Fantasy"], "disliked_genres": ["History"]})
        books = self.get("feed").get_json()["recommendations"]
        self.assertTrue(all(book["primary_genre"] == "Fantasy" for book in books))
        self.put({"favorite_genres": [], "disliked_genres": []})
        self.event(1, "more_like_this")
        more = self.get("feed?limit=1").get_json()["recommendations"][0]
        self.assertEqual(more["primary_genre"], "Fantasy")
        self.event(1, "less_like_this")
        less = self.get("feed?limit=1").get_json()["recommendations"][0]
        self.assertEqual(less["primary_genre"], "History")

    def test_optional_progress_and_followed_authors_are_owned(self):
        from backend.models.reader_models import FollowedAuthor, ReadingProgress
        Base.metadata.create_all(self.engine)
        with self.sessions() as db:
            db.add_all([ReadingProgress(user_id=1, book_id=1, percent=45),
                        ReadingProgress(user_id=1, book_id=2, percent=100),
                        ReadingProgress(user_id=2, book_id=3, percent=60),
                        ReadingListItem(user_id=1, book_id=2, status="currently_reading"),
                        FollowedAuthor(user_id=1, author="Author 2"),
                        FollowedAuthor(user_id=2, author="Author 3")])
            db.commit()
        reading = self.get("feed?mode=continue_reading").get_json()["recommendations"]
        self.assertEqual([book["book_id"] for book in reading], [1])
        self.assertIn("45%", reading[0]["explanation"])
        author = self.get("feed?mode=favorite_author").get_json()["recommendations"]
        self.assertTrue(author)
        self.assertTrue(all(book["authors"] == "Author 2" for book in author))

    def test_era_novelty_and_mmr_have_observable_effect(self):
        self.put({"era": "classic"})
        classic = self.get("feed?limit=10").get_json()["recommendations"]
        self.assertEqual(classic[0]["original_publication_year"], 1950)
        self.put({"era": "recent"})
        recent = self.get("feed?limit=10").get_json()["recommendations"]
        self.assertEqual(recent[0]["original_publication_year"], 2023)
        self.assertGreater(sum(book["original_publication_year"] == 1950 for book in classic),
                           sum(book["original_publication_year"] == 1950 for book in recent))
        with self.sessions() as db:
            neutral = {**DEFAULT_PREFERENCES, "alpha": 0.7, "favorite_genres": ["Fantasy"], "diversity": 0}
            homogeneous, _, _ = rank_feed(db, 1, neutral, 0.7, "for_you")
            diverse, _, _ = rank_feed(db, 1, {**neutral, "diversity": 1}, 0.7, "for_you")
            self.assertGreater(len({row["book"].primary_genre for row in diverse[:5]}),
                               len({row["book"].primary_genre for row in homogeneous[:5]}))
            popular, _, _ = rank_feed(db, 1, {**DEFAULT_PREFERENCES, "novelty": 0}, 0.55, "for_you")
            novel, _, _ = rank_feed(db, 1, {**DEFAULT_PREFERENCES, "novelty": 1}, 0.55, "for_you")
            self.assertLess(novel[0]["book"].ratings_count, popular[0]["book"].ratings_count)

    def test_negative_experiment_feedback_prevents_learning(self):
        self.put({"alpha_mode": "experiment"})
        books = self.get("feed?limit=30").get_json()["recommendations"]
        for book in books:
            self.event(book["book_id"], "impression", book["exposure_id"])
            self.event(book["book_id"], "skip", book["exposure_id"])
        self.put({"alpha_mode": "auto"})
        response = self.get("feed").get_json()
        self.assertEqual(response["alpha_source"], "auto_fallback")
        self.assertEqual(response["alpha"], 0.55)
        summary = self.get("experiments").get_json()
        self.assertEqual(sum(row["negative_events"] for row in summary["variants"]), 30)

    def test_deep_affinity_retrieval_reaches_beyond_popular_window(self):
        with self.sessions() as db:
            db.bulk_save_objects([Book(book_id=number, title=f"Popular filler {number}", authors="Other author",
                primary_genre="General", top_tags="general", original_publication_year=2024,
                average_rating=4.8, weighted_rating=4.8, ratings_count=500)
                for number in range(100, 1300)])
            db.add_all([Book(book_id=9001, title="Favorite distant author", authors="Distant author", primary_genre="Rare",
                            top_tags="rare", average_rating=4, weighted_rating=3, ratings_count=900000, original_publication_year=1800),
                        Book(book_id=9002, title="Unread distant author", authors="Distant author", primary_genre="Rare",
                            top_tags="rare", average_rating=4, weighted_rating=3, ratings_count=900000, original_publication_year=1800),
                        Rating(user_id=1, book_id=9001, rating=5)])
            db.commit()
            candidates = retrieve_candidates(db, profile_for(db, 1), DEFAULT_PREFERENCES, "favorite_author")
            self.assertLessEqual(len(candidates), 3000)
            self.assertIn(9002, [book.book_id for book in candidates])
        books = self.get("feed?mode=favorite_author").get_json()["recommendations"]
        self.assertEqual([book["book_id"] for book in books], [9002])

    def test_like_changes_ranking_and_does_not_clear_negative_signals(self):
        self.put({"novelty": 0, "diversity": 0})
        before = self.get("feed?limit=1").get_json()["recommendations"][0]
        self.assertEqual(before["primary_genre"], "History")
        self.event(1, "like")
        liked = self.get("feed?limit=1").get_json()["recommendations"][0]
        self.assertEqual(liked["primary_genre"], "Fantasy")
        self.assertTrue(any(reason["type"] == "liked_book" and "Book 1" in reason["text"] for reason in liked["reasons"]))
        self.event(1, "less_like_this")
        self.event(1, "like")
        with self.sessions() as db:
            self.assertNotIn(1, [book.book_id for book in profile_for(db, 1)["seeds"]])
        self.assertEqual(self.get("feed?limit=1").get_json()["recommendations"][0]["primary_genre"], "History")
        self.event(1, "more_like_this")
        self.event(1, "not_interested")
        self.event(1, "like")
        with self.sessions() as db:
            profile = profile_for(db, 1)
            self.assertNotIn(1, [book.book_id for book in profile["seeds"]])
            self.assertIn(1, profile["excluded"])
        self.assertNotIn(1, [book["book_id"] for book in self.get("feed?limit=50").get_json()["recommendations"]])
        self.assertFalse(any(reason["type"] == "liked_book" for book in self.get("feed", self.other_headers).get_json()["recommendations"] for reason in book["reasons"]))

    def test_rated_book_reasons_reference_real_overlap_and_exact_stars(self):
        with self.sessions() as db:
            db.add_all([Rating(user_id=1, book_id=1, rating=5), Rating(user_id=2, book_id=2, rating=5)])
            db.commit()
        books = self.get("feed?limit=50").get_json()["recommendations"]
        for book in books:
            rated = [reason["text"] for reason in book["reasons"] if reason["type"] == "rated_book"]
            if book["primary_genre"] == "Fantasy":
                self.assertTrue(any("Book 1 5 stars" in reason for reason in rated))
            else:
                self.assertEqual(rated, [])
            self.assertFalse(any("Book 2" in reason for reason in rated))

    def seed_neighbors(self):
        with self.sessions() as db:
            db.add_all([User(id=3, username="similar_reader"), User(id=4, username="unrelated_reader")])
            db.flush()
            db.add_all([Rating(user_id=1, book_id=1, rating=5),
                        Rating(user_id=2, book_id=1, rating=5), Rating(user_id=2, book_id=4, rating=5),
                        Rating(user_id=3, book_id=1, rating=4), Rating(user_id=3, book_id=4, rating=5),
                        Rating(user_id=4, book_id=2, rating=5), Rating(user_id=4, book_id=6, rating=5)])
            db.commit()

    def test_collaborative_evidence_and_alpha_direction_are_real(self):
        self.seed_neighbors()
        self.put({"alpha": 0, "novelty": 0, "diversity": 0})
        content = self.get("feed?limit=12").get_json()
        self.assertEqual(content["recommendations"][0]["primary_genre"], "Fantasy")
        self.put({"alpha": 1})
        collaborative = self.get("feed?limit=12").get_json()
        self.assertEqual(collaborative["alpha_semantics"], "collaborative_weight")
        self.assertTrue(collaborative["collaborative_available"])
        self.assertEqual(collaborative["recommendations"][0]["book_id"], 4)
        self.assertAlmostEqual(collaborative["recommendations"][0]["scores"]["collaborative"], 0.2)
        self.assertIn("Popular among readers with similar tastes: 2 app readers", collaborative["recommendations"][0]["explanation"])
        self.assertNotIn("fallback", collaborative["notice"])
        for book in collaborative["recommendations"]:
            if book["book_id"] != 4:
                self.assertFalse(any(reason["type"] == "collaborative" for reason in book["reasons"]))
        first = self.get("feed?limit=6").get_json()["recommendations"]
        second = self.get("feed?offset=6&limit=6").get_json()["recommendations"]
        self.assertEqual([book["book_id"] for book in first + second], [book["book_id"] for book in collaborative["recommendations"]])

    def test_collaborative_confidence_shrinks_sparse_overlap(self):
        self.seed_neighbors()
        with self.sessions() as db:
            sparse = profile_for(db, 1)["collaborative"][4]
            self.assertAlmostEqual(sparse["confidence"], 0.2)
            for user_id in (1, 2, 3):
                db.add_all([Rating(user_id=user_id, book_id=3, rating=5), Rating(user_id=user_id, book_id=5, rating=5)])
            db.commit()
            stronger = profile_for(db, 1)["collaborative"][4]
            self.assertGreater(stronger["confidence"], sparse["confidence"])
            self.assertGreater(stronger["score"], sparse["score"])
            self.assertEqual(set(profile_for(db, 1)["collaborative"]), {4})

    def test_no_neighbors_has_explicit_fallback_and_no_collaborative_claim(self):
        result = self.get("feed").get_json()
        self.assertFalse(result["collaborative_available"])
        self.assertIn("catalog quality/popularity as a fallback", result["notice"])
        self.assertTrue(all(book["scores"]["collaborative"] == 0 for book in result["recommendations"]))
        self.assertFalse(any(reason["type"] == "collaborative" for book in result["recommendations"] for reason in book["reasons"]))

    def test_old_experiment_semantics_are_not_reused_for_learning(self):
        with self.sessions() as db:
            db.add(DiscoveryAssignment(user_id=1, variant="content_75", alpha=0.75))
            exposure_id = str(uuid4())
            db.add(RecommendationExposure(id=exposure_id, request_id=str(uuid4()), user_id=1, book_id=1,
                mode="for_you", variant="content_75", alpha=0.75, alpha_source="experiment"))
            db.flush()
            db.add_all([DiscoveryEvent(user_id=1, book_id=1, exposure_id=exposure_id, event_type="impression"),
                        DiscoveryEvent(user_id=1, book_id=1, exposure_id=exposure_id, event_type="like")])
            db.commit()
        self.put({"alpha_mode": "experiment"})
        self.assertEqual(self.get("feed").get_json()["alpha"], 0.75)
        with self.sessions() as db:
            self.assertEqual(db.get(DiscoveryAssignment, 1).variant, "cf_v2_75")
        self.assertEqual(sum(row["impressions"] for row in self.get("experiments").get_json()["variants"]), 0)


if __name__ == "__main__":
    unittest.main()
