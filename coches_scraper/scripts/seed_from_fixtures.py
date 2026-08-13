from __future__ import annotations

from pathlib import Path

from coches_scraper.database.repository import CrawlRepository
from coches_scraper.database.session import get_session
from coches_scraper.parsers.listing import parse_listing_page
from coches_scraper.parsers.technical_sheet import parse_technical_sheet

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def main() -> None:
    listing_html = (FIXTURES / "listing_sample.html").read_text(encoding="utf-8")
    detail_html = (FIXTURES / "detail_sample.html").read_text(encoding="utf-8")

    listing = parse_listing_page(listing_html)
    session = get_session()
    repo = CrawlRepository(session)
    upserted = repo.upsert_crawl_jobs(listing["items"])
    print(f"crawl_jobs upserted={upserted}")

    # Simula el worker de detalle para la primera ficha
    sheet = parse_technical_sheet(detail_html, expected_version_id=85308)
    repo.save_technical_sheet(sheet)
    repo.mark_job_status(85308, "SUCCESS")
    print("technical_sheet version_id=85308 guardada")
    print(repo.stats())
    session.close()


if __name__ == "__main__":
    main()
