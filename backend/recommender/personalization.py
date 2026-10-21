"""Deterministic app-identity personalization, without offline user-ID lookup.

Alpha is the collaborative-filtering weight: alpha * CF + (1-alpha) * content.
CF uses only persisted application ratings, with shared-high-rating neighbors
and confidence shrinkage. When no usable neighbor evidence exists, the CF term
explicitly falls back to catalog quality/popularity and the feed says so.
Retrieval and reranking have hard bounds; no offline identities are consulted.
"""
import hashlib
import json
import math
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, func, inspect, or_
from sqlalchemy.exc import IntegrityError

from ..models.database_models import Book, Favorite, FeedbackEvent, Rating, ReadingListItem
from ..models.discovery_models import DiscoveryAssignment, DiscoveryEvent, DiscoveryPreference, RecommendationExposure

DEFAULT_PREFERENCES = {
    "favorite_genres": [], "disliked_genres": [], "novelty": 0.5,
    "diversity": 0.5, "length": "any", "era": "any",
    "alpha_mode": "manual", "alpha": 0.55,
}
MODES = {"for_you", "continue_reading", "hidden_gems", "because_you_rated", "trending", "explore", "favorite_author"}
VARIANTS = {"cf_v2_35": 0.35, "cf_v2_55": 0.55, "cf_v2_75": 0.75}
MINIMUM_OBSERVATIONS = 30
MAX_RESULTS = 500
CAPABILITIES = {"length_available": False}
POSITIVE = {"click", "like", "more_like_this", "save"}
NEGATIVE = {"not_interested", "less_like_this", "skip"}


def preferences_for(db, user_id):
    row = db.get(DiscoveryPreference, user_id)
    return {**DEFAULT_PREFERENCES, **(json.loads(row.settings) if row else {})}


def validate_preferences(payload, previous):
    if not isinstance(payload, dict) or set(payload) - set(DEFAULT_PREFERENCES):
        raise ValueError("Use a preferences object containing only supported preference fields")
    result = {**previous, **payload}
    for name in ("favorite_genres", "disliked_genres"):
        values = result[name]
        if not isinstance(values, list) or len(values) > 20:
            raise ValueError(f"{name} must be a list of at most 20 genres")
        cleaned = []
        for value in values:
            if not isinstance(value, str) or not 1 <= len(value.strip()) <= 100:
                raise ValueError("Each genre must contain 1 to 100 characters")
            value = value.strip()
            if value.casefold() not in {item.casefold() for item in cleaned}:
                cleaned.append(value)
        result[name] = cleaned
    if {x.casefold() for x in result["favorite_genres"]} & {x.casefold() for x in result["disliked_genres"]}:
        raise ValueError("Favorite and disliked genres must not overlap")
    for name in ("novelty", "diversity", "alpha"):
        value = result[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1 or not math.isfinite(value):
            raise ValueError(f"{name} must be a finite number between 0 and 1")
    for name, options in (("length", {"any", "short", "long"}), ("era", {"any", "recent", "classic"}), ("alpha_mode", {"manual", "experiment", "auto"})):
        if not isinstance(result[name], str) or result[name] not in options:
            raise ValueError(f"Invalid {name}")
    return result


def assignment_for(db, user_id):
    assignment = db.get(DiscoveryAssignment, user_id)
    if assignment is None:
        index = int(hashlib.sha256(f"discovery-v1:{user_id}".encode()).hexdigest()[:16], 16) % 3
        variant = tuple(VARIANTS)[index]
        assignment = DiscoveryAssignment(user_id=user_id, variant=variant, alpha=VARIANTS[variant])
        try:
            with db.begin_nested():
                db.add(assignment)
                db.flush()
        except IntegrityError:
            assignment = db.get(DiscoveryAssignment, user_id)
            if assignment is None:
                raise
    if assignment.variant not in VARIANTS:
        # Preserve the assigned alpha bucket but never mix the earlier
        # content/catalog experiment's feedback into this CF/content version.
        assignment.variant = min(VARIANTS, key=lambda key: abs(VARIANTS[key] - float(assignment.alpha)))
        assignment.alpha = VARIANTS[assignment.variant]
        db.flush()
    return assignment


def experiment_summary(db, user_id, minimum=MINIMUM_OBSERVATIONS, enabled=True):
    # One observation per exposure, requiring a client-recorded impression.
    positive = or_(DiscoveryEvent.event_type.in_(POSITIVE), and_(DiscoveryEvent.event_type == "rating", DiscoveryEvent.value >= 4))
    negative = or_(DiscoveryEvent.event_type.in_(NEGATIVE), and_(DiscoveryEvent.event_type == "rating", DiscoveryEvent.value <= 2))
    observations = db.query(
        RecommendationExposure.variant.label("variant"),
        func.max(case((DiscoveryEvent.event_type == "impression", 1), else_=0)).label("seen"),
        func.max(case((positive, 1), else_=0)).label("positive"),
        func.max(case((negative, 1), else_=0)).label("negative"),
    ).join(DiscoveryEvent, and_(DiscoveryEvent.exposure_id == RecommendationExposure.id,
                               DiscoveryEvent.user_id == RecommendationExposure.user_id,
                               DiscoveryEvent.book_id == RecommendationExposure.book_id)).filter(
        RecommendationExposure.user_id == user_id,
        RecommendationExposure.alpha_source == "experiment",
        RecommendationExposure.variant.in_(VARIANTS),
    ).group_by(RecommendationExposure.id, RecommendationExposure.variant).subquery()
    totals = db.query(observations.c.variant, func.sum(observations.c.seen),
                      func.sum(observations.c.seen * observations.c.positive),
                      func.sum(observations.c.seen * observations.c.negative)).group_by(observations.c.variant).all()
    counts = {variant: (int(seen), int(pos), int(neg)) for variant, seen, pos, neg in totals}
    variants = []
    for variant, alpha in VARIANTS.items():
        seen, pos, neg = counts.get(variant, (0, 0, 0))
        variants.append({"variant": variant, "alpha": alpha, "impressions": seen, "positive_events": pos,
                         "negative_events": neg, "engagement_rate": round(pos / seen, 4) if seen else 0.0})
    eligible = enabled and any(row["impressions"] >= minimum for row in variants)
    return {"variants": variants, "minimum_observations": minimum, "eligible_for_learning": eligible,
            "notice": ("Your attributed impressions only. This is not evidence of a global winning variant."
                       if enabled else "Experiments are disabled; automatic alpha uses the default.")}


def choose_alpha(db, user_id, preferences, config):
    mode = preferences["alpha_mode"]
    if mode == "manual":
        return preferences["alpha"], "manual", "manual", None
    if not config.get("DISCOVERY_EXPERIMENTS_ENABLED", True):
        return 0.55, "fallback", "default", "Experiments are disabled; using default alpha."
    assignment = assignment_for(db, user_id)
    if mode == "experiment":
        return assignment.alpha, "experiment", assignment.variant, None
    minimum = max(10, int(config.get("DISCOVERY_MIN_OBSERVATIONS", MINIMUM_OBSERVATIONS)))
    summary = experiment_summary(db, user_id, minimum)
    row = next(row for row in summary["variants"] if row["variant"] == assignment.variant)
    seen, pos, neg = row["impressions"], row["positive_events"], row["negative_events"]
    if seen < minimum or pos <= neg:
        return 0.55, "auto_fallback", "default", "Not enough favorable attributed experiment evidence; using default alpha."
    # Strong prior and a capped adjustment: do not declare a winner from one arm.
    confidence = min(0.5, max(0.0, (pos - neg) / (seen + 20)))
    alpha = round(0.55 + confidence * (assignment.alpha - 0.55), 4)
    return alpha, "auto_smoothed", assignment.variant, "Conservative adjustment from your observed feedback, not a proven winning variant."


def authors(book):
    return {part.strip().casefold() for part in (book.authors or "").split(",") if part.strip()}


def features(book):
    tags = {part.strip().casefold() for part in (book.top_tags or "").split(",") if part.strip()}
    if book.primary_genre:
        tags.add(book.primary_genre.casefold())
    return tags


def similarity(left, right):
    return len(left & right) / len(left | right) if left or right else 0.0


def optional_reader_model(db, name):
    try:
        from ..models import reader_models
    except ImportError:
        return None
    model = getattr(reader_models, name, None)
    return model if model is not None and inspect(db.get_bind()).has_table(model.__tablename__) else None


def collaborative_for(db, user_id, ratings, excluded, rated_ids):
    """Bounded user-neighbor CF in the application identity space only.

    At most 100 high-rated anchors, 40 neighbors, 200 ratings per neighbor and
    500 scored candidate books. Shared-book weight n/(n+3) and evidence-mass
    confidence mass/(mass+2) shrink single-overlap/single-reader predictions.
    Neighbor IDs remain internal and are never included in explanations.
    """
    anchors = [row.book_id for row in ratings if row.rating >= 4 and row.book_id not in excluded][:100]
    if not anchors:
        return {}, 0
    shared = func.count(Rating.book_id)
    neighbors = db.query(Rating.user_id, shared.label("shared")).filter(
        Rating.user_id != user_id, Rating.book_id.in_(anchors), Rating.rating >= 4,
    ).group_by(Rating.user_id).order_by(shared.desc(), Rating.user_id).limit(40).all()
    if not neighbors:
        return {}, 0
    weights = {reader_id: count / (count + 3.0) for reader_id, count in neighbors}
    ranked = db.query(Rating.user_id.label("reader_id"), Rating.book_id.label("book_id"),
        Rating.rating.label("rating"), func.row_number().over(partition_by=Rating.user_id,
            order_by=(Rating.rating.desc(), Rating.book_id)).label("position"),
    ).filter(Rating.user_id.in_(weights), Rating.rating.between(1, 5)).subquery()
    rows = db.query(ranked.c.reader_id, ranked.c.book_id, ranked.c.rating).filter(
        ranked.c.position <= 200,
    ).order_by(ranked.c.reader_id, ranked.c.book_id).all()
    evidence = {}
    for reader_id, book_id, rating in rows:
        if book_id in rated_ids or book_id in excluded:
            continue
        item = evidence.setdefault(book_id, {"weighted_total": 0.0, "mass": 0.0, "positive_neighbors": 0, "neighbors": 0})
        weight = weights[reader_id]
        item["weighted_total"] += float(rating) * weight
        item["mass"] += weight
        item["neighbors"] += 1
        item["positive_neighbors"] += int(rating >= 4)
    for item in evidence.values():
        item["weighted_rating"] = item["weighted_total"] / item["mass"]
        item["confidence"] = item["mass"] / (item["mass"] + 2.0)
        item["score"] = (item["weighted_rating"] / 5.0) * item["confidence"]
    best = sorted(evidence, key=lambda book_id: (-evidence[book_id]["score"], book_id))[:500]
    return {book_id: evidence[book_id] for book_id in best}, len(neighbors)


def profile_for(db, user_id):
    rated_ids = {row[0] for row in db.query(Rating.book_id).filter_by(user_id=user_id)}
    ratings = db.query(Rating).filter_by(user_id=user_id).order_by(Rating.timestamp.desc(), Rating.id.desc()).limit(2000).all()
    favorites = db.query(Favorite).filter_by(user_id=user_id).order_by(Favorite.id.desc()).limit(1000).all()
    # Passive impressions must not push explicit preference signals out of the
    # bounded window. A like never clears less-like-this or not-interested.
    events = db.query(DiscoveryEvent).filter(DiscoveryEvent.user_id == user_id,
        DiscoveryEvent.event_type.in_({"like", "more_like_this", "less_like_this"}),
    ).order_by(DiscoveryEvent.id.desc()).limit(3000).all()
    excluded = {row[0] for row in db.query(DiscoveryEvent.book_id).filter_by(user_id=user_id, event_type="not_interested").distinct()}
    more, less, seen, liked = set(), set(), set(), []
    for row in events:
        if row.event_type == "like" and row.book_id not in liked:
            liked.append(row.book_id)
        if row.event_type in {"more_like_this", "less_like_this"} and row.book_id not in seen:
            (more if row.event_type == "more_like_this" else less).add(row.book_id)
            seen.add(row.book_id)
    blocked_seeds = excluded | less
    liked = [book_id for book_id in liked if book_id not in blocked_seeds]
    positive_ids = list(dict.fromkeys([*liked,
        *(row.book_id for row in ratings if row.rating >= 4), *(row.book_id for row in favorites)]))
    positive_ids = [book_id for book_id in positive_ids if book_id not in blocked_seeds]
    seed_books = db.query(Book).filter(Book.book_id.in_(positive_ids)).all() if positive_ids else []
    by_id = {book.book_id: book for book in seed_books}
    seeds = [by_id[book_id] for book_id in positive_ids if book_id in by_id]
    affinity = Counter()
    for book in seeds:
        affinity.update(authors(book))
    followed = optional_reader_model(db, "FollowedAuthor")
    if followed is not None:
        for row in db.query(followed).filter_by(user_id=user_id).order_by(followed.id).limit(200).all():
            affinity[row.author.strip().casefold()] += 2
    more -= excluded
    feedback_books = db.query(Book).filter(Book.book_id.in_(more | less)).order_by(Book.book_id).all() if more or less else []
    collaborative, neighbor_count = collaborative_for(db, user_id, ratings, blocked_seeds, rated_ids)
    return {"ratings": ratings, "rated_ids": rated_ids, "affinity": affinity, "seeds": seeds[:100], "excluded": excluded,
            "liked_ids": set(liked), "high_ratings": {row.book_id: float(row.rating) for row in ratings if row.rating >= 4},
            "collaborative": collaborative, "neighbor_count": neighbor_count,
            "more": [features(book) for book in feedback_books if book.book_id in more][:100],
            "less": [features(book) for book in feedback_books if book.book_id in less][:100]}


def trending_scores(db, now):
    cutoff = now - timedelta(days=7)
    scores = Counter()
    # Deduplicate actors per book, so repeated clicks cannot fabricate a trend.
    for model in (DiscoveryEvent, FeedbackEvent):
        rows = db.query(model.book_id, model.user_id).filter(
            model.created_at >= cutoff,
            or_(model.event_type.in_(POSITIVE), and_(model.event_type == "rating", model.value >= 4)),
        ).distinct().order_by(model.book_id, model.user_id).limit(20000).all()
        for book_id, user_id in rows:
            scores[(book_id, user_id)] = 1
    return Counter(book_id for book_id, _ in scores)


def retrieve_candidates(db, profile, preferences, mode, special_ids=None):
    base = db.query(Book)
    if special_ids is not None:
        return base.filter(Book.book_id.in_(special_ids)).order_by(Book.book_id).limit(3000).all() if special_ids else []
    # Bounded multi-source retrieval includes long-tail and affinity candidates,
    # rather than re-ranking only the first page of the popularity model.
    batches = [base.order_by(Book.weighted_rating.desc(), Book.book_id).limit(700).all(),
               base.order_by(Book.ratings_count.asc(), Book.book_id).limit(700).all(),
               base.order_by(Book.original_publication_year.desc(), Book.book_id).limit(300).all()]
    genres = {genre.casefold() for genre in preferences["favorite_genres"]}
    genres.update(book.primary_genre.casefold() for book in profile["seeds"] if book.primary_genre)
    clauses = [func.lower(Book.primary_genre).in_(sorted(genres))] if genres else []
    for author, _ in profile["affinity"].most_common(20):
        clauses.append(func.lower(Book.authors).contains(author, autoescape=True))
    if clauses:
        batches.insert(0, base.filter(or_(*clauses)).order_by(Book.weighted_rating.desc(), Book.book_id).limit(800).all())
    if profile["collaborative"]:
        batches.insert(0, base.filter(Book.book_id.in_(profile["collaborative"])).order_by(Book.book_id).limit(500).all())
    result = {}
    for batch in batches:
        for book in batch:
            result.setdefault(book.book_id, book)
    return list(result.values())[:3000]


def rank_feed(db, user_id, preferences, alpha, mode, anchor_book_id=None, now=None):
    now = now or datetime.now(timezone.utc)
    profile = profile_for(db, user_id)
    notice, special_ids, anchor, trends = [], None, None, Counter()
    if not profile["collaborative"] and mode not in {"continue_reading", "trending"}:
        notice.append("No usable similar-reader ratings yet; the collaborative share uses catalog quality/popularity as a fallback.")
    progress = {}
    if preferences["length"] != "any":
        notice.append("Page-count metadata is unavailable; your length preference is saved but not applied.")
    if mode == "because_you_rated":
        own = db.query(Rating).filter_by(user_id=user_id, book_id=anchor_book_id).first() if anchor_book_id else next((rating for rating in profile["ratings"] if rating.rating >= 4), None)
        if own is None:
            if anchor_book_id:
                raise ValueError("anchor_book_id must be a book you have rated")
            notice.append("Rate a book highly to get recommendations based on it.")
            special_ids = set()
        else:
            anchor = db.get(Book, own.book_id)
            if anchor is not None:
                profile["seeds"] = [anchor, *profile["seeds"][:99]]
    if mode == "continue_reading":
        items = db.query(ReadingListItem).filter_by(user_id=user_id, status="currently_reading").all()
        special_ids = {item.book_id for item in items}
        model = optional_reader_model(db, "ReadingProgress")
        if model is not None:
            for row in db.query(model).filter(model.user_id == user_id, model.percent > 0, model.percent < 100).order_by(model.updated_at.desc(), model.book_id).limit(1000).all():
                progress[row.book_id] = row.percent
                special_ids.add(row.book_id)
            completed = {row[0] for row in db.query(model.book_id).filter(model.user_id == user_id, model.percent >= 100)}
            special_ids -= completed
        if not special_ids:
            notice.append("No books currently in progress. Start one from your reading list.")
    if mode == "trending":
        trends = trending_scores(db, now)
        special_ids = set(trends)
        if not trends:
            notice.append("No positive app activity in the last seven days; no live trends to show.")
    if mode == "favorite_author" and not profile["affinity"]:
        special_ids = set()
        notice.append("Follow an author, favorite a book, or rate one highly to build author affinity.")
    candidates = retrieve_candidates(db, profile, preferences, mode, special_ids)
    rated_ids = profile["rated_ids"]
    favorites = {genre.casefold() for genre in preferences["favorite_genres"]}
    dislikes = {genre.casefold() for genre in preferences["disliked_genres"]}
    seed_features = [features(book) for book in profile["seeds"]]
    max_popularity = max((math.log1p(max(0, book.ratings_count or 0)) for book in candidates), default=1) or 1
    scored = []
    for book in candidates:
        if book.book_id in profile["excluded"] or (mode != "continue_reading" and book.book_id in rated_ids):
            continue
        tags, book_authors = features(book), authors(book)
        affinity = min(1.0, sum(profile["affinity"].get(author, 0) for author in book_authors) / 3)
        if mode == "favorite_author" and not affinity:
            continue
        content = max((similarity(tags, seed) for seed in seed_features), default=0)
        matching = tags & favorites
        content = min(1.0, content * 0.6 + (0.4 if matching else 0) + affinity * 0.25)
        popularity = math.log1p(max(0, book.ratings_count or 0)) / max_popularity
        quality = max(0, min(1, (book.weighted_rating or book.average_rating or 0) / 5))
        collaborative = profile["collaborative"].get(book.book_id)
        cf_score = collaborative["score"] if collaborative else 0.0
        neighbor_term = cf_score if profile["collaborative"] else (0.7 * quality + 0.3 * popularity)
        score = alpha * neighbor_term + (1 - alpha) * content
        score += preferences["novelty"] * 0.22 * (1 - popularity)
        score -= 0.8 if tags & dislikes else 0
        more = max((similarity(tags, seed) for seed in profile["more"]), default=0)
        less = max((similarity(tags, seed) for seed in profile["less"]), default=0)
        score += 0.3 * (more - less)
        year = book.original_publication_year
        era_match = bool(year and ((preferences["era"] == "recent" and year >= now.year - 15) or (preferences["era"] == "classic" and year < 1970)))
        score += 0.2 if era_match else 0
        reasons = []
        overlapping = [(seed, similarity(tags, features(seed))) for seed in profile["seeds"]
                       if tags & features(seed) or book_authors & authors(seed)]
        rated_sources = [(seed, overlap) for seed, overlap in overlapping if seed.book_id in profile["high_ratings"]]
        if rated_sources:
            source, _ = max(rated_sources, key=lambda pair: (pair[1], profile["high_ratings"][pair[0].book_id], -pair[0].book_id))
            stars = profile["high_ratings"][source.book_id]
            reasons.append({"type": "rated_book", "text": f"Because you rated {source.title} {stars:g} stars; shares tags or an author"})
        else:
            liked_sources = [(seed, overlap) for seed, overlap in overlapping if seed.book_id in profile["liked_ids"]]
            if liked_sources:
                source, _ = max(liked_sources, key=lambda pair: (pair[1], -pair[0].book_id))
                reasons.append({"type": "liked_book", "text": f"Shares tags or an author with {source.title}, which you liked"})
        if collaborative and collaborative["positive_neighbors"] and collaborative["weighted_rating"] >= 4:
            count = collaborative["positive_neighbors"]
            text = (f"Popular among readers with similar tastes: {count} app readers who share high-rated books with you rated this 4+ stars"
                    if count >= 2 else "Rated 4+ stars by an app reader who shares high-rated books with you")
            reasons.insert(0, {"type": "collaborative", "text": text})
        if matching:
            reasons.append({"type": "genre", "text": "Matches your preferred genre: " + sorted(matching)[0]})
        if affinity:
            reasons.append({"type": "author", "text": "By an author you follow or whose books you liked, favorited, or rated highly"})
        if more:
            reasons.append({"type": "feedback", "text": "Shares tags with a book you asked to see more like"})
        if era_match:
            reasons.append({"type": "era", "text": f"Published in {year}, matching your era preference"})
        if mode == "because_you_rated" and anchor:
            overlap = similarity(tags, features(anchor))
            if overlap == 0 and not (book_authors & authors(anchor)):
                continue
            score += overlap * 0.8
            reasons.insert(0, {"type": "rated_book", "text": f"Shares tags or an author with {anchor.title}, which you rated {float(own.rating):g} stars"})
        elif mode == "hidden_gems":
            if (book.average_rating or 0) < 3.8:
                continue
            score += (1 - popularity) * 0.65
            reasons.insert(0, {"type": "hidden_gem", "text": f"Rated {book.average_rating:.1f}/5 with {book.ratings_count or 0:,} catalog ratings; ranked toward less-rated books"})
        elif mode == "explore":
            score += (1 - content) * 0.5 + (1 - popularity) * 0.15
            reasons.insert(0, {"type": "explore", "text": "Exploration ranking favors tags outside your current reading signals"})
        elif mode == "trending":
            score = float(trends[book.book_id])
            reasons.insert(0, {"type": "trending", "text": f"Positive activity from {trends[book.book_id]} app reader(s) in the last seven days"})
        elif mode == "continue_reading":
            score = 1 + progress.get(book.book_id, 0) / 100
            reasons.insert(0, {"type": "progress", "text": f"Continue from {progress[book.book_id]:g}%" if book.book_id in progress else "On your currently-reading list"})
        if not reasons:
            reasons.append({"type": "catalog", "text": f"Catalog rating {book.average_rating or 0:.1f}/5; balanced with your discovery settings"})
        scored.append({"book": book, "tags": tags, "authors": book_authors, "score": score,
                       "content": content, "collaborative": cf_score,
                       "collaborative_confidence": collaborative["confidence"] if collaborative else 0.0,
                       "popularity": popularity, "reasons": reasons, "redundancy": 0.0})
    # Incremental MMR: stable ordering, bounded 3,000 candidates / 500 results.
    # Soft author cap keeps author affinity from occupying every adjacent slot.
    selected, author_counts = [], Counter()
    diversity = preferences["diversity"] * (0.65 if mode == "explore" else 0.35)
    while scored and len(selected) < MAX_RESULTS:
        best = max(scored, key=lambda item: (
            item["score"] - diversity * item["redundancy"] - 0.12 * max((max(0, author_counts[author] - 1) for author in item["authors"]), default=0),
            -item["book"].book_id))
        scored.remove(best)
        selected.append(best)
        author_counts.update(best["authors"])
        for item in scored:
            redundancy = max(similarity(item["tags"], best["tags"]), 0.8 if item["authors"] & best["authors"] else 0)
            item["redundancy"] = max(item["redundancy"], redundancy)
    if len(selected) == MAX_RESULTS:
        notice.append("Showing a bounded discovery selection of up to 500 books.")
    return selected, profile, " ".join(notice)
