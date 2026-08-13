from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from coches_scraper.database.repository import CrawlRepository
from coches_scraper.database.session import get_session
from coches_scraper.parsers.listing import parse_listing_page
from coches_scraper.parsers.technical_sheet import parse_technical_sheet
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def _db_available() -> bool:
    try:
        session = get_session()
        session.execute(text("SELECT 1"))
        session.close()
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _db_available(), reason="Postgres coches_db no disponible")
def test_upsert_claim_and_save_sheet():
    session = get_session()
    repo = CrawlRepository(session)

    session.execute(
        text(
            "DELETE FROM version_specifications WHERE version_id IN (85308, 36480);"
            "DELETE FROM technical_sheets WHERE version_id IN (85308, 36480);"
            "DELETE FROM versions WHERE version_id IN (85308, 36480);"
            "DELETE FROM crawl_jobs WHERE version_id IN (85308, 36480);"
        )
    )
    session.commit()

    listing = parse_listing_page((FIXTURES / "listing_sample.html").read_text(encoding="utf-8"))
    repo.upsert_crawl_jobs(listing["items"])

    jobs = repo.claim_pending_jobs(limit=10)
    assert any(job.version_id == 85308 for job in jobs)

    sheet = parse_technical_sheet(
        (FIXTURES / "detail_sample.html").read_text(encoding="utf-8"),
        expected_version_id=85308,
    )
    repo.save_technical_sheet(sheet)
    repo.mark_job_status(85308, "SUCCESS")

    stats = repo.stats()
    assert stats["technical_sheets"] >= 1
    assert stats["jobs_by_status"]["SUCCESS"] >= 1

    row = session.execute(
        text("SELECT version_id, brand, power, gearbox FROM technical_sheets WHERE version_id = 85308")
    ).mappings().one()
    assert row["brand"] == "ABARTH"
    assert int(row["power"]) == 170
    assert row["gearbox"] == "Manual 6"

    version_row = session.execute(
        text("SELECT version_id, name, technical_url_path FROM versions WHERE version_id = 85308")
    ).mappings().one()
    assert version_row["version_id"] == 85308
    assert "85308" in (version_row["technical_url_path"] or "")

    session.close()
