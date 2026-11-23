import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { QueryResult } from 'pg';
import { getClient, query } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const SQL_FILENAME = 'merge-catalog.sql';

export interface MergeSummary {
  rowsLogged: Record<string, number>;
  totals: Record<string, number>;
}

export type MergeResult =
  | { status: 'completed'; mergeId: string; durationMs: number; summary: MergeSummary }
  | { status: 'failed'; mergeId: string; durationMs: number; error: string };

let cachedSql: string | null = null;

/**
 * Dev (tsx): src/sync/merge-catalog.sql junto a este módulo.
 * Prod (tsup bundle): dist/merge-catalog.sql junto a dist/server.js.
 */
function loadMergeSql(): string {
  if (cachedSql) {
    return cachedSql;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MERGE_SQL_PATH,
    join(moduleDir, SQL_FILENAME),
    join(moduleDir, 'sync', SQL_FILENAME),
  ].filter((p): p is string => Boolean(p));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`No se encontró ${SQL_FILENAME}. Buscado en: ${candidates.join(', ')}`);
  }

  cachedSql = readFileSync(found, 'utf8');
  return cachedSql;
}

const toNumber = (value: unknown): number =>
  typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10) || 0;

function parseSummary(results: QueryResult | QueryResult[]): MergeSummary {
  const list = Array.isArray(results) ? results : [results];
  const summary: MergeSummary = { rowsLogged: {}, totals: {} };

  for (const result of list) {
    const first = result.rows?.[0] as Record<string, unknown> | undefined;
    if (!first) continue;

    if ('entity' in first && 'rows_logged' in first) {
      for (const row of result.rows as Array<{ entity: string; rows_logged: unknown }>) {
        summary.rowsLogged[row.entity] = toNumber(row.rows_logged);
      }
    } else if ('src_versions' in first) {
      for (const [key, value] of Object.entries(first)) {
        summary.totals[key] = toNumber(value);
      }
    }
  }

  return summary;
}

/**
 * Ejecuta merge-catalog.sql (transaccional) del schema `crawl` hacia el catálogo público.
 * Nunca lanza: devuelve status failed y deja registro en crawl_logs (crawl_type = 'merge').
 */
export async function mergeCatalog(): Promise<MergeResult> {
  const mergeId = uuidv4();
  const startedAt = Date.now();

  await query(
    `INSERT INTO crawl_logs (crawl_id, crawl_type, status, message)
     VALUES ($1, 'merge', 'running', 'Merge started')`,
    [mergeId]
  );

  const client = await getClient();
  try {
    const sql = loadMergeSql();
    logger.info(`Catalog merge started: ${mergeId}`);

    const results = (await client.query(sql)) as unknown as QueryResult | QueryResult[];
    const summary = parseSummary(results);
    const durationMs = Date.now() - startedAt;

    await query(
      `UPDATE crawl_logs
       SET status = 'completed',
           processed_count = $2,
           total_count = $3,
           message = $4,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE crawl_id = $1`,
      [
        mergeId,
        summary.totals.dest_versions_mapped ?? 0,
        summary.totals.src_versions ?? 0,
        JSON.stringify(summary),
      ]
    );

    logger.info(`Catalog merge completed: ${mergeId}`, { durationMs, ...summary });
    return { status: 'completed', mergeId, durationMs, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const durationMs = Date.now() - startedAt;

    // Multi-statement con BEGIN explícito: tras un error la transacción queda abortada.
    try {
      await client.query('ROLLBACK');
    } catch {
      // sin transacción abierta
    }

    logger.error(`Catalog merge failed: ${mergeId}`, { error: message, durationMs });

    await query(
      `UPDATE crawl_logs
       SET status = 'failed', message = $2, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE crawl_id = $1`,
      [mergeId, message]
    ).catch(() => undefined);

    return { status: 'failed', mergeId, durationMs, error: message };
  } finally {
    client.release();
  }
}
