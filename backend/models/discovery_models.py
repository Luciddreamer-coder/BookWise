"""Additive discovery tables; all use the application's existing metadata."""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint

from .database_models import Base


def utcnow():
    return datetime.now(timezone.utc)


class DiscoveryPreference(Base):
    __tablename__ = "discovery_preferences"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    settings = Column(Text, nullable=False, default="{}")
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DiscoveryAssignment(Base):
    __tablename__ = "discovery_assignments"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    variant = Column(String(32), nullable=False)
    alpha = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class RecommendationExposure(Base):
    __tablename__ = "recommendation_exposures"
    id = Column(String(36), primary_key=True)
    request_id = Column(String(36), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id"), nullable=False, index=True)
    mode = Column(String(32), nullable=False)
    variant = Column(String(32), nullable=False)
    alpha = Column(Float, nullable=False)
    alpha_source = Column(String(32), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)


class DiscoveryEvent(Base):
    __tablename__ = "discovery_events"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    book_id = Column(Integer, ForeignKey("books.book_id"), nullable=False, index=True)
    exposure_id = Column(String(36), ForeignKey("recommendation_exposures.id"), nullable=True, index=True)
    event_type = Column(String(32), nullable=False, index=True)
    value = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)
    __table_args__ = (UniqueConstraint("exposure_id", "event_type", name="uq_discovery_exposure_event"),)
