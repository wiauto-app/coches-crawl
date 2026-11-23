import { Router, Request, Response } from 'express';
import {
  startSpecsCrawl,
  type StartSpecsCrawlOptions,
} from '../scrapers/technicalSheetScraper.js';
import { query, queryOne } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import {
  CatalogJobBusyError,
  getActiveCatalogJob,
  runMergeOnly,
  startCatalogJob,
} from '../sync/catalogSync.js';
import type {
  CrawlStatus,
  CrawlLog,
  SpecsCrawlStatus,
  VehiclesResponse,
  Version,
} from '../types/index.js';
import type { VersionSpecificationRow } from '../types/technicalSheet.js';

const router = Router();
let currentSpecsCrawlId: string | null = null;

const mapCrawlLogToSpecsStatus = (log: CrawlLog): SpecsCrawlStatus => ({
  crawlId: log.crawl_id,
  status: log.status,
  progress: {
    processed: log.processed_count,
    total: log.total_count,
  },
  errors: log.error_count,
  message: log.message,
  startedAt: log.started_at,
  completedAt: log.completed_at,
});

const parseOptionalNonNegativeInt = (
  value: unknown,
  fieldName: string
): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} debe ser un entero mayor o igual a 0`);
  }

  return value;
};

const parseStartSpecsCrawlOptions = (
  body: unknown
): StartSpecsCrawlOptions => {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('El body debe ser un objeto');
  }

  const { limit, offset } = body as Record<string, unknown>;

  return {
    limit: parseOptionalNonNegativeInt(limit, 'limit'),
    offset: parseOptionalNonNegativeInt(offset, 'offset'),
  };
};

const respondBusy = (res: Response, error: CatalogJobBusyError): void => {
  res.status(409).json({
    error: error.message,
    active: error.active,
  });
};

const startCatalogJobHandler =
  (kind: 'crawl' | 'sync') =>
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { crawlId, done } = await startCatalogJob(kind);

      void done.then((result) => {
        logger.info(`Catalog ${kind} finished`, {
          crawlId: result.crawlId,
          crawlStatus: result.crawlStatus,
          merge: result.merge?.status ?? null,
        });
      });

      res.status(202).json({
        crawlId,
        kind,
        status: 'started',
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof CatalogJobBusyError) {
        respondBusy(res, error);
        return;
      }
      logger.error(`POST catalog ${kind} failed`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({
        error: `Failed to start catalog ${kind}`,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

// POST /api/crawl - Crawl de catálogo (solo schema crawl, sin merge)
router.post('/crawl', startCatalogJobHandler('crawl'));

// POST /api/sync/catalog - Crawl de catálogo + merge al catálogo de wiauto
router.post('/sync/catalog', startCatalogJobHandler('sync'));

// POST /api/sync/merge - Solo merge (síncrono) de crawl.* al catálogo de wiauto
router.post('/sync/merge', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await runMergeOnly();
    res.status(result.status === 'completed' ? 200 : 500).json(result);
  } catch (error) {
    if (error instanceof CatalogJobBusyError) {
      respondBusy(res, error);
      return;
    }
    res.status(500).json({
      error: 'Failed to run merge',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/sync/status - Job activo + último crawl de catálogo y último merge
router.get('/sync/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [lastCrawl, lastMerge] = await Promise.all([
      queryOne<CrawlLog>(
        `SELECT * FROM crawl_logs WHERE crawl_type = 'catalog' ORDER BY id DESC LIMIT 1`
      ),
      queryOne<CrawlLog>(
        `SELECT * FROM crawl_logs WHERE crawl_type = 'merge' ORDER BY id DESC LIMIT 1`
      ),
    ]);

    res.json({ active: getActiveCatalogJob(), lastCrawl, lastMerge });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get sync status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/crawl/status - Get crawl status
router.get('/crawl/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const crawlId = req.query.crawlId as string;

    if (!crawlId) {
      const log = await queryOne<CrawlLog>(
        `SELECT * FROM crawl_logs WHERE crawl_type = 'catalog' ORDER BY id DESC LIMIT 1`,
      );
      if (!log) {
        res.status(404).json({ error: 'Crawl not found' });
        return;
      }
      const status: CrawlStatus = {
        crawlId: log.crawl_id,
        status: log.status as 'running' | 'completed' | 'failed',
        progress: {
          processed: log.processed_count,
          total: log.total_count,
        },
        errors: log.error_count,
        startedAt: log.started_at,
        completedAt: log.completed_at,
      };
      res.json(status);
      return;
    }

    const log = await queryOne<CrawlLog>(
      'SELECT * FROM crawl_logs WHERE crawl_id = $1',
      [crawlId]
    );

    if (!log) {
      res.status(404).json({ error: 'Crawl not found' });
      return;
    }

    const status: CrawlStatus = {
      crawlId: log.crawl_id,
      status: log.status as 'running' | 'completed' | 'failed',
      progress: {
        processed: log.processed_count,
        total: log.total_count,
      },
      errors: log.error_count,
      startedAt: log.started_at,
      completedAt: log.completed_at,
    };

    res.json(status);
  } catch (error) {
    logger.error('GET /crawl/status failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to get crawl status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/crawl/specs - Start a new specs crawl
router.post('/crawl/specs', async (req: Request, res: Response): Promise<void> => {
  try {
    let options: StartSpecsCrawlOptions;

    try {
      options = parseStartSpecsCrawlOptions(req.body);
    } catch (error) {
      res.status(400).json({
        error: 'Invalid request body',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    if (currentSpecsCrawlId) {
      const log = await queryOne<CrawlLog>(
        `SELECT * FROM crawl_logs
         WHERE crawl_id = $1 AND crawl_type = 'specs'`,
        [currentSpecsCrawlId]
      );

      if (log && log.status === 'running') {
        res.status(409).json({
          error: 'Specs crawl already in progress',
          crawlId: currentSpecsCrawlId,
        });
        return;
      }
    }

    currentSpecsCrawlId = await startSpecsCrawl(options);

    res.status(202).json({
      crawlId: currentSpecsCrawlId,
      status: 'started',
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('POST /crawl/specs failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to start specs crawl',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/crawl/specs/status - Get specs crawl status
router.get('/crawl/specs/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const crawlId = req.query.crawlId as string | undefined;

    if (!crawlId) {
      const log = await queryOne<CrawlLog>(
        `SELECT * FROM crawl_logs
         WHERE crawl_type = 'specs'
         ORDER BY id DESC
         LIMIT 1`
      );

      if (!log) {
        res.status(404).json({ error: 'Specs crawl not found' });
        return;
      }

      res.json(mapCrawlLogToSpecsStatus(log));
      return;
    }

    const log = await queryOne<CrawlLog>(
      `SELECT * FROM crawl_logs
       WHERE crawl_id = $1 AND crawl_type = 'specs'`,
      [crawlId]
    );

    if (!log) {
      res.status(404).json({ error: 'Specs crawl not found' });
      return;
    }

    res.json(mapCrawlLogToSpecsStatus(log));
  } catch (error) {
    logger.error('GET /crawl/specs/status failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to get specs crawl status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/versions/:versionId/specs - Get stored technical sheet
router.get('/versions/:versionId/specs', async (req: Request, res: Response): Promise<void> => {
  try {
    const versionId = parseInt(req.params.versionId, 10);

    if (!Number.isInteger(versionId) || versionId <= 0) {
      res.status(400).json({
        error: 'Invalid versionId',
        message: 'versionId debe ser un entero positivo',
      });
      return;
    }

    const specs = await queryOne<VersionSpecificationRow>(
      `SELECT * FROM version_specifications
       WHERE version_id = $1`,
      [versionId]
    );

    if (!specs) {
      res.status(404).json({
        error: 'Specifications not found',
        versionId,
      });
      return;
    }

    res.json(specs);
  } catch (error) {
    logger.error('GET /versions/:versionId/specs failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to get version specifications',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/vehicles - Get vehicles with pagination
router.get('/vehicles', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit as string) || 50,
      1000
    );
    const offset = parseInt(req.query.offset as string) || 0;

    // Get total count
    const countResult = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM versions'
    );

    const total = parseInt(countResult?.count || '0', 10);

    // Get paginated results
    const vehicles = await query<Version>(
      'SELECT * FROM versions ORDER BY id ASC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    const response: VehiclesResponse = {
      total,
      data: vehicles,
      limit,
      offset,
    };

    res.json(response);
  } catch (error) {
    logger.error('GET /vehicles failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to get vehicles',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
