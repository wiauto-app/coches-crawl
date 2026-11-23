# Coches.net Vehicle Crawler

A high-performance TypeScript backend for scraping vehicle specifications from coches.net API with PostgreSQL storage.

## Features

- **Robust Web Scraper**: Exponential backoff retry logic (up to 3 attempts)
- **Normalized Database**: PostgreSQL schema with proper relationships
- **Background Processing**: Non-blocking crawl jobs with status tracking
- **REST API**: Clean endpoints for crawl management and vehicle queries
- **Docker Support**: Production-ready multi-stage build
- **Comprehensive Logging**: Structured logging at all critical points
- **Strict TypeScript**: Full strict mode compilation

## Producción: sync semanal con la DB de wiauto

El crawler corre como contenedor junto al backend, comparte la red Docker `wiauto-network` y escribe en la DB de producción de wiauto:

1. **Crawl** de catálogo (JSON API de coches.net) → tablas del schema `crawl` (`crawl.makes`, `crawl.models`, `crawl.versions`, ...).
2. **Merge** transaccional (`src/sync/merge-catalog.sql`) → catálogo público `make`, `model`, `year`, `body_type`, `fuel_type`, `version`. Solo `INSERT`/`UPDATE`, nunca borra; preserva `vehicles.version_id`. Si algo falla, rollback completo.
3. **Cron** (`node-cron`) dispara crawl + merge cada lunes 03:00 Europe/Madrid. Un `pg_advisory_lock` impide ejecuciones solapadas.

### Setup (una sola vez)

1. Backend: aplicar la migración `CrawlSchema1794700000000` (crea schema `crawl` + `crawl.catalog_slugify`):

   ```bash
   pnpm migration:run   # en wiauto-backend
   ```

2. Crear el rol dedicado como superuser (`docker exec -it wiauto-postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB>`):

   ```sql
   CREATE ROLE wiauto_crawler LOGIN PASSWORD '<secret>';
   GRANT USAGE, CREATE ON SCHEMA crawl TO wiauto_crawler;
   GRANT ALL ON ALL TABLES IN SCHEMA crawl TO wiauto_crawler;
   GRANT ALL ON ALL SEQUENCES IN SCHEMA crawl TO wiauto_crawler;
   GRANT EXECUTE ON FUNCTION crawl.catalog_slugify(text) TO wiauto_crawler;
   GRANT USAGE ON SCHEMA public TO wiauto_crawler;
   GRANT SELECT, INSERT, UPDATE ON make, model, year, body_type, fuel_type, version TO wiauto_crawler;
   GRANT USAGE, SELECT, UPDATE ON SEQUENCE
     make_id_seq, model_id_seq, year_id_seq, body_type_id_seq, fuel_type_id_seq, version_id_seq
     TO wiauto_crawler;
   GRANT SELECT ON vehicles TO wiauto_crawler; -- chequeo de integridad del merge
   GRANT TEMP ON DATABASE <POSTGRES_DB> TO wiauto_crawler;
   ```

   Sin `DELETE` ni acceso a otras tablas (users, pagos, etc.). Si los nombres de secuencia difieren, verlos con `SELECT pg_get_serial_sequence('version','id');`.

3. Backup antes del primer merge en prod:

   ```bash
   docker exec wiauto-postgres pg_dump -U <POSTGRES_USER> -d <POSTGRES_DB> \
     -t make -t model -t year -t body_type -t fuel_type -t version -t vehicles \
     -Fc > catalog-backup-$(date +%Y%m%d).dump
   ```

### Variables (`.env` junto al `docker-compose.yml`)

| Variable | Default | Descripción |
| --- | --- | --- |
| `CRAWLER_DB_PASSWORD` | — (requerida) | Password de `wiauto_crawler`. URL-encode si tiene caracteres especiales (`@`, `:`, `/`, `#`). |
| `WIAUTO_DB_NAME` | — (requerida) | Mismo valor que `POSTGRES_DB` del backend. |
| `CRAWLER_DB_USER` | `wiauto_crawler` | |
| `WIAUTO_DB_HOST` | `postgres` | Servicio Postgres del backend dentro de la red (vale para prod y dev). |
| `WIAUTO_NETWORK` | `wiauto-network` | Red Docker del backend. Con `dev.yml` es `wiauto-backend_wiauto-network`. |
| `CATALOG_CRON` | `0 3 * * 1` | Expresión cron. |
| `CATALOG_CRON_TZ` | `Europe/Madrid` | |
| `CATALOG_CRON_ENABLED` | `true` | `false` desactiva el cron (endpoints manuales siguen activos). |
| `DB_POOL_MAX` | `5` | Conexiones máximas del crawler. |

Fuera de Docker se puede usar `DATABASE_URL` directamente; si no está, se usan `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` (Postgres local).

### Levantar

```bash
# 1. Backend primero (crea la red wiauto-network)
cd ../wiauto-backend && docker compose up -d
# 2. Crawler
cd ../coches-net-crawl && docker compose up -d --build
docker network inspect wiauto-network --format '{{range .Containers}}{{.Name}} {{end}}'
```

El puerto 4001 queda publicado solo en `127.0.0.1` (endpoints sin auth).

### Endpoints de sync

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `POST` | `/api/sync/catalog` | Crawl + merge en background (202). 409 si ya hay un job. |
| `POST` | `/api/sync/merge` | Solo merge, síncrono (200/500). |
| `POST` | `/api/crawl` | Solo crawl a `crawl.*`, sin merge. |
| `GET` | `/api/sync/status` | Job activo + último crawl y último merge. |

Historial en `crawl.crawl_logs` (`crawl_type` = `catalog` \| `merge` \| `specs`). El `message` del merge guarda el resumen JSON (filas insertadas/actualizadas por entidad y totales).

### Dev local

Postgres propio del crawler: `docker compose --profile local up -d postgres` y correr con `npm run dev` usando `DB_*`. Para probar contra la DB de wiauto de desarrollo (`wiauto-backend/dev.yml`, puerto 5433): `DATABASE_URL=postgres://wiauto_crawler:<pwd>@localhost:5433/wiauto npm run dev`.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.3+ (strict mode)
- **Framework**: Express.js 4.18+
- **Database**: PostgreSQL 15
- **HTTP Client**: Axios with retry logic
- **Dev Tools**: tsx, tsup, TypeScript

## Project Structure

```
.
├── src/
│   ├── server.ts                    # Express setup & middleware
│   ├── types/
│   │   └── index.ts                 # TypeScript interfaces
│   ├── db/
│   │   ├── connection.ts            # PostgreSQL pool & queries
│   │   └── schema.sql               # Database schema
│   ├── scrapers/
│   │   ├── retryClient.ts           # HTTP client with retries
│   │   └── vehiclesScraper.ts       # Main crawl logic
│   ├── routes/
│   │   └── crawlRoutes.ts           # API endpoints
│   └── utils/
│       └── logger.ts                # Structured logging
├── docker-compose.yml               # Services orchestration
├── Dockerfile                       # Multi-stage build
├── tsconfig.json                    # Strict TypeScript config
├── package.json                     # Dependencies & scripts
├── .env.example                     # Configuration template
└── README.md                        # This file
```

## Setup & Installation

### Prerequisites

- Docker & Docker Compose (recommended)
- Or: Node.js 20+, PostgreSQL 15

### Quick Start (Docker)

1. Clone the repository:
```bash
git clone <repo-url>
cd coches-net-crawl
```

2. Create `.env` from template:
```bash
cp .env.example .env
```

3. Build and run with Docker Compose:
```bash
docker-compose up --build
```

The API will be available at `http://localhost:3000`

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Configure PostgreSQL connection in `.env`:
```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=coches_db
DB_USER=coches_user
DB_PASSWORD=your_password
```

3. Initialize database:
```bash
psql -h localhost -U coches_user -d coches_db -f src/db/schema.sql
```

4. Start development server:
```bash
npm run dev
```

The server will watch for changes and reload automatically.

## Configuration

All configuration via environment variables (see `.env.example`):

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=coches_db
DB_USER=coches_user
DB_PASSWORD=coches_password_dev

# Scraper behavior
SCRAPER_TIMEOUT_MS=10000        # Request timeout
SCRAPER_RETRY_ATTEMPTS=3        # Max retry attempts
SCRAPER_DELAY_MIN_MS=500        # Min delay between requests
SCRAPER_DELAY_MAX_MS=1000       # Max delay between requests
SCRAPER_SECTION_ID=2500         # Vehicle section ID

# API
API_BASE_URL=https://vehicle-specs.coches.net

# Logging
LOG_LEVEL=info                  # debug|info|warn|error
```

## API Endpoints

### Health Check
```
GET /health

Response (200):
{ "status": "ok" }
```

### Start Crawl
```
POST /api/crawl

Response (202):
{
  "crawlId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "started",
  "startedAt": "2026-04-05T10:30:00.000Z"
}

Error (409 Conflict):
{
  "error": "Crawl already in progress",
  "crawlId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Get Crawl Status
```
GET /api/crawl/status?crawlId={crawlId}

Response (200):
{
  "crawlId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running|completed|failed",
  "progress": {
    "processed": 123,
    "total": 456
  },
  "errors": 5,
  "startedAt": "2026-04-05T10:30:00.000Z",
  "completedAt": "2026-04-05T12:45:00.000Z"
}

Error (404 Not Found):
{ "error": "Crawl not found" }
```

### Get Vehicles
```
GET /api/vehicles?limit=50&offset=0

Response (200):
{
  "total": 45000,
  "data": [
    {
      "id": 1,
      "make_id": 1,
      "model_id": 2,
      "body_type_id": 3,
      "fuel_type_id": 4,
      "year_id": 5,
      "name": "BMW 3 Series Sedan 2024",
      "created_at": "2026-04-05T10:30:00.000Z"
    },
    ...
  ],
  "limit": 50,
  "offset": 0
}
```

## Database Schema

### Tables

**makes**: Vehicle manufacturers
- `id` - Primary key
- `section_1_id` - API section identifier (unique)
- `name` - Make name
- `created_at` - Timestamp

**models**: Vehicle models
- `id` - Primary key
- `make_id` - Foreign key to makes
- `model_id` - API model identifier
- `name` - Model name
- `created_at` - Timestamp

**body_types**: Vehicle body types (sedan, SUV, etc.)
- `id` - Primary key
- `body_type_id` - API body type identifier
- `doors` - Number of doors (nullable)
- `name` - Body type name
- `created_at` - Timestamp

**fuel_types**: Fuel types (petrol, diesel, electric, etc.)
- `id` - Primary key
- `fuel_id` - API fuel type identifier (unique)
- `name` - Fuel type name
- `created_at` - Timestamp

**years**: Model years
- `id` - Primary key
- `year` - Year (unique)
- `created_at` - Timestamp

**versions**: Complete vehicle specifications (key table)
- `id` - Primary key
- `make_id` - Foreign key to makes
- `model_id` - Foreign key to models
- `body_type_id` - Foreign key to body_types
- `fuel_type_id` - Foreign key to fuel_types
- `year_id` - Foreign key to years
- `name` - Version name/designation
- `created_at` - Timestamp

**crawl_logs**: Crawl job tracking
- `id` - Primary key
- `crawl_id` - UUID for crawl job
- `status` - running|completed|failed
- `processed_count` - Makes processed
- `total_count` - Total makes to process
- `error_count` - Errors encountered
- `message` - Last error message
- `started_at` - Crawl start time
- `completed_at` - Crawl completion time

## Scraper Logic

The crawler follows a hierarchical flow:

1. **Fetch Makes** - All vehicle manufacturers
2. **For Each Make** → Fetch Models
3. **For Each Model** → Fetch Body Types
4. **For Each Body Type** → Fetch Fuel Types
5. **For Each Fuel Type** → Fetch Years
6. **For Each Year** → Fetch Versions

### Features

- **Automatic Retries**: 3 attempts with exponential backoff (1s → 2s → 4s)
- **Random Delays**: 500-1000ms between sequential requests (prevents rate limiting)
- **Error Handling**: Continues on failure, logs errors, doesn't stop entire crawl
- **Deduplication**: INSERT ON CONFLICT DO NOTHING prevents duplicate entries
- **Normalized Storage**: Relationships preserved, minimal data duplication

## Running Scripts

```bash
# Development (with auto-reload)
npm run dev

# Build production bundle
npm run build

# Start production server
npm start

# Type checking
npm run type-check

# Linting (ESLint)
npm run lint

# Initialize database
npm run db:init
```

## Docker Commands

```bash
# Build images
docker-compose build

# Start services
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f app
docker-compose logs -f postgres

# Stop services
docker-compose down

# Remove volumes (delete data)
docker-compose down -v
```

## Development Workflow

1. Start dev server:
```bash
npm run dev
```

2. In another terminal, start database:
```bash
docker-compose up postgres
```

3. Make changes - server reloads automatically

4. Check types:
```bash
npm run type-check
```

## Production Deployment

1. Build Docker image:
```bash
docker build -t coches-crawler:latest .
```

2. Run container:
```bash
docker run -d \
  -p 3000:3000 \
  -e DB_HOST=postgres \
  -e NODE_ENV=production \
  coches-crawler:latest
```

3. Or use docker-compose in production:
```bash
docker-compose -f docker-compose.yml up -d
```

## Monitoring & Debugging

### View Logs
```bash
# Application logs
docker-compose logs -f app

# Database logs
docker-compose logs -f postgres

# Combined
docker-compose logs -f
```

### Access Database
```bash
docker exec -it coches_postgres psql -U coches_user -d coches_db

# Inside psql:
\dt                                    # List tables
SELECT COUNT(*) FROM versions;         # Count versions
SELECT * FROM crawl_logs;              # Check crawl status
```

### Check Health
```bash
curl http://localhost:3000/health
```

## Performance Considerations

- **Connection Pooling**: 20 max connections to PostgreSQL
- **Indexes**: Strategic indexes on foreign keys and crawl_id
- **Pagination**: API limits results to 1000 items per request
- **Sequential Crawling**: Respectful rate limiting (500-1000ms delays)

## Error Handling

The scraper is resilient to errors:

- Request fails → retry with backoff
- Version insertion fails → log and continue
- Crawl completes with partial data → check crawl_logs for error_count

All errors are logged with:
- Timestamp
- Error level (debug|info|warn|error)
- Context (which make/model/etc.)
- Error message

## Troubleshooting

### Database Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
- Check PostgreSQL is running: `docker-compose ps`
- Verify DB credentials in .env
- Check `docker-compose logs postgres`

### Crawl Hangs
- Check API connectivity: `curl https://vehicle-specs.coches.net/vehicle-specs/v1/makes/form?section1Id=2500`
- Check logs: `docker-compose logs -f app`
- Increase timeout: `SCRAPER_TIMEOUT_MS=20000`

### Duplicate Entries
- Schema uses UNIQUE constraints with ON CONFLICT DO NOTHING
- Safe to re-run crawls without clearing data

## License

Proprietary - All rights reserved

## Support

For issues or questions, check logs and ensure:
1. PostgreSQL is healthy
2. API endpoint is accessible
3. Environment variables are correct
4. Network connectivity is stable
