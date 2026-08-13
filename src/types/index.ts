export interface Make {
  id: number;
  section_1_id: number;
  name: string;
  created_at: string;
}

export interface Model {
  id: number;
  make_id: number;
  model_id: number;
  name: string;
  created_at: string;
}

export interface BodyType {
  id: number;
  body_type_id: number;
  doors: number | null;
  name: string;
  created_at: string;
}

export interface FuelType {
  id: number;
  fuel_id: number;
  name: string;
  created_at: string;
}

export interface Year {
  id: number;
  year: number;
  created_at: string;
}

export interface Version {
  id: number;
  version_id: number;
  make_id: number;
  model_id: number;
  body_type_id: number;
  fuel_type_id: number;
  year_id: number;
  name: string;
  created_at: string;
}

export type CrawlType = 'catalog' | 'specs';

export interface CrawlLog {
  id: number;
  crawl_id: string;
  crawl_type: CrawlType;
  status: 'running' | 'completed' | 'failed';
  processed_count: number;
  total_count: number;
  error_count: number;
  message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface CrawlStatus {
  crawlId: string;
  status: 'running' | 'completed' | 'failed';
  progress: {
    processed: number;
    total: number;
  };
  errors: number;
  startedAt: string;
  completedAt: string | null;
}

export interface SpecsCrawlStatus extends CrawlStatus {
  message: string | null;
}

export interface VehiclesResponse {
  total: number;
  data: Version[];
  limit: number;
  offset: number;
}

export interface ScraperFormResponse {
  id: number;
  name: string;
}
