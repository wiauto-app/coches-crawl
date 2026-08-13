from __future__ import annotations

import os

from scrapy import signals


class CochesProxyMiddleware:
    """Aplica COCHES_HTTP_PROXY / HTTPS_PROXY / HTTP_PROXY a cada request."""

    @classmethod
    def from_crawler(cls, crawler):
        middleware = cls()
        crawler.signals.connect(middleware.spider_opened, signal=signals.spider_opened)
        return middleware

    def spider_opened(self, spider):
        proxy = (
            os.getenv("COCHES_HTTP_PROXY")
            or os.getenv("HTTPS_PROXY")
            or os.getenv("HTTP_PROXY")
        )
        self.proxy = proxy
        if proxy:
            spider.logger.info("Proxy activo: %s", proxy)
        else:
            spider.logger.info("Sin proxy configurado")

    def process_request(self, request, spider):
        if getattr(self, "proxy", None) and "proxy" not in request.meta:
            request.meta["proxy"] = self.proxy
        return None
