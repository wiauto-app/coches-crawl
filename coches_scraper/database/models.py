from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    version_name: Mapped[str | None] = mapped_column(String(255))
    body_type: Mapped[str | None] = mapped_column(String(100))
    doors: Mapped[int | None] = mapped_column(Integer)
    fuel_type: Mapped[str | None] = mapped_column(String(100))
    year_from: Mapped[int | None] = mapped_column(Integer)
    year_to: Mapped[int | None] = mapped_column(Integer)
    hp: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_crawl_jobs_status", "status"),
        Index("idx_crawl_jobs_status_updated", "status", "updated_at"),
    )


class TechnicalSheet(Base):
    __tablename__ = "technical_sheets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    brand: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    version: Mapped[str | None] = mapped_column(String(255))
    year: Mapped[int | None] = mapped_column(Integer)
    fuel: Mapped[str | None] = mapped_column(String(100))
    power: Mapped[int | None] = mapped_column(Integer)
    engine: Mapped[int | None] = mapped_column(Integer)
    gearbox: Mapped[str | None] = mapped_column(String(100))
    traction: Mapped[str | None] = mapped_column(String(100))
    doors: Mapped[int | None] = mapped_column(Integer)
    body: Mapped[str | None] = mapped_column(String(100))
    url: Mapped[str | None] = mapped_column(Text)
    specifications: Mapped[dict | None] = mapped_column(JSONB)
    images: Mapped[list | None] = mapped_column(JSONB)
    marketed_versions: Mapped[list | None] = mapped_column(JSONB)
    price: Mapped[float | None] = mapped_column(Numeric(12, 2))
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class Make(Base):
    __tablename__ = "makes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    section_1_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Model(Base):
    __tablename__ = "models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    make_id: Mapped[int] = mapped_column(ForeignKey("makes.id", ondelete="CASCADE"))
    model_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("make_id", "model_id"),)


class BodyType(Base):
    __tablename__ = "body_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    body_type_id: Mapped[int] = mapped_column(Integer, nullable=False)
    doors: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("body_type_id", "doors"),)


class FuelType(Base):
    __tablename__ = "fuel_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fuel_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Year(Base):
    __tablename__ = "years"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Version(Base):
    __tablename__ = "versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    make_id: Mapped[int] = mapped_column(ForeignKey("makes.id", ondelete="CASCADE"))
    model_id: Mapped[int] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"))
    body_type_id: Mapped[int] = mapped_column(
        ForeignKey("body_types.id", ondelete="CASCADE")
    )
    fuel_type_id: Mapped[int] = mapped_column(
        ForeignKey("fuel_types.id", ondelete="CASCADE")
    )
    year_id: Mapped[int] = mapped_column(ForeignKey("years.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    technical_url_path: Mapped[str | None] = mapped_column(String(512))
    specs_scraped_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class VersionSpecification(Base):
    __tablename__ = "version_specifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("versions.version_id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    acceleration: Mapped[float | None] = mapped_column(Numeric(6, 2))
    consumption_average: Mapped[float | None] = mapped_column(Numeric(6, 2))
    consumption_extra_urban: Mapped[float | None] = mapped_column(Numeric(6, 2))
    consumption_urban: Mapped[float | None] = mapped_column(Numeric(6, 2))
    cubic_capacity: Mapped[int | None] = mapped_column(Integer)
    cylinders: Mapped[str | None] = mapped_column(String(255))
    distribution: Mapped[str | None] = mapped_column(String(255))
    doors: Mapped[int | None] = mapped_column(Integer)
    emissions: Mapped[float | None] = mapped_column(Numeric(10, 2))
    fuel_tank_capacity: Mapped[float | None] = mapped_column(Numeric(8, 2))
    fuel_type: Mapped[str | None] = mapped_column(String(100))
    gear_box: Mapped[str | None] = mapped_column(String(100))
    height: Mapped[int | None] = mapped_column(Integer)
    length: Mapped[int | None] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer)
    weight: Mapped[int | None] = mapped_column(Integer)
    hp: Mapped[int | None] = mapped_column(Integer)
    hp_rpm: Mapped[int | None] = mapped_column(Integer)
    torque: Mapped[float | None] = mapped_column(Numeric(10, 2))
    torque_rpm: Mapped[int | None] = mapped_column(Integer)
    seats: Mapped[int | None] = mapped_column(Integer)
    luggage_capacity: Mapped[int | None] = mapped_column(Integer)
    supply: Mapped[str | None] = mapped_column(String(255))
    traction: Mapped[str | None] = mapped_column(String(100))
    top_speed: Mapped[int | None] = mapped_column(Integer)
    year: Mapped[int | None] = mapped_column(Integer)
    price: Mapped[float | None] = mapped_column(Numeric(12, 2))
    init_marketed_date: Mapped[datetime | None] = mapped_column(DateTime)
    images: Mapped[list | None] = mapped_column(JSONB)
    marketed_versions: Mapped[list | None] = mapped_column(JSONB)
    scraped_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    crawl_id: Mapped[str | None] = mapped_column(String(64))
