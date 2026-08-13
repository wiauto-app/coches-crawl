from __future__ import annotations

from typing import Any

from coches_scraper.parsers.initial_props import (
    extract_initial_props,
    normalize_technical_url,
)


SPECIFICATION_FIELDS = (
    "acceleration",
    "bodyType",
    "consumptionAverage",
    "consumptionExtraUrban",
    "consumptionUrban",
    "cubicCapacity",
    "cylinders",
    "distribution",
    "doors",
    "emissions",
    "fuelTankCapacity",
    "fuelType",
    "gearBox",
    "height",
    "hp",
    "hpRpm",
    "length",
    "luggageCapacity",
    "seats",
    "supply",
    "topSpeed",
    "torque",
    "torqueRpm",
    "traction",
    "weight",
    "width",
)


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        match = value.strip()
        if match.isdigit():
            return int(match)
        digits = "".join(ch for ch in match if ch.isdigit())
        if digits:
            return int(digits)
    return None


def parse_technical_sheet(html: str, *, expected_version_id: int | None = None) -> dict[str, Any]:
    props = extract_initial_props(html)
    page_info = props.get("pageInfoResponse") or {}
    if not isinstance(page_info, dict):
        raise ValueError("pageInfoResponse debe ser un objeto")

    version_id = props.get("versionId") or page_info.get("versionId")
    version_id = _as_int(version_id)
    if version_id is None:
        raise ValueError("No se encontró versionId en la ficha técnica")

    if expected_version_id is not None and version_id != expected_version_id:
        raise ValueError(
            f"versionId del JSON ({version_id}) no coincide con esperado ({expected_version_id})"
        )

    specs_raw = page_info.get("specifications") or {}
    if not isinstance(specs_raw, dict):
        raise ValueError("specifications debe ser un objeto")

    specifications = {field: specs_raw.get(field) for field in SPECIFICATION_FIELDS}

    doors = (
        _as_int(props.get("doors"))
        or _as_int(page_info.get("doors"))
        or _as_int(specifications.get("doors"))
    )
    year = _as_int(page_info.get("year")) or _as_int(props.get("year"))

    make_url = props.get("makeUrlParam") or props.get("make")
    model_url = props.get("modelUrlParam") or props.get("model")
    body_type = props.get("bodyType") or page_info.get("bodyType") or specifications.get("bodyType")
    version_slug = props.get("version")

    canonical_url = None
    if make_url and model_url and body_type and doors is not None and version_slug:
        canonical_url = normalize_technical_url(
            f"/fichas_tecnicas/{make_url}/{model_url}/{body_type}/{doors}-puertas/{version_slug}/{version_id}/"
        )

    return {
        "version_id": version_id,
        "make_id": _as_int(page_info.get("makeId")),
        "model_id": _as_int(page_info.get("modelId")),
        "brand": props.get("makeName") or page_info.get("make") or props.get("make"),
        "model": props.get("modelName") or page_info.get("model") or props.get("model"),
        "version_name": version_slug,
        "body_type": body_type,
        "doors": doors,
        "year": year,
        "fuel": specifications.get("fuelType"),
        "power": specifications.get("hp"),
        "engine": specifications.get("cubicCapacity"),
        "gearbox": specifications.get("gearBox"),
        "traction": specifications.get("traction"),
        "price": page_info.get("price"),
        "init_marketed_date": page_info.get("initMarketedDate"),
        "url": canonical_url,
        "images": page_info.get("images") or [],
        "marketed_versions": page_info.get("marketedVersions") or [],
        "specifications": specifications,
    }
