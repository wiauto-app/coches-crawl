import cron, { type ScheduledTask } from 'node-cron';
import { CatalogJobBusyError, startCatalogJob } from '../sync/catalogSync.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CRON = '0 3 * * 1'; // lunes 03:00
const DEFAULT_TZ = 'Europe/Madrid';

let task: ScheduledTask | null = null;

async function runScheduledSync(): Promise<void> {
  try {
    const { crawlId, done } = await startCatalogJob('sync');
    logger.info(`Scheduled catalog sync started: ${crawlId}`);

    const result = await done;
    logger.info('Scheduled catalog sync finished', {
      crawlId: result.crawlId,
      crawlStatus: result.crawlStatus,
      merge: result.merge?.status ?? null,
    });
  } catch (error) {
    if (error instanceof CatalogJobBusyError) {
      logger.warn(`Scheduled catalog sync skipped: ${error.message}`);
      return;
    }
    logger.error('Scheduled catalog sync failed to start', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export function startWeeklyCatalogSync(): void {
  if ((process.env.CATALOG_CRON_ENABLED ?? 'true').toLowerCase() === 'false') {
    logger.info('Weekly catalog sync disabled (CATALOG_CRON_ENABLED=false)');
    return;
  }

  const expression = process.env.CATALOG_CRON || DEFAULT_CRON;
  const timezone = process.env.CATALOG_CRON_TZ || process.env.TZ || DEFAULT_TZ;

  if (!cron.validate(expression)) {
    throw new Error(`CATALOG_CRON inválido: "${expression}"`);
  }

  task = cron.schedule(expression, runScheduledSync, {
    name: 'weekly-catalog-sync',
    timezone,
    noOverlap: true,
  });

  logger.info('Weekly catalog sync scheduled', {
    expression,
    timezone,
    nextRun: task.getNextRun()?.toISOString() ?? null,
  });
}

export async function stopWeeklyCatalogSync(): Promise<void> {
  if (task) {
    await task.stop();
    task = null;
  }
}
