from __future__ import annotations

from itemadapter import ItemAdapter

from coches_scraper.database.repository import CrawlRepository
from coches_scraper.database.session import get_session
from coches_scraper.items import CrawlJobItem, TechnicalSheetItem
from coches_scraper.utils.logger import get_logger

logger = get_logger(__name__)


class CrawlJobsPipeline:
    def __init__(self):
        self.buffer: list[dict] = []
        self.buffer_size = 50
        self.session = None
        self.repo: CrawlRepository | None = None

    def open_spider(self, spider):
        if spider.name != "listing":
            return
        self.session = get_session()
        self.repo = CrawlRepository(self.session)

    def close_spider(self, spider):
        if spider.name != "listing" or not self.repo:
            return
        self._flush()
        if self.session:
            self.session.close()

    def process_item(self, item, spider):
        if not isinstance(item, CrawlJobItem) or not self.repo:
            return item

        self.buffer.append(dict(ItemAdapter(item)))
        if len(self.buffer) >= self.buffer_size:
            self._flush()
        return item

    def _flush(self) -> None:
        if not self.buffer or not self.repo:
            return
        count = self.repo.upsert_crawl_jobs(self.buffer)
        logger.info("Upsert crawl_jobs: %s filas (buffer=%s)", count, len(self.buffer))
        self.buffer.clear()


class TechnicalSheetPipeline:
    def __init__(self):
        self.session = None
        self.repo: CrawlRepository | None = None

    def open_spider(self, spider):
        if spider.name != "details":
            return
        self.session = get_session()
        self.repo = CrawlRepository(self.session)

    def close_spider(self, spider):
        if spider.name != "details":
            return
        if self.session:
            self.session.close()

    def process_item(self, item, spider):
        if not isinstance(item, TechnicalSheetItem) or not self.repo:
            return item

        payload = dict(ItemAdapter(item))
        version_id = payload["version_id"]
        try:
            self.repo.save_technical_sheet(payload)
            self.repo.mark_job_status(version_id, "SUCCESS", last_error=None)
            logger.info("Ficha guardada version_id=%s", version_id)
        except Exception as exc:
            logger.exception("Error guardando ficha version_id=%s", version_id)
            self.repo.mark_job_status(version_id, "FAILED", last_error=str(exc)[:1000])
            raise
        return item
