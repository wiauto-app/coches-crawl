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
  make_id INT NOT NULL REFERENCES makes(id) ON DELETE CASCADE,
  model_id INT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  body_type_id INT NOT NULL REFERENCES body_types(id) ON DELETE CASCADE,
  fuel_type_id INT NOT NULL REFERENCES fuel_types(id) ON DELETE CASCADE,
  year_id INT NOT NULL REFERENCES years(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(model_id, body_type_id, fuel_type_id, year_id)
);

-- Crawl logs para tracking
CREATE TABLE IF NOT EXISTS crawl_logs (
  id SERIAL PRIMARY KEY,
  crawl_id UUID NOT NULL,
  status VARCHAR(50),
  processed_count INT DEFAULT 0,
  total_count INT DEFAULT 0,
  error_count INT DEFAULT 0,
  message TEXT,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_models_make_id ON models(make_id);
CREATE INDEX IF NOT EXISTS idx_body_types_id ON body_types(body_type_id);
CREATE INDEX IF NOT EXISTS idx_fuel_types_id ON fuel_types(fuel_id);
CREATE INDEX IF NOT EXISTS idx_versions_make ON versions(make_id);
CREATE INDEX IF NOT EXISTS idx_versions_model ON versions(model_id);
CREATE INDEX IF NOT EXISTS idx_versions_body_type ON versions(body_type_id);
CREATE INDEX IF NOT EXISTS idx_versions_fuel_type ON versions(fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_versions_year ON versions(year_id);
CREATE INDEX IF NOT EXISTS idx_crawl_logs_crawl_id ON crawl_logs(crawl_id);
