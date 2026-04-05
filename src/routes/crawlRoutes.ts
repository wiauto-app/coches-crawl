import { Router, Request, Response } from 'express';
import { VehiclesScraper } from '../scrapers/vehiclesScraper.js';
import { query, queryOne } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { CrawlStatus, CrawlLog, VehiclesResponse, Version } from '../types/index.js';

const router = Router();
let currentCrawlId: string | null = null;
const scraper = new VehiclesScraper();

// POST /api/crawl - Start a new crawl
router.post('/crawl', async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if crawl is already in progress
    if (currentCrawlId) {
      const log = await queryOne<CrawlLog>(
        'SELECT * FROM crawl_logs WHERE crawl_id = $1',
        [currentCrawlId]
      );

      if (log && log.status === 'running') {
        res.status(409).json({
          error: 'Crawl already in progress',
          crawlId: currentCrawlId,
        });
        return;
      }
    }

    currentCrawlId = await scraper.startCrawl();

    res.status(202).json({
      crawlId: currentCrawlId,
      status: 'started',
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('POST /crawl failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to start crawl',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/crawl/status - Get crawl status
router.get('/crawl/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const crawlId = req.query.crawlId as string;

    if (!crawlId) {
      res.status(400).json({ error: 'crawlId query parameter is required' });
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
