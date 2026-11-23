# Coches.net Scrapy Scraper

Scraper de fichas técnicas basado en Scrapy + PostgreSQL.

## Decisiones importantes (modificaciones al plan)

1. **No usar Playwright por defecto.** Chromium (headless/headed) recibe `HTTP 405` del WAF. El HTML SSR con `window.__INITIAL_PROPS__` se obtiene con HTTP normal (Scrapy / httpx) si hay rate limit y headers de navegador.
2. **El buscador reemplaza spiders de marca/modelo/versión.** Una sola paginación (`?pg=N&fi=title&or=1`) entrega ~123 034 fichas en ~6152 páginas.
3. **`version_id`** = último segmento numérico de la URL (`.../85308/`). También viene en el JSON de detalle.
4. Scrapy 2.17 usa `async def start()` (no `start_requests`).
5. `cylinders` en BD es `VARCHAR` (Coches.net lo manda como texto, p. ej. `"En línea"`).

Flujo técnico:

- Listado/detalle → Scrapy HTTP
- Parseo offline → `__INITIAL_PROPS__` → JSON → Postgres
- Playwright solo con `USE_PLAYWRIGHT=true` (experimental)

## Requisitos

- Python 3.13
- Docker (Postgres del `docker-compose.yml`)
- venv del proyecto

## Setup

```bash
cd coches-net-crawl
docker compose up -d postgres

python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
python -m coches_scraper.scripts.init_schema
```

## Flujo

### 1) POC (1 listado + 1 ficha)

```bash
python -m coches_scraper.scripts.poc_fetch --page 1
```

### 2) Descubrir URLs (cola `crawl_jobs`)

```bash
# primeras 3 páginas (~60 versiones)
scrapy crawl listing -a max_pages=3

# todas (~6152 páginas / ~123034 versiones)
scrapy crawl listing
```

Cada item guarda:

- `version_id` (último segmento numérico de la URL)
- `url`
- metadatos del listado
- `status=PENDING`

### 3) Procesar fichas pendientes

```bash
# lote de 20
scrapy crawl details -a batch_size=20 -a max_items=20

# producción (lotes de 100)
scrapy crawl details
```

Estados:

- `PENDING` → `RUNNING` → `SUCCESS`
- `FAILED` (parse/red)
- `BLOCKED` (CAPTCHA / WAF) → reintento automático tras 6h

### 4) Monitor

```bash
uvicorn coches_scraper.services.monitor_api:app --host 0.0.0.0 --port 8001
```

- `GET /stats`
- `POST /requeue/blocked`
- `POST /requeue/stale-running`

## Tablas relevantes

- `technical_sheets` — ficha denormalizada
- `versions` + `version_specifications` — compatible con import Wiauto
- `makes` / `models` / `body_types` / `fuel_types` / `years`

`version_id` es el ID externo de Coches.net y la clave de unión.

## Tests

```bash
pytest coches_scraper/tests -q
```

## Rate limit recomendado

Empieza conservador:

```env
DOWNLOAD_DELAY=3
CONCURRENT_REQUESTS=4
CONCURRENT_REQUESTS_PER_DOMAIN=2
```

Si aparecen muchos `BLOCKED`, sube el delay a 5–8s y baja concurrencia a 1–2.

## Bloqueo WAF 403/405

Si `poc_fetch` o los spiders reciben `405` / página "Ups! Parece que algo no va bien...":

- La **home** de coches.net puede seguir en 200.
- `/fichas_tecnicas/*` está bloqueado para esa IP.

Solución habitual:

```bash
# VPN o proxy residencial
export COCHES_HTTP_PROXY='http://user:pass@host:port'
python -m coches_scraper.scripts.poc_fetch --page 1
```

Evita lanzar Playwright contra esa IP: empeora el ban.
