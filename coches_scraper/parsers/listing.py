from __future__ import annotations

from typing import Any

from coches_scraper.parsers.initial_props import (
    extract_initial_props,
    extract_version_id_from_url,
    normalize_technical_url,
)


def parse_listing_page(html: str) -> dict[str, Any]:
    props = extract_initial_props(html)
    results = props.get("initialResultsResponse") or {}
    raw_items = results.get("items") or []
    meta = results.get("meta") or {}

    items: list[dict[str, Any]] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        url = raw.get("url")
        if not isinstance(url, str) or not url:
            continue
        version_id = extract_version_id_from_url(url)
        items.append(
            {
                "version_id": version_id,
                "url": normalize_technical_url(url),
                "brand": raw.get("make"),
                "model": raw.get("model"),
                "version_name": raw.get("version"),
                "body_type": raw.get("bodyType"),
                "doors": raw.get("doors"),
                "hp": raw.get("hp"),
                "fuel_type": raw.get("fuelType"),
                "year_from": raw.get("yearFrom"),
                "year_to": raw.get("yearTo"),
            }
        )

    total_pages = meta.get("totalPages")
    total_results = meta.get("totalResults")
    current_page = (props.get("search") or {}).get("page") or 1

    return {
        "items": items,
        "current_page": int(current_page),
        "total_pages": int(total_pages) if total_pages is not None else None,
        "total_results": int(total_results) if total_results is not None else None,
        "pagination_url": props.get("paginationUrl"),
    }
