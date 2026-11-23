import type { PoolClient } from 'pg';
import { getClient } from '../db/connection.js';
import { VehiclesScraper, type CatalogCrawlStatus } from '../scrapers/vehiclesScraper.js';
import { logger } from '../utils/logger.js';
import { mergeCatalog, type MergeResult } from './mergeCatalog.js';

/** Clave fija de pg advisory lock: evita crawls/merges simultáneos entre réplicas. */
const ADVISORY_LOCK_KEY = 74_382_015;

export type CatalogJobKind = 'crawl' | 'sync' | 'merge';

export interface ActiveCatalogJob {
  kind: CatalogJobKind;
  crawlId: string | null;
  startedAt: Date;
}

export interface CatalogSyncResult {
  crawlId: string;
  crawlStatus: CatalogCrawlStatus;
  merge: MergeResult | { status: 'skipped'; reason: string } | null;
}

export class CatalogJobBusyError extends Error {
  constructor(message: string, readonly active: ActiveCatalogJob | null) {
    super(message);
    this.name = 'CatalogJobBusyError';
  }
}

const scraper = new VehiclesScraper();
let activeJob: ActiveCatalogJob | null = null;

export const getActiveCatalogJob = (): ActiveCatalogJob | null => activeJob;

async function acquire(kind: CatalogJobKind): Promise<PoolClient> {
  if (activeJob) {
    throw new CatalogJobBusyError('Ya hay un job de catálogo en curso', activeJob);
  }
  activeJob = { kind, crawlId: null, startedAt: new Date() };

  let client: PoolClient | null = null;
  try {
    client = await getClient();
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [ADVISORY_LOCK_KEY]
    );
    if (!rows[0]?.locked) {
      throw new CatalogJobBusyError('Otra instancia tiene el lock del catálogo', null);
    }
    return client;
  } catch (error) {
    client?.release();
    activeJob = null;
    throw error;
  }
}

async function release(client: PoolClient): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  } catch (error) {
    logger.warn('Failed to release catalog advisory lock', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    client.release();
    activeJob = null;
  }
}

/**
 * Arranca crawl de catálogo (`crawl`) o crawl + merge (`sync`).
 * Devuelve el crawlId de inmediato; `done` resuelve al terminar (nunca rechaza).
 */
export async function startCatalogJob(
  kind: 'crawl' | 'sync'
): Promise<{ crawlId: string; done: Promise<CatalogSyncResult> }> {
  const lockClient = await acquire(kind);

  try {
    const { crawlId, done: crawlDone } = await scraper.beginCrawl();
    if (activeJob) activeJob.crawlId = crawlId;

    const done = (async (): Promise<CatalogSyncResult> => {
      try {
        const crawlStatus = await crawlDone;

        if (kind === 'crawl') {
          return { crawlId, crawlStatus, merge: null };
        }

        if (crawlStatus !== 'completed') {
          const reason = `Crawl ${crawlId} terminó con estado ${crawlStatus}; merge omitido`;
          logger.warn(reason);
          return { crawlId, crawlStatus, merge: { status: 'skipped', reason } };
        }

        // crawl.* acumula todas las ejecuciones y el merge solo hace INSERT/UPDATE,
        // así que mergear tras un crawl con errores parciales no borra nada.
        const merge = await mergeCatalog();
        return { crawlId, crawlStatus, merge };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Catalog sync failed', { crawlId, error: message });
        return { crawlId, crawlStatus: 'failed', merge: null };
      } finally {
        await release(lockClient);
      }
    })();

    return { crawlId, done };
  } catch (error) {
    await release(lockClient);
    throw error;
  }
}

/** Solo merge (sin crawl), con el mismo lock. */
export async function runMergeOnly(): Promise<MergeResult> {
  const lockClient = await acquire('merge');
  try {
    return await mergeCatalog();
  } finally {
    await release(lockClient);
  }
}
