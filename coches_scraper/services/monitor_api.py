from __future__ import annotations

from fastapi import FastAPI

from coches_scraper.database.repository import CrawlRepository
from coches_scraper.database.session import get_session

app = FastAPI(title="Coches.net Scraper Monitor", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stats")
def stats():
    session = get_session()
    try:
        repo = CrawlRepository(session)
        return repo.stats()
    finally:
        session.close()


@app.post("/requeue/blocked")
def requeue_blocked(older_than_hours: int = 6):
    session = get_session()
    try:
        repo = CrawlRepository(session)
        count = repo.requeue_blocked(older_than_hours=older_than_hours)
        return {"requeued": count}
    finally:
        session.close()


@app.post("/requeue/stale-running")
def requeue_stale_running(older_than_minutes: int = 30):
    session = get_session()
    try:
        repo = CrawlRepository(session)
        count = repo.requeue_stale_running(older_than_minutes=older_than_minutes)
        return {"requeued": count}
    finally:
        session.close()
