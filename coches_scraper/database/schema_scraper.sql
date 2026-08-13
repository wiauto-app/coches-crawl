-- Extiende el schema del crawl con cola de trabajos y fichas denormalizadas.
-- Compatible con makes/models/versions existentes (import Wiauto).

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id SERIAL PRIMARY KEY,
  version_id INT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  brand VARCHAR(100),
  model VARCHAR(100),
  version_name VARCHAR(255),
  body_type VARCHAR(100),
  doors INT,
  fuel_type VARCHAR(100),
  year_from INT,
  year_to INT,
  hp INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status_updated ON crawl_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS technical_sheets (
  id SERIAL PRIMARY KEY,
  version_id INT NOT NULL UNIQUE,
  brand VARCHAR(100),
  model VARCHAR(100),
  version VARCHAR(255),
  year INT,
  fuel VARCHAR(100),
  power INT,
  engine INT,
  gearbox VARCHAR(100),
  traction VARCHAR(100),
  doors INT,
  body VARCHAR(100),
  url TEXT,
  specifications JSONB,
  images JSONB,
  marketed_versions JSONB,
  price NUMERIC(12, 2),
  scraped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_technical_sheets_brand_model
  ON technical_sheets(brand, model);

-- Coches.net envía cylinders como texto ("En línea"), no como entero.
ALTER TABLE version_specifications
  ALTER COLUMN cylinders TYPE VARCHAR(255)
  USING cylinders::text;
