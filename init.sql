-- Makes (secciones/marcas)
CREATE TABLE IF NOT EXISTS makes (
  id SERIAL PRIMARY KEY,
  section_1_id INT NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Models
CREATE TABLE IF NOT EXISTS models (
  id SERIAL PRIMARY KEY,
  make_id INT NOT NULL REFERENCES makes(id) ON DELETE CASCADE,
  model_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(make_id, model_id)
);

-- Body Types
CREATE TABLE IF NOT EXISTS body_types (
  id SERIAL PRIMARY KEY,
  body_type_id INT NOT NULL,
  doors INT,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(body_type_id, doors)
);

-- Fuel Types
CREATE TABLE IF NOT EXISTS fuel_types (
  id SERIAL PRIMARY KEY,
  fuel_id INT NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Years
CREATE TABLE IF NOT EXISTS years (
  id SERIAL PRIMARY KEY,
  year INT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Versions (la tabla más importante - combinaciones específicas)
CREATE TABLE IF NOT EXISTS versions (
  id SERIAL PRIMARY KEY,
  version_id INT NOT NULL UNIQUE,
  make_id INT NOT NULL REFERENCES makes(id) ON DELETE CASCADE,
  model_id INT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  body_type_id INT NOT NULL REFERENCES body_types(id) ON DELETE CASCADE,
  fuel_type_id INT NOT NULL REFERENCES fuel_types(id) ON DELETE CASCADE,
  year_id INT NOT NULL REFERENCES years(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  technical_url_path VARCHAR(512),
  specs_scraped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Especificaciones técnicas por versión
CREATE TABLE IF NOT EXISTS version_specifications (
  id SERIAL PRIMARY KEY,
  version_id INT NOT NULL UNIQUE REFERENCES versions(version_id) ON DELETE CASCADE,
  acceleration NUMERIC(6, 2),
  consumption_average NUMERIC(6, 2),
  consumption_extra_urban NUMERIC(6, 2),
  consumption_urban NUMERIC(6, 2),
  cubic_capacity INT,
  cylinders VARCHAR(255),
  distribution VARCHAR(255),
  doors INT,
  emissions NUMERIC(10, 2),
  fuel_tank_capacity NUMERIC(8, 2),
  fuel_type VARCHAR(100),
  gear_box VARCHAR(100),
  height INT,
  length INT,
  width INT,
  weight INT,
  hp INT,
  hp_rpm INT,
  torque NUMERIC(10, 2),
  torque_rpm INT,
  seats INT,
  luggage_capacity INT,
  supply VARCHAR(255),
  traction VARCHAR(100),
  top_speed INT,
  year INT,
  price NUMERIC(12, 2),
  init_marketed_date TIMESTAMP,
  images JSONB,
  marketed_versions JSONB,
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  crawl_id UUID
);

-- Crawl logs para tracking
CREATE TABLE IF NOT EXISTS crawl_logs (
  id SERIAL PRIMARY KEY,
  crawl_id UUID NOT NULL,
  crawl_type VARCHAR(20) DEFAULT 'catalog',
  status VARCHAR(50),
  processed_count INT DEFAULT 0,
  total_count INT DEFAULT 0,
  error_count INT DEFAULT 0,
  message TEXT,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Cola de fichas técnicas (Scrapy)
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

-- Ficha denormalizada (consulta rápida)
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


-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_models_make_id ON models(make_id);
CREATE INDEX IF NOT EXISTS idx_body_types_id ON body_types(body_type_id);
CREATE INDEX IF NOT EXISTS idx_fuel_types_id ON fuel_types(fuel_id);
CREATE INDEX IF NOT EXISTS idx_versions_make ON versions(make_id);
CREATE INDEX IF NOT EXISTS idx_versions_model ON versions(model_id);
CREATE INDEX IF NOT EXISTS idx_versions_body_type ON versions(body_type_id);
CREATE INDEX IF NOT EXISTS idx_versions_fuel_type ON versions(fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_versions_year ON versions(year_id);
CREATE INDEX IF NOT EXISTS idx_version_specifications_version_id ON version_specifications(version_id);
CREATE INDEX IF NOT EXISTS idx_crawl_logs_crawl_id ON crawl_logs(crawl_id);
