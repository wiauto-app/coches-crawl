from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}


@dataclass
class HttpResponse:
    status_code: int
    text: str
    url: str
    content: bytes


def get_proxy_url() -> str | None:
    return (
        os.getenv("COCHES_HTTP_PROXY")
        or os.getenv("HTTPS_PROXY")
        or os.getenv("HTTP_PROXY")
        or None
    )


def fetch_html(url: str, *, referer: str | None = None, timeout: float = 60) -> HttpResponse:
    """
    Cliente HTTP con fingerprint Chrome (curl_cffi) y proxy opcional.

    Variables:
      COCHES_HTTP_PROXY / HTTPS_PROXY / HTTP_PROXY
      COCHES_IMPERSONATE (default: chrome131)
    """
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers["Referer"] = referer
        headers["Sec-Fetch-Site"] = "same-origin"

    proxy = get_proxy_url()
    impersonate = os.getenv("COCHES_IMPERSONATE", "chrome131")

    try:
        from curl_cffi import requests as curl_requests
    except ImportError:
        import httpx

        with httpx.Client(
            headers=headers,
            follow_redirects=True,
            timeout=timeout,
            proxy=proxy,
        ) as client:
            response = client.get(url)
            return HttpResponse(
                status_code=response.status_code,
                text=response.text,
                url=str(response.url),
                content=response.content,
            )

    session = curl_requests.Session(impersonate=impersonate)
    # Warm-up: la home suele no estar bloqueada y ayuda a cookies/sesión.
    try:
        session.get("https://www.coches.net/", headers=headers, timeout=timeout, proxy=proxy)
    except Exception:
        pass

    response = session.get(
        url,
        headers=headers,
        timeout=timeout,
        proxy=proxy,
        allow_redirects=True,
    )
    return HttpResponse(
        status_code=response.status_code,
        text=response.text,
        url=str(response.url),
        content=response.content,
    )
