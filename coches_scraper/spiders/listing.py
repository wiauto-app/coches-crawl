from __future__ import annotations

import scrapy

from coches_scraper.items import CrawlJobItem
from coches_scraper.parsers.listing import parse_listing_page
from coches_scraper.utils.blocking import (
    BlockedError,
    CaptchaDetected,
    HttpStatusError,
    detect_block,
)
from coches_scraper.utils.logger import get_logger

logger = get_logger(__name__)


class ListingSpider(scrapy.Spider):
    name = "listing"

    def __init__(
        self,
        start_page: str | None = None,
        max_pages: str | None = None,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.start_page = int(start_page) if start_page else 1
        self.max_pages = int(max_pages) if max_pages is not None else 0
        self._pages_fetched = 0

    @classmethod
    def from_crawler(cls, crawler, *args, **kwargs):
        spider = super().from_crawler(crawler, *args, **kwargs)
        if kwargs.get("start_page") is None:
            spider.start_page = crawler.settings.getint("LIST_START_PAGE", 1)
        if kwargs.get("max_pages") is None:
            spider.max_pages = crawler.settings.getint("LIST_MAX_PAGES", 0)
        from urllib.parse import urlparse

        base = crawler.settings.get("BASE_SITE_URL", "https://www.coches.net")
        host = urlparse(base).hostname
        spider.allowed_domains = [host] if host else ["coches.net"]
        return spider

    async def start(self):
        yield scrapy.Request(
            self._page_url(self.start_page),
            callback=self.parse,
            errback=self.errback,
            meta={"page": self.start_page},
            dont_filter=True,
        )

    def _page_url(self, page: int) -> str:
        base = self.settings.get("BASE_SITE_URL", "https://www.coches.net")
        path = self.settings.get("LISTING_PATH", "/fichas_tecnicas/buscador/")
        return f"{base}{path}?pg={page}&fi=title&or=1"

    def parse(self, response):
        page = response.meta.get("page", 1)
        self._pages_fetched += 1

        try:
            detect_block(response.text, response.status)
            parsed = parse_listing_page(response.text)
        except CaptchaDetected as exc:
            logger.error("CAPTCHA en listado page=%s: %s", page, exc)
            return
        except (BlockedError, HttpStatusError) as exc:
            logger.error("Bloqueo en listado page=%s: %s", page, exc)
            return
        except Exception as exc:
            logger.exception("Error parseando listado page=%s: %s", page, exc)
            return

        items = parsed["items"]
        logger.info(
            "Listado page=%s items=%s total_pages=%s total_results=%s latency=%.2fs",
            page,
            len(items),
            parsed.get("total_pages"),
            parsed.get("total_results"),
            response.meta.get("download_latency") or 0,
        )

        for item in items:
            yield CrawlJobItem(
                version_id=item["version_id"],
                url=item["url"],
                brand=item.get("brand"),
                model=item.get("model"),
                version_name=item.get("version_name"),
                body_type=item.get("body_type"),
                doors=item.get("doors"),
                fuel_type=item.get("fuel_type"),
                year_from=item.get("year_from"),
                year_to=item.get("year_to"),
                hp=item.get("hp"),
            )

        total_pages = parsed.get("total_pages") or page
        next_page = page + 1
        reached_limit = self.max_pages > 0 and self._pages_fetched >= self.max_pages
        if next_page <= total_pages and not reached_limit:
            yield scrapy.Request(
                self._page_url(next_page),
                callback=self.parse,
                errback=self.errback,
                meta={"page": next_page},
                dont_filter=True,
            )

    def errback(self, failure):
        logger.error("Request fallida: %s", failure)
