from __future__ import annotations

from pathlib import Path

import pytest

from coches_scraper.parsers.initial_props import extract_version_id_from_url
from coches_scraper.parsers.listing import parse_listing_page
from coches_scraper.parsers.technical_sheet import parse_technical_sheet
from coches_scraper.utils.blocking import BlockedError, CaptchaDetected, detect_block

FIXTURES = Path(__file__).parent / "fixtures"


def test_extract_version_id_from_url():
    assert (
        extract_version_id_from_url(
            "/fichas_tecnicas/abarth/124_spider/cabrio/2-puertas/124_spider_125kw_170cv/85308/"
        )
        == 85308
    )


def test_parse_listing_page():
    html = (FIXTURES / "listing_sample.html").read_text(encoding="utf-8")
    parsed = parse_listing_page(html)
    assert parsed["total_pages"] == 6152
    assert parsed["total_results"] == 123034
    assert len(parsed["items"]) == 2
    first = parsed["items"][0]
    assert first["version_id"] == 85308
    assert first["brand"] == "ABARTH"
    assert first["url"].endswith("/85308/")


def test_parse_technical_sheet():
    html = (FIXTURES / "detail_sample.html").read_text(encoding="utf-8")
    sheet = parse_technical_sheet(html, expected_version_id=85308)
    assert sheet["version_id"] == 85308
    assert sheet["make_id"] == 20
    assert sheet["model_id"] == 1234
    assert sheet["brand"] == "ABARTH"
    assert sheet["fuel"] == "Gasolina"
    assert sheet["power"] == 170
    assert sheet["gearbox"] == "Manual 6"
    assert sheet["specifications"]["cubicCapacity"] == 1368


def test_detect_block_captcha():
    with pytest.raises(CaptchaDetected):
        detect_block("<html>please solve captcha</html>", 200)


def test_detect_block_waf():
    with pytest.raises(BlockedError):
        detect_block("<html>Ups! Parece que algo no va bien...</html>", 405)
