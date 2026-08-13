from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from coches_scraper.database.models import (
    BodyType,
    CrawlJob,
    FuelType,
    Make,
    Model,
    TechnicalSheet,
    Version,
    VersionSpecification,
    Year,
)
from coches_scraper.utils.fingerprint import slugify, stable_int_id


def _as_number(value: Any) -> float | int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        cleaned = value.strip().replace(",", ".")
        if not cleaned:
            return None
        try:
            if "." in cleaned:
                return float(cleaned)
            return int(cleaned)
        except ValueError:
            return None
    return None


def _as_int(value: Any) -> int | None:
    number = _as_number(value)
    if number is None:
        return None
    return int(number)


class CrawlRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert_crawl_jobs(self, items: list[dict[str, Any]]) -> int:
        if not items:
            return 0

        rows = []
        for item in items:
            rows.append(
                {
                    "version_id": item["version_id"],
                    "url": item["url"],
                    "status": "PENDING",
                    "attempts": 0,
                    "brand": item.get("brand"),
                    "model": item.get("model"),
                    "version_name": item.get("version_name"),
                    "body_type": item.get("body_type"),
                    "doors": item.get("doors"),
                    "fuel_type": item.get("fuel_type"),
                    "year_from": item.get("year_from"),
                    "year_to": item.get("year_to"),
                    "hp": item.get("hp"),
                }
            )

        stmt = insert(CrawlJob).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=[CrawlJob.version_id],
            set_={
                "url": stmt.excluded.url,
                "brand": stmt.excluded.brand,
                "model": stmt.excluded.model,
                "version_name": stmt.excluded.version_name,
                "body_type": stmt.excluded.body_type,
                "doors": stmt.excluded.doors,
                "fuel_type": stmt.excluded.fuel_type,
                "year_from": stmt.excluded.year_from,
                "year_to": stmt.excluded.year_to,
                "hp": stmt.excluded.hp,
                "updated_at": func.now(),
            },
        )
        result = self.session.execute(stmt)
        self.session.commit()
        return result.rowcount or 0

    def claim_pending_jobs(self, limit: int = 100) -> list[CrawlJob]:
        """Marca un lote como RUNNING de forma atómica y lo devuelve."""
        claimed_ids = self.session.execute(
            text(
                """
                WITH cte AS (
                  SELECT id
                  FROM crawl_jobs
                  WHERE status = 'PENDING'
                  ORDER BY id
                  FOR UPDATE SKIP LOCKED
                  LIMIT :limit
                )
                UPDATE crawl_jobs AS j
                SET status = 'RUNNING',
                    attempts = attempts + 1,
                    updated_at = NOW()
                FROM cte
                WHERE j.id = cte.id
                RETURNING j.id
                """
            ),
            {"limit": limit},
        ).scalars().all()
        self.session.commit()

        if not claimed_ids:
            return []

        jobs = self.session.scalars(
            select(CrawlJob).where(CrawlJob.id.in_(claimed_ids)).order_by(CrawlJob.id)
        ).all()
        return list(jobs)

    def mark_job_status(
        self,
        version_id: int,
        status: str,
        *,
        last_error: str | None = None,
    ) -> None:
        self.session.execute(
            update(CrawlJob)
            .where(CrawlJob.version_id == version_id)
            .values(
                status=status,
                last_error=last_error,
                updated_at=func.now(),
            )
        )
        self.session.commit()

    def requeue_blocked(self, older_than_hours: int = 6) -> int:
        threshold = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=older_than_hours)
        result = self.session.execute(
            update(CrawlJob)
            .where(
                CrawlJob.status == "BLOCKED",
                CrawlJob.updated_at <= threshold,
            )
            .values(status="PENDING", last_error=None, updated_at=func.now())
        )
        self.session.commit()
        return result.rowcount or 0

    def requeue_stale_running(self, older_than_minutes: int = 30) -> int:
        threshold = datetime.now(UTC).replace(tzinfo=None) - timedelta(
            minutes=older_than_minutes
        )
        result = self.session.execute(
            update(CrawlJob)
            .where(
                CrawlJob.status == "RUNNING",
                CrawlJob.updated_at <= threshold,
            )
            .values(status="PENDING", updated_at=func.now())
        )
        self.session.commit()
        return result.rowcount or 0

    def get_or_create_make(self, section_1_id: int, name: str) -> int:
        existing = self.session.scalar(
            select(Make.id).where(Make.section_1_id == section_1_id)
        )
        if existing:
            return existing
        make = Make(section_1_id=section_1_id, name=name)
        self.session.add(make)
        self.session.flush()
        return make.id

    def get_or_create_model(self, make_db_id: int, model_id: int, name: str) -> int:
        existing = self.session.scalar(
            select(Model.id).where(Model.make_id == make_db_id, Model.model_id == model_id)
        )
        if existing:
            return existing
        model = Model(make_id=make_db_id, model_id=model_id, name=name)
        self.session.add(model)
        self.session.flush()
        return model.id

    def get_or_create_body_type(
        self, body_type_id: int, doors: int | None, name: str
    ) -> int:
        existing = self.session.scalar(
            select(BodyType.id).where(
                BodyType.body_type_id == body_type_id,
                BodyType.doors == doors,
            )
        )
        if existing:
            return existing
        body_type = BodyType(body_type_id=body_type_id, doors=doors, name=name)
        self.session.add(body_type)
        self.session.flush()
        return body_type.id

    def get_or_create_fuel_type(self, fuel_id: int, name: str) -> int:
        existing = self.session.scalar(
            select(FuelType.id).where(FuelType.fuel_id == fuel_id)
        )
        if existing:
            return existing
        fuel = FuelType(fuel_id=fuel_id, name=name)
        self.session.add(fuel)
        self.session.flush()
        return fuel.id

    def get_or_create_year(self, year: int) -> int:
        existing = self.session.scalar(select(Year.id).where(Year.year == year))
        if existing:
            return existing
        year_row = Year(year=year)
        self.session.add(year_row)
        self.session.flush()
        return year_row.id

    def save_technical_sheet(self, sheet: dict[str, Any]) -> None:
        version_id = sheet["version_id"]
        brand = sheet.get("brand") or "UNKNOWN"
        model_name = sheet.get("model") or "UNKNOWN"
        version_name = sheet.get("version_name") or str(version_id)
        body_name = str(sheet.get("body_type") or "unknown")
        doors = _as_int(sheet.get("doors"))
        fuel_name = str(sheet.get("fuel") or "unknown")
        year = _as_int(sheet.get("year")) or _as_int(sheet.get("year_from")) or 0
        make_external_id = _as_int(sheet.get("make_id")) or stable_int_id(
            f"make:{slugify(brand)}"
        )
        model_external_id = _as_int(sheet.get("model_id")) or stable_int_id(
            f"model:{slugify(brand)}:{slugify(model_name)}"
        )
        body_external_id = stable_int_id(f"body:{slugify(body_name)}")
        fuel_external_id = stable_int_id(f"fuel:{slugify(fuel_name)}")

        make_db_id = self.get_or_create_make(make_external_id, brand)
        model_db_id = self.get_or_create_model(make_db_id, model_external_id, model_name)
        body_db_id = self.get_or_create_body_type(body_external_id, doors, body_name)
        fuel_db_id = self.get_or_create_fuel_type(fuel_external_id, fuel_name)
        year_db_id = self.get_or_create_year(year)

        version_stmt = insert(Version).values(
            version_id=version_id,
            make_id=make_db_id,
            model_id=model_db_id,
            body_type_id=body_db_id,
            fuel_type_id=fuel_db_id,
            year_id=year_db_id,
            name=version_name,
            technical_url_path=sheet.get("url"),
            specs_scraped_at=func.now(),
        )
        version_stmt = version_stmt.on_conflict_do_update(
            index_elements=[Version.version_id],
            set_={
                "make_id": version_stmt.excluded.make_id,
                "model_id": version_stmt.excluded.model_id,
                "body_type_id": version_stmt.excluded.body_type_id,
                "fuel_type_id": version_stmt.excluded.fuel_type_id,
                "year_id": version_stmt.excluded.year_id,
                "name": version_stmt.excluded.name,
                "technical_url_path": version_stmt.excluded.technical_url_path,
                "specs_scraped_at": func.now(),
            },
        )
        self.session.execute(version_stmt)

        specs = sheet.get("specifications") or {}
        sheet_stmt = insert(TechnicalSheet).values(
            version_id=version_id,
            brand=brand,
            model=model_name,
            version=version_name,
            year=year or None,
            fuel=fuel_name,
            power=_as_int(sheet.get("power") or specs.get("hp")),
            engine=_as_int(sheet.get("engine") or specs.get("cubicCapacity")),
            gearbox=sheet.get("gearbox") or specs.get("gearBox"),
            traction=sheet.get("traction") or specs.get("traction"),
            doors=doors,
            body=body_name,
            url=sheet.get("url"),
            specifications=specs,
            images=sheet.get("images") or [],
            marketed_versions=sheet.get("marketed_versions") or [],
            price=_as_number(sheet.get("price")),
            scraped_at=func.now(),
        )
        sheet_stmt = sheet_stmt.on_conflict_do_update(
            index_elements=[TechnicalSheet.version_id],
            set_={
                "brand": sheet_stmt.excluded.brand,
                "model": sheet_stmt.excluded.model,
                "version": sheet_stmt.excluded.version,
                "year": sheet_stmt.excluded.year,
                "fuel": sheet_stmt.excluded.fuel,
                "power": sheet_stmt.excluded.power,
                "engine": sheet_stmt.excluded.engine,
                "gearbox": sheet_stmt.excluded.gearbox,
                "traction": sheet_stmt.excluded.traction,
                "doors": sheet_stmt.excluded.doors,
                "body": sheet_stmt.excluded.body,
                "url": sheet_stmt.excluded.url,
                "specifications": sheet_stmt.excluded.specifications,
                "images": sheet_stmt.excluded.images,
                "marketed_versions": sheet_stmt.excluded.marketed_versions,
                "price": sheet_stmt.excluded.price,
                "scraped_at": func.now(),
            },
        )
        self.session.execute(sheet_stmt)

        init_marketed = sheet.get("init_marketed_date")
        init_marketed_dt = None
        if isinstance(init_marketed, str) and init_marketed:
            try:
                init_marketed_dt = datetime.fromisoformat(
                    init_marketed.replace("Z", "+00:00")
                )
            except ValueError:
                init_marketed_dt = None

        spec_stmt = insert(VersionSpecification).values(
            version_id=version_id,
            acceleration=_as_number(specs.get("acceleration")),
            consumption_average=_as_number(specs.get("consumptionAverage")),
            consumption_extra_urban=_as_number(specs.get("consumptionExtraUrban")),
            consumption_urban=_as_number(specs.get("consumptionUrban")),
            cubic_capacity=_as_int(specs.get("cubicCapacity")),
            cylinders=str(specs["cylinders"]) if specs.get("cylinders") is not None else None,
            distribution=specs.get("distribution"),
            doors=_as_int(specs.get("doors")) or doors,
            emissions=_as_number(specs.get("emissions")),
            fuel_tank_capacity=_as_number(specs.get("fuelTankCapacity")),
            fuel_type=specs.get("fuelType"),
            gear_box=specs.get("gearBox"),
            height=_as_int(specs.get("height")),
            length=_as_int(specs.get("length")),
            width=_as_int(specs.get("width")),
            weight=_as_int(specs.get("weight")),
            hp=_as_int(specs.get("hp")),
            hp_rpm=_as_int(specs.get("hpRpm")),
            torque=_as_number(specs.get("torque")),
            torque_rpm=_as_int(specs.get("torqueRpm")),
            seats=_as_int(specs.get("seats")),
            luggage_capacity=_as_int(specs.get("luggageCapacity")),
            supply=specs.get("supply"),
            traction=specs.get("traction"),
            top_speed=_as_int(specs.get("topSpeed")),
            year=year or None,
            price=_as_number(sheet.get("price")),
            init_marketed_date=init_marketed_dt,
            images=sheet.get("images") or [],
            marketed_versions=sheet.get("marketed_versions") or [],
            scraped_at=func.now(),
        )
        spec_stmt = spec_stmt.on_conflict_do_update(
            index_elements=[VersionSpecification.version_id],
            set_={
                "acceleration": spec_stmt.excluded.acceleration,
                "consumption_average": spec_stmt.excluded.consumption_average,
                "consumption_extra_urban": spec_stmt.excluded.consumption_extra_urban,
                "consumption_urban": spec_stmt.excluded.consumption_urban,
                "cubic_capacity": spec_stmt.excluded.cubic_capacity,
                "cylinders": spec_stmt.excluded.cylinders,
                "distribution": spec_stmt.excluded.distribution,
                "doors": spec_stmt.excluded.doors,
                "emissions": spec_stmt.excluded.emissions,
                "fuel_tank_capacity": spec_stmt.excluded.fuel_tank_capacity,
                "fuel_type": spec_stmt.excluded.fuel_type,
                "gear_box": spec_stmt.excluded.gear_box,
                "height": spec_stmt.excluded.height,
                "length": spec_stmt.excluded.length,
                "width": spec_stmt.excluded.width,
                "weight": spec_stmt.excluded.weight,
                "hp": spec_stmt.excluded.hp,
                "hp_rpm": spec_stmt.excluded.hp_rpm,
                "torque": spec_stmt.excluded.torque,
                "torque_rpm": spec_stmt.excluded.torque_rpm,
                "seats": spec_stmt.excluded.seats,
                "luggage_capacity": spec_stmt.excluded.luggage_capacity,
                "supply": spec_stmt.excluded.supply,
                "traction": spec_stmt.excluded.traction,
                "top_speed": spec_stmt.excluded.top_speed,
                "year": spec_stmt.excluded.year,
                "price": spec_stmt.excluded.price,
                "init_marketed_date": spec_stmt.excluded.init_marketed_date,
                "images": spec_stmt.excluded.images,
                "marketed_versions": spec_stmt.excluded.marketed_versions,
                "scraped_at": func.now(),
            },
        )
        self.session.execute(spec_stmt)
        self.session.commit()

    def stats(self) -> dict[str, Any]:
        status_rows = self.session.execute(
            select(CrawlJob.status, func.count()).group_by(CrawlJob.status)
        ).all()
        by_status = {status: count for status, count in status_rows}

        sheets_count = self.session.scalar(select(func.count()).select_from(TechnicalSheet)) or 0
        versions_count = self.session.scalar(select(func.count()).select_from(Version)) or 0

        avg_seconds = self.session.scalar(
            select(
                func.avg(
                    func.extract("epoch", TechnicalSheet.scraped_at)
                    - func.extract("epoch", CrawlJob.created_at)
                )
            ).select_from(TechnicalSheet)
            .join(CrawlJob, CrawlJob.version_id == TechnicalSheet.version_id)
        )

        last_hour = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
        sheets_last_hour = self.session.scalar(
            select(func.count())
            .select_from(TechnicalSheet)
            .where(TechnicalSheet.scraped_at >= last_hour)
        ) or 0

        return {
            "jobs_by_status": {
                "PENDING": by_status.get("PENDING", 0),
                "RUNNING": by_status.get("RUNNING", 0),
                "SUCCESS": by_status.get("SUCCESS", 0),
                "FAILED": by_status.get("FAILED", 0),
                "BLOCKED": by_status.get("BLOCKED", 0),
            },
            "technical_sheets": sheets_count,
            "versions": versions_count,
            "sheets_last_hour": sheets_last_hour,
            "avg_job_age_seconds": float(avg_seconds) if avg_seconds is not None else None,
            "progress_pct": round(
                (by_status.get("SUCCESS", 0) / max(sum(by_status.values()), 1)) * 100,
                2,
            ),
        }
