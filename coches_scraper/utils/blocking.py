from __future__ import annotations


class CaptchaDetected(Exception):
    pass


class BlockedError(Exception):
    pass


class HttpStatusError(Exception):
    def __init__(self, status: int, message: str | None = None):
        self.status = status
        super().__init__(message or f"HTTP status {status}")


def detect_block(html: str, status: int | None = None) -> None:
    if status is not None and status != 200:
        if status in {403, 405, 429, 503}:
            raise BlockedError(f"Respuesta bloqueada con status {status}")
        raise HttpStatusError(status)

    sample = (html or "")[:12_000].lower()
    if not sample:
        raise BlockedError("HTML vacío")

    captcha_markers = (
        "captcha",
        "px-captcha",
        "datadome",
        "cf-challenge",
        "challenge-platform",
        "verify you are human",
    )
    if any(marker in sample for marker in captcha_markers):
        raise CaptchaDetected("CAPTCHA / challenge detectado")

    block_markers = (
        "access denied",
        "parece que algo no va bien",
        "ups!",
        "please enable js",
    )
    if any(marker in sample for marker in block_markers):
        raise BlockedError("Página de bloqueo detectada")

    if "window.__INITIAL_PROPS__" not in (html or ""):
        raise BlockedError("No se encontró __INITIAL_PROPS__")
