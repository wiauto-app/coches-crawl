from __future__ import annotations

import scrapy

from coches_scraper.database.repository import CrawlRepository
from coches_scraper.database.session import get_session
from coches_scraper.items import TechnicalSheetItem
from coches_scraper.parsers.technical_sheet import parse_technical_sheet
from coches_scraper.utils.blocking import (
    BlockedError,
    CaptchaDetected,
    HttpStatusError,
    detect_block,
)
from coches_scraper.utils.logger import get_logger

logger = get_logger(__name__)


class DetailsSpider(scrapy.Spider):
    name = "details"

    def __init__(
        self,
        batch_size: str | None = None,
        max_items: str | None = None,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.batch_size = int(batch_size) if batch_size else 100
        self.max_items = int(max_items) if max_items is not None else 0
        self._scheduled = 0
        self.session = None
        self.repo: CrawlRepository | None = None

    @classmethod
    def from_crawler(cls, crawler, *args, **kwargs):
        spider = super().from_crawler(crawler, *args, **kwargs)
        if kwargs.get("batch_size") is None:
            spider.batch_size = crawler.settings.getint("DETAILS_BATCH_SIZE", 100)
        if kwargs.get("max_items") is None:
            spider.max_items = crawler.settings.getint("DETAILS_MAX_ITEMS", 0)
        from urllib.parse import urlparse

        base = crawler.settings.get("BASE_SITE_URL", "https://www.coches.net")
        host = urlparse(base).hostname
        spider.allowed_domains = [host] if host else ["coches.net"]
        return spider

    def open_spider(self, spider):
        # Scrapy calls spider methods; keep session lifecycle here.
        pass

    async def start(self):
        self.session = get_session()
        self.repo = CrawlRepository(self.session)
        requeued_blocked = self.repo.requeue_blocked(older_than_hours=6)
        requeued_running = self.repo.requeue_stale_running(older_than_minutes=30)
        if requeued_blocked or requeued_running:
            logger.info(
                "Reencolados blocked=%s stale_running=%s",
                requeued_blocked,
                requeued_running,
            )

        claim_limit = self.batch_size
        if self.max_items > 0:
            claim_limit = min(self.batch_size, self.max_items)
        jobs = self.repo.claim_pending_jobs(limit=claim_limit)

        logger.info("Details spider: %s jobs reclamados", len(jobs))
        base = self.settings.get("BASE_SITE_URL", "https://www.coches.net")

        for job in jobs:
            self._scheduled += 1
            url = job.url if job.url.startswith("http") else f"{base}{job.url}"
            yield scrapy.Request(
                url,
                callback=self.parse,
                errback=self.errback,
                meta={
                    "version_id": job.version_id,
                    "job_url": job.url,
                },
                dont_filter=True,
                headers={"Referer": f"{base}/fichas_tecnicas/buscador/"},
            )

    def parse(self, response):
        version_id = response.meta["version_id"]
        assert self.repo is not None

        try:
            detect_block(response.text, response.status)
            sheet = parse_technical_sheet(
                response.text, expected_version_id=version_id
            )
        except CaptchaDetected as exc:
            logger.error("CAPTCHA version_id=%s: %s", version_id, exc)
            self.repo.mark_job_status(version_id, "BLOCKED", last_error=str(exc)[:1000])
            return
        except (BlockedError, HttpStatusError) as exc:
            logger.error("Bloqueo version_id=%s: %s", version_id, exc)
            self.repo.mark_job_status(version_id, "BLOCKED", last_error=str(exc)[:1000])
            return
        except Exception as exc:
            logger.exception("Error parseando version_id=%s", version_id)
            self.repo.mark_job_status(version_id, "FAILED", last_error=str(exc)[:1000])
            return

        logger.info(
            "Detalle OK version_id=%s brand=%s model=%s fields=%s latency=%.2fs",
            version_id,
            sheet.get("brand"),
            sheet.get("model"),
            len(sheet.get("specifications") or {}),
            response.meta.get("download_latency") or 0,
        )

        yield TechnicalSheetItem(**sheet)

    def errback(self, failure):
        version_id = failure.request.meta.get("version_id")
        logger.error("Request fallida version_id=%s: %s", version_id, failure)
        if version_id and self.repo:
            self.repo.mark_job_status(
                version_id,
                "FAILED",
                last_error=str(failure.value)[:1000],
            )

    def closed(self, reason):
        if self.session:
            self.session.close()
        logger.info("Details spider cerrado reason=%s scheduled=%s", reason, self._scheduled)
