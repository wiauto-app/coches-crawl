import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger.js';

const DB_SCHEMA = process.env.DB_SCHEMA || 'crawl';

if (!/^[a-z_][a-z0-9_]*$/.test(DB_SCHEMA)) {
  throw new Error(`DB_SCHEMA inválido: ${DB_SCHEMA}`);
}

const poolMax = parseInt(process.env.DB_POOL_MAX || '5', 10);

// search_path: tablas del crawler en `crawl`, catálogo de wiauto en `public`.
const searchPathOption = `-c search_path=${DB_SCHEMA},public`;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      options: searchPathOption,
      max: poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5435', 10),
      database: process.env.DB_NAME || 'coches_db',
      user: process.env.DB_USER || 'coches_user',
      password: process.env.DB_PASSWORD || 'coches_password_dev',
      options: searchPathOption,
      max: poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

export async function getClient(): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    logger.error('Failed to get database client', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export async function query<T = unknown>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  try {
    const result = await pool.query(text, values);
    return result.rows as T[];
  } catch (error) {
    logger.error('Database query failed', {
      query: text.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export async function queryOne<T = unknown>(
  text: string,
  values?: unknown[]
): Promise<T | null> {
  try {
    const result = await pool.query(text, values);
    return (result.rows[0] as T) || null;
  } catch (error) {
    logger.error('Database query failed', {
      query: text.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export async function closePool(): Promise<void> {
  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (error) {
    logger.error('Error closing database pool', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export { pool };
