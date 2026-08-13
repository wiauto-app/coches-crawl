from __future__ import annotations

"""E2E local: fixtures HTML + spiders Scrapy + Postgres."""

import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from sqlalchemy import text

from coches_scraper.database.session import get_session

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "coches_scraper" / "tests" / "fixtures"


class FixtureHandler(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path.startswith("/fichas_tecnicas/buscador"):
            body = (FIXTURES / "listing_sample.html").read_bytes()
        elif "85308" in self.path:
            body = (FIXTURES / "detail_sample.html").read_bytes()
        else:
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A003
        return


def main() -> int:
    session = get_session()
    session.execute(
        text(
            """
            DELETE FROM version_specifications WHERE version_id IN (85308, 36480);
            DELETE FROM technical_sheets WHERE version_id IN (85308, 36480);
            DELETE FROM versions WHERE version_id IN (85308, 36480);
            DELETE FROM crawl_jobs WHERE version_id IN (85308, 36480);
            """
        )
    )
    session.commit()
    session.close()

    server = ThreadingHTTPServer(("127.0.0.1", 8765), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.2)

    base = "http://127.0.0.1:8765"
    common = [
        "-s",
        f"BASE_SITE_URL={base}",
        "-s",
        "DOWNLOAD_DELAY=0",
        "-s",
        "RANDOMIZE_DOWNLOAD_DELAY=false",
        "-s",
        "CONCURRENT_REQUESTS=1",
        "-s",
        "LOG_LEVEL=INFO",
    ]

    try:
        subprocess.run(
            [sys.executable, "-m", "scrapy", "crawl", "listing", "-a", "max_pages=1", *common],
            cwd=ROOT,
            check=True,
        )
        subprocess.run(
            [
                sys.executable,
                "-m",
                "scrapy",
                "crawl",
                "details",
                "-a",
                "batch_size=10",
                "-a",
                "max_items=1",
                *common,
            ],
            cwd=ROOT,
            check=True,
        )
    finally:
        server.shutdown()

    session = get_session()
    row = session.execute(
        text(
            """
            SELECT ts.version_id, ts.brand, ts.power, cj.status
            FROM technical_sheets ts
            JOIN crawl_jobs cj ON cj.version_id = ts.version_id
            WHERE ts.version_id = 85308
            """
        )
    ).mappings().one()
    session.close()
    assert row["brand"] == "ABARTH"
    assert int(row["power"]) == 170
    assert row["status"] == "SUCCESS"
    print("E2E local OK:", dict(row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
