from __future__ import annotations

import json
import re
from typing import Any


INITIAL_PROPS_MARKER = "window.__INITIAL_PROPS__"
_JSON_PARSE_RE = re.compile(
    r'window\.__INITIAL_PROPS__\s*=\s*JSON\.parse\("((?:\\.|[^"\\])*)"\)',
    re.DOTALL,
)
_VERSION_ID_RE = re.compile(r"/(\d+)/?$")


def extract_initial_props(html: str) -> dict[str, Any]:
    if not html or not html.strip():
        raise ValueError("El HTML no puede estar vacío")

    match = _JSON_PARSE_RE.search(html)
    if not match:
        raise ValueError("No se encontró window.__INITIAL_PROPS__ = JSON.parse(...)")

    serialized = '"' + match.group(1) + '"'
    try:
        json_text = json.loads(serialized)
    except json.JSONDecodeError as exc:
        raise ValueError("No se pudo decodificar la cadena de __INITIAL_PROPS__") from exc

    if not isinstance(json_text, str):
        raise ValueError("__INITIAL_PROPS__ no contiene una cadena JSON válida")

    try:
        payload = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ValueError("El contenido de __INITIAL_PROPS__ no es JSON válido") from exc

    if not isinstance(payload, dict):
        raise ValueError("__INITIAL_PROPS__ debe contener un objeto")

    return payload


def extract_version_id_from_url(url: str) -> int:
    match = _VERSION_ID_RE.search(url.strip())
    if not match:
        raise ValueError(f"No se pudo extraer version_id de la URL: {url}")
    return int(match.group(1))


def normalize_technical_url(url: str) -> str:
    path = url.strip()
    if path.startswith("http://") or path.startswith("https://"):
        from urllib.parse import urlparse

        path = urlparse(path).path
    if not path.startswith("/"):
        path = f"/{path}"
    if not path.endswith("/"):
        path = f"{path}/"
    return path
