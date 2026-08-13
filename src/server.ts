import 'dotenv/config';
import express from 'express';
import crawlRoutes from './routes/crawlRoutes.js';
import { logger } from './utils/logger.js';
import { closePool } from './db/connection.js';
import { closePlaywrightContext } from './scrapers/playwrightClient.js';

const app = express();
const port = parseInt(process.env.PORT || '4001', 10);

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/api', crawlRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
  });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down gracefully...`);
  await closePlaywrightContext();
  await closePool();
  process.exit(0);
};

// Graceful shutdown
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

const server = app.listen(port, () => {
  logger.info(`Server running on http://localhost:${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
});

export default server;
