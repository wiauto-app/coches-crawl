from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BOT_NAME = "coches_scraper"
SPIDER_MODULES = ["coches_scraper.spiders"]
NEWSPIDER_MODULE = "coches_scraper.spiders"

ROBOTSTXT_OBEY = False
COOKIES_ENABLED = True
TELNETCONSOLE_ENABLED = False

DEFAULT_REQUEST_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# Rate limit humano (modificación al plan: HTTP > Playwright por WAF)
DOWNLOAD_DELAY = float(os.getenv("DOWNLOAD_DELAY", "3"))
RANDOMIZE_DOWNLOAD_DELAY = os.getenv("RANDOMIZE_DOWNLOAD_DELAY", "true").lower() in {
    "1",
    "true",
    "yes",
}
CONCURRENT_REQUESTS = int(os.getenv("CONCURRENT_REQUESTS", "4"))
CONCURRENT_REQUESTS_PER_DOMAIN = int(os.getenv("CONCURRENT_REQUESTS_PER_DOMAIN", "2"))
DOWNLOAD_TIMEOUT = 60
RETRY_ENABLED = True
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 522, 524, 408]

# Playwright desactivado por defecto: el WAF de coches.net responde 405
USE_PLAYWRIGHT = os.getenv("USE_PLAYWRIGHT", "false").lower() in {"1", "true", "yes"}
PLAYWRIGHT_BROWSER_TYPE = "chromium"
PLAYWRIGHT_LAUNCH_OPTIONS = {
    "headless": os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() in {"1", "true", "yes"},
}
PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT = 45_000

if USE_PLAYWRIGHT:
    DOWNLOAD_HANDLERS = {
        "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
        "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    }
    TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"

DOWNLOADER_MIDDLEWARES = {
    "coches_scraper.middlewares.CochesProxyMiddleware": 350,
}

ITEM_PIPELINES = {
    "coches_scraper.pipelines.CrawlJobsPipeline": 100,
    "coches_scraper.pipelines.TechnicalSheetPipeline": 200,
}

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

BASE_DIR = Path(__file__).resolve().parent.parent
LIST_START_PAGE = int(os.getenv("LIST_START_PAGE", "1"))
LIST_MAX_PAGES = int(os.getenv("LIST_MAX_PAGES", "0"))
DETAILS_BATCH_SIZE = int(os.getenv("DETAILS_BATCH_SIZE", "100"))
DETAILS_MAX_ITEMS = int(os.getenv("DETAILS_MAX_ITEMS", "0"))

BASE_SITE_URL = "https://www.coches.net"
LISTING_PATH = "/fichas_tecnicas/buscador/"
