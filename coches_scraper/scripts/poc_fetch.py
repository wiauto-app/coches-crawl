from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from coches_scraper.parsers.listing import parse_listing_page
from coches_scraper.parsers.technical_sheet import parse_technical_sheet
from coches_scraper.services.http_client import fetch_html, get_proxy_url
from coches_scraper.utils.blocking import BlockedError, CaptchaDetected, detect_block


BLOCKED_HELP = """
============================================================
Coches.net está bloqueando esta IP en /fichas_tecnicas/*
(status 403/405 + página "Ups! Parece que algo no va bien...")
============================================================

No es un fallo del parser. El WAF (DataDome) deniega el acceso
a las fichas técnicas desde esta red.

Opciones:
  1) Cambia de red / activa VPN y vuelve a ejecutar.
  2) Usa un proxy residencial:
       export COCHES_HTTP_PROXY='http://user:pass@host:port'
       python -m coches_scraper.scripts.poc_fetch --page 1
  3) Espera varias horas (el ban suele ser temporal).
  4) Evita Playwright desde esta IP: empeora el bloqueo.

Proxy actual: {proxy}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="POC scrape coches.net via HTTP")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--save-dir", type=Path, default=Path("tmp/poc"))
    args = parser.parse_args()

    list_url = f"https://www.coches.net/fichas_tecnicas/buscador/?pg={args.page}&fi=title&or=1"
    args.save_dir.mkdir(parents=True, exist_ok=True)
    proxy = get_proxy_url()
    print(f"Usando proxy: {proxy or '(ninguno)'}")
    last_html = ""

    try:
        started = time.perf_counter()
        list_resp = fetch_html(list_url)
        last_html = list_resp.text
        list_latency = time.perf_counter() - started
        print(
            f"LIST status={list_resp.status_code} latency={list_latency:.2f}s bytes={len(list_resp.content)}"
        )
        detect_block(list_resp.text, list_resp.status_code)
        listing = parse_listing_page(list_resp.text)
        (args.save_dir / f"list_page_{args.page}.html").write_text(
            list_resp.text, encoding="utf-8"
        )
        print(
            json.dumps(
                {
                    "items": len(listing["items"]),
                    "total_pages": listing["total_pages"],
                    "total_results": listing["total_results"],
                    "first": listing["items"][0] if listing["items"] else None,
                },
                ensure_ascii=False,
                indent=2,
            )
        )

        if not listing["items"]:
            print("El listado no devolvió items.")
            return 1

        first = listing["items"][0]
        detail_url = "https://www.coches.net" + first["url"]
        time.sleep(2.5)
        started = time.perf_counter()
        detail_resp = fetch_html(detail_url, referer=list_url)
        last_html = detail_resp.text
        detail_latency = time.perf_counter() - started
        print(
            f"DETAIL status={detail_resp.status_code} latency={detail_latency:.2f}s bytes={len(detail_resp.content)}"
        )
        detect_block(detail_resp.text, detail_resp.status_code)
        sheet = parse_technical_sheet(
            detail_resp.text, expected_version_id=first["version_id"]
        )
        (args.save_dir / f"detail_{first['version_id']}.html").write_text(
            detail_resp.text, encoding="utf-8"
        )
        (args.save_dir / f"detail_{first['version_id']}.json").write_text(
            json.dumps(sheet, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        print(
            json.dumps(
                {
                    "version_id": sheet["version_id"],
                    "brand": sheet["brand"],
                    "model": sheet["model"],
                    "fuel": sheet["fuel"],
                    "power": sheet["power"],
                    "gearbox": sheet["gearbox"],
                    "specs_fields": len(sheet["specifications"]),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except (BlockedError, CaptchaDetected) as exc:
        print(f"\nBloqueo detectado: {exc}")
        print(BLOCKED_HELP.format(proxy=proxy or "(ninguno)"))
        if last_html:
            (args.save_dir / "blocked_response.html").write_text(
                last_html, encoding="utf-8"
            )
        return 2


if __name__ == "__main__":
    sys.exit(main())
