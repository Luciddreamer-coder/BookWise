"""Deterministic offline fixture evaluation; run: python -m scripts.evaluate_discovery.

This measures fixture ranking behavior, NOT live engagement or an improvement
over a production system. No application database or downloaded user IDs used.
Alpha is CF weight. Three synthetic app readers share the target's high-rated
anchors; their other ratings provide collaborative evidence. A separate cold
reader verifies honest fallback and the causal content effect of a Like.
"""
import json
import math
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.models.database_models import Base, Book, Rating, User
from backend.models.discovery_models import DiscoveryEvent
from backend.recommender.personalization import DEFAULT_PREFERENCES, rank_feed


def ranking_metrics(ids, relevant, k=10):
    top = ids[:k]
    hits = [1 if book_id in relevant else 0 for book_id in top]
    dcg = sum(hit / math.log2(index + 2) for index, hit in enumerate(hits))
    ideal = sum(1 / math.log2(index + 2) for index in range(min(k, len(relevant))))
    return {"precision_at_10": sum(hits) / k, "recall_at_10": sum(hits) / len(relevant) if relevant else 0,
            "ndcg_at_10": dcg / ideal if ideal else 0}


def evaluate():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([User(id=number, username=f"offline_fixture_{number}") for number in range(1, 6)])
        for number in range(1, 101):
            fantasy = number % 2 == 1
            db.add(Book(book_id=number, title=f"Fixture {number}", authors=f"Author {number % 11}",
                primary_genre="Fantasy" if fantasy else "History", top_tags="magic,fantasy" if fantasy else "history,war",
                average_rating=4.1, weighted_rating=4.0, ratings_count=number * 100, original_publication_year=2000))
        db.flush()
        for book_id in (1, 3, 5):
            db.add(Rating(user_id=1, book_id=book_id, rating=5))
        for user_id in (2, 3, 4):
            for book_id in range(1, 40, 2):
                db.add(Rating(user_id=user_id, book_id=book_id, rating=5))
        db.commit()
        relevant = set(range(7, 101, 2))
        preferences = {**DEFAULT_PREFERENCES, "favorite_genres": ["Fantasy"]}
        now = datetime(2026, 10, 21, tzinfo=timezone.utc)
        results = {}
        for alpha in (0.35, 0.55, 0.75):
            first, profile, notice = rank_feed(db, 1, preferences, alpha, "for_you", now=now)
            second, _, _ = rank_feed(db, 1, preferences, alpha, "for_you", now=now)
            ids = [row["book"].book_id for row in first]
            assert ids == [row["book"].book_id for row in second], "Ranking must be deterministic"
            assert not {1, 3, 5} & set(ids), "Rated books must be excluded"
            assert profile["collaborative"] and "fallback" not in notice, "Fixture neighbors must supply actual CF evidence"
            results[str(alpha)] = {**ranking_metrics(ids, relevant),
                "unique_authors_at_10": len({row["book"].authors for row in first[:10]}),
                "collaborative_supported_at_10": sum(row["collaborative"] > 0 for row in first[:10]), "deterministic": True}
        cold, profile, notice = rank_feed(db, 5, DEFAULT_PREFERENCES, 0.55, "for_you", now=now)
        assert not profile["collaborative"] and "fallback" in notice
        before_content = next(row["content"] for row in cold if row["book"].book_id == 4)
        db.add(DiscoveryEvent(user_id=5, book_id=2, event_type="like"))
        db.commit()
        liked, _, _ = rank_feed(db, 5, DEFAULT_PREFERENCES, 0.55, "for_you", now=now)
        after_content = next(row["content"] for row in liked if row["book"].book_id == 4)
        assert after_content > before_content, "Like must increase matching content affinity"
    engine.dispose()
    return {"evaluation_type": "synthetic_deterministic_fixture", "fixture_books": 100,
            "alpha_semantics": "collaborative_weight",
            "relevance_definition": "Unrated fantasy books for a fixture reader; three synthetic neighbors share high-rated anchors",
            "behavior_checks": {"cold_start_fallback_is_explicit": True, "like_increases_matching_content": True},
            "notice": "Fixture metrics only. No claim of live improvement or statistically winning alpha.", "variants": results}


if __name__ == "__main__":
    print(json.dumps(evaluate(), indent=2))
