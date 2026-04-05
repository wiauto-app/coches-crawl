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
