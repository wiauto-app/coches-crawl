import { v4 as uuidv4 } from 'uuid';
import { RetryClient } from './retryClient.js';
import { query, queryOne } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { ScraperFormResponse } from '../types/index.js';
import { PromiseCache, RateLimiter, runPool } from '../utils/concurrency.js';

export type CatalogCrawlStatus = 'completed' | 'failed';

interface CrawlContext {
  crawlId: string;
  processed: number;
  total: number;
  errors: number;
  startedAt: Date;
}

/** Envelope JSON del gateway: { datalist: [{ value, text }] } en rutas .../form */
interface ApiFormEnvelope {
  datalist?: Array<{ value: string; text: string }>;
}

interface BodyTypeFormRow {
  id: number;
  doors: number | null;
  name: string;
}

/** Contexto común de una lista de versiones (crawl.versions + version_years). */
interface VersionListContext {
  makeId: number;
  modelId: number;
  bodyTypeId: number;
  fuelTypeId: number;
  yearId: number;
}

/** Unidad de trabajo del pool: un modelo de una marca. */
interface ModelTask {
  make: ScraperFormResponse;
  makeDbId: number;
  model: ScraperFormResponse;
}

export class VehiclesScraper {
  private client: RetryClient;
  private sectionId: number;
  private delayMin: number;
  private delayMax: number;
  /** Modelos procesados en paralelo. */
  private concurrency: number;
  /** Tope global de requests por segundo a coches.net (todos los workers). */
  private rateLimiter: RateLimiter;

  // Ids de crawl.* ya resueltos. Compartidos entre workers: la misma clave
  // pedida a la vez reutiliza la misma promesa (sin carreras de insert).
  private makeIds = new PromiseCache<number>();
  private modelIds = new PromiseCache<number>();
  private bodyTypeIds = new PromiseCache<number>();
  private fuelTypeIds = new PromiseCache<number>();
  private yearIds = new PromiseCache<number>();

  constructor() {
    const apiBaseUrl =
      process.env.API_BASE_URL || 'https://web.gw.coches.net';
    this.client = new RetryClient(apiBaseUrl);
    this.sectionId = parseInt(process.env.SCRAPER_SECTION_ID || '2500', 10);
    this.delayMin = parseInt(
      process.env.SCRAPER_DELAY_MIN_MS || '100',
      10
    );
    this.delayMax = parseInt(
      process.env.SCRAPER_DELAY_MAX_MS || '250',
      10
    );
    this.concurrency = Math.max(
      1,
      parseInt(process.env.SCRAPER_CONCURRENCY || '4', 10) || 1
    );
    this.rateLimiter = RateLimiter.perSecond(
      parseFloat(process.env.SCRAPER_MAX_RPS || '8') || 0
    );
  }

  private async delay(): Promise<void> {
    const ms = Math.random() * (this.delayMax - this.delayMin) + this.delayMin;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchFormDatalist(
    path: string
  ): Promise<Array<{ value: string; text: string }>> {
    await this.delay();
    await this.rateLimiter.acquire();
    const res = await this.client.get<ApiFormEnvelope>(path);
    return Array.isArray(res?.datalist) ? res.datalist : [];
  }

  private mapFormRows(
    items: Array<{ value: string; text: string }>
  ): ScraperFormResponse[] {
    return items.map((item) => ({
      id: parseInt(item.value, 10),
      name: item.text,
    }));
  }

  private mapBodyTypeRows(
    items: Array<{ value: string; text: string }>
  ): BodyTypeFormRow[] {
    return items.map((item) => {
      const parts = item.value.split('-');
      const bodyTypeId = parseInt(parts[0] || '0', 10);
      const doors =
        parts[1] !== undefined && parts[1] !== ''
          ? parseInt(parts[1], 10)
          : null;
      return { id: bodyTypeId, doors, name: item.text };
    });
  }

  private async updateCrawlLog(
    crawlId: string,
    updates: Partial<CrawlContext>
  ): Promise<void> {
    try {
      await query(
        `
        UPDATE crawl_logs
        SET
          processed_count = COALESCE($2, processed_count),
          total_count = COALESCE($3, total_count),
          error_count = COALESCE($4, error_count),
          message = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE crawl_id = $1
        `,
        [
          crawlId,
          updates.processed,
          updates.total,
          updates.errors,
          null,
        ]
      );
    } catch (error) {
      logger.error('Failed to update crawl log', {
        crawlId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * SELECT y, si no existe, INSERT ... ON CONFLICT DO NOTHING. Si otro
   * proceso insertó entre medio, el INSERT no devuelve fila y se relee.
   */
  private async selectOrInsertId(
    label: string,
    selectSql: string,
    selectParams: unknown[],
    insertSql: string,
    insertParams: unknown[]
  ): Promise<number> {
    try {
      const existing = await queryOne<{ id: number }>(selectSql, selectParams);
      if (existing) {
        return existing.id;
      }

      const inserted = await queryOne<{ id: number }>(insertSql, insertParams);
      if (inserted) {
        return inserted.id;
      }

      const raced = await queryOne<{ id: number }>(selectSql, selectParams);
      if (!raced) {
        throw new Error(`Failed to insert ${label}`);
      }
      return raced.id;
    } catch (error) {
      logger.error(`Error in getOrCreate ${label}`, {
        params: selectParams,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private getOrCreateMake(section1Id: number, name: string): Promise<number> {
    return this.makeIds.get(String(section1Id), () =>
      this.selectOrInsertId(
        'make',
        'SELECT id FROM makes WHERE section_1_id = $1',
        [section1Id],
        `INSERT INTO makes (section_1_id, name) VALUES ($1, $2)
         ON CONFLICT (section_1_id) DO NOTHING RETURNING id`,
        [section1Id, name]
      )
    );
  }

  private getOrCreateModel(
    makeId: number,
    modelId: number,
    name: string
  ): Promise<number> {
    return this.modelIds.get(`${makeId}:${modelId}`, () =>
      this.selectOrInsertId(
        'model',
        'SELECT id FROM models WHERE make_id = $1 AND model_id = $2',
        [makeId, modelId],
        `INSERT INTO models (make_id, model_id, name) VALUES ($1, $2, $3)
         ON CONFLICT (make_id, model_id) DO NOTHING RETURNING id`,
        [makeId, modelId, name]
      )
    );
  }

  private getOrCreateBodyType(
    bodyTypeId: number,
    doors: number | null,
    name: string
  ): Promise<number> {
    // doors puede ser NULL: IS NOT DISTINCT FROM para que NULL encuentre NULL.
    return this.bodyTypeIds.get(`${bodyTypeId}:${doors ?? 'null'}`, () =>
      this.selectOrInsertId(
        'body type',
        'SELECT id FROM body_types WHERE body_type_id = $1 AND doors IS NOT DISTINCT FROM $2',
        [bodyTypeId, doors],
        `INSERT INTO body_types (body_type_id, doors, name) VALUES ($1, $2, $3)
         ON CONFLICT (body_type_id, doors) DO NOTHING RETURNING id`,
        [bodyTypeId, doors, name]
      )
    );
  }

  private getOrCreateFuelType(fuelId: number, name: string): Promise<number> {
    return this.fuelTypeIds.get(String(fuelId), () =>
      this.selectOrInsertId(
        'fuel type',
        'SELECT id FROM fuel_types WHERE fuel_id = $1',
        [fuelId],
        `INSERT INTO fuel_types (fuel_id, name) VALUES ($1, $2)
         ON CONFLICT (fuel_id) DO NOTHING RETURNING id`,
        [fuelId, name]
      )
    );
  }

  private getOrCreateYear(year: number): Promise<number> {
    return this.yearIds.get(String(year), () =>
      this.selectOrInsertId(
        'year',
        'SELECT id FROM years WHERE year = $1',
        [year],
        `INSERT INTO years (year) VALUES ($1)
         ON CONFLICT (year) DO NOTHING RETURNING id`,
        [year]
      )
    );
  }

  /**
   * Inserta en lote las versiones de una lista (una vez por version_id
   * externo) y sus pares versión–año. Una versión de coches.net aparece en
   * varios años, así que cada lista de año suma sus pares en
   * crawl.version_years.
   */
  private async insertVersions(
    versions: ScraperFormResponse[],
    ctx: VersionListContext
  ): Promise<void> {
    if (versions.length === 0) {
      return;
    }

    const versionIds = versions.map((v) => v.id);
    const names = versions.map((v) => v.name);

    try {
      await query(
        `
        INSERT INTO versions
        (version_id, make_id, model_id, body_type_id, fuel_type_id, name)
        SELECT v.version_id, $3, $4, $5, $6, v.name
        FROM unnest($1::int[], $2::text[]) AS v(version_id, name)
        ON CONFLICT (version_id) DO NOTHING
        `,
        [versionIds, names, ctx.makeId, ctx.modelId, ctx.bodyTypeId, ctx.fuelTypeId]
      );

      await query(
        `
        INSERT INTO version_years (version_id, year_id)
        SELECT DISTINCT v.version_id, $2::int
        FROM unnest($1::int[]) AS v(version_id)
        ON CONFLICT DO NOTHING
        `,
        [versionIds, ctx.yearId]
      );
    } catch (error) {
      logger.error('Error in insertVersions', {
        ...ctx,
        count: versions.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Crea el crawl log y arranca el crawl en background.
   * `done` resuelve con el estado final (nunca rechaza).
   */
  async beginCrawl(): Promise<{
    crawlId: string;
    done: Promise<CatalogCrawlStatus>;
  }> {
    const crawlId = uuidv4();

    try {
      await query(
        `
        INSERT INTO crawl_logs (crawl_id, crawl_type, status, processed_count, total_count, error_count, message)
        VALUES ($1, 'catalog', $2, $3, $4, $5, $6)
        `,
        [crawlId, 'running', 0, 0, 0, 'Crawl started']
      );

      logger.info(`Crawl started with ID: ${crawlId}`);
    } catch (error) {
      logger.error('Failed to create crawl log', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }

    const done = this.runCrawl(crawlId).catch((error): CatalogCrawlStatus => {
      logger.error('Crawl failed', {
        crawlId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 'failed';
    });

    return { crawlId, done };
  }

  private clearCaches(): void {
    this.makeIds.clear();
    this.modelIds.clear();
    this.bodyTypeIds.clear();
    this.fuelTypeIds.clear();
    this.yearIds.clear();
  }

  /** Recorre carrocería → combustible → año → versiones de un modelo. */
  private async crawlModel(task: ModelTask, context: CrawlContext): Promise<void> {
    const { make, makeDbId, model } = task;
    const modelId = await this.getOrCreateModel(makeDbId, model.id, model.name);

    logger.debug(`Fetching body types for model: ${make.name} ${model.name}`);
    const bodyTypes = this.mapBodyTypeRows(
      await this.fetchFormDatalist(
        `/vehicle-specs/v1/body-types/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}`
      )
    );

    for (const bodyTypeData of bodyTypes) {
      try {
        const bodyTypeId = bodyTypeData.id;
        const doors = bodyTypeData.doors;
        const bodyTypeDbId = await this.getOrCreateBodyType(
          bodyTypeId,
          doors,
          bodyTypeData.name
        );

        const fuelTypes = this.mapFormRows(
          await this.fetchFormDatalist(
            `/vehicle-specs/v1/fuel-types/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}&bodyTypeId=${bodyTypeId}&doors=${doors || 0}`
          )
        );

        for (const fuelType of fuelTypes) {
          try {
            const fuelTypeId = await this.getOrCreateFuelType(
              fuelType.id,
              fuelType.name
            );

            const years = this.mapFormRows(
              await this.fetchFormDatalist(
                `/vehicle-specs/v1/years/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}&fuelId=${fuelType.id}&bodyTypeId=${bodyTypeId}&doors=${doors || 0}`
              )
            );

            for (const yearData of years) {
              try {
                const yearDbId = await this.getOrCreateYear(yearData.id);

                const versions = this.mapFormRows(
                  await this.fetchFormDatalist(
                    `/vehicle-specs/v1/versions/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}&fuelId=${fuelType.id}&year=${yearData.id}&bodyTypeId=${bodyTypeId}&doors=${doors || 0}`
                  )
                );

                await this.insertVersions(versions, {
                  makeId: makeDbId,
                  modelId,
                  bodyTypeId: bodyTypeDbId,
                  fuelTypeId,
                  yearId: yearDbId,
                });
              } catch (error) {
                context.errors++;
                logger.error(
                  `Error processing year: ${make.name} ${model.name} ${yearData.id}`,
                  { error: error instanceof Error ? error.message : 'Unknown error' }
                );
              }
            }
          } catch (error) {
            context.errors++;
            logger.error(
              `Error processing fuel type: ${make.name} ${model.name} ${fuelType.name}`,
              { error: error instanceof Error ? error.message : 'Unknown error' }
            );
          }
        }
      } catch (error) {
        context.errors++;
        logger.error(
          `Error processing body type: ${make.name} ${model.name} ${bodyTypeData.name}`,
          { error: error instanceof Error ? error.message : 'Unknown error' }
        );
      }
    }
  }

  private async runCrawl(crawlId: string): Promise<CatalogCrawlStatus> {
    const context: CrawlContext = {
      crawlId,
      processed: 0,
      total: 0,
      errors: 0,
      startedAt: new Date(),
    };

    try {
      this.clearCaches();
      logger.info(`Running crawl: ${crawlId}`, {
        concurrency: this.concurrency,
      });

      // Paso 1: marcas
      logger.info('Fetching makes...');
      const makes = this.mapFormRows(
        await this.fetchFormDatalist(
          `/vehicle-specs/v1/makes/form?section1Id=${this.sectionId}`
        )
      );
      logger.info(`Found ${makes.length} makes`);

      // Paso 2: modelos de cada marca, en paralelo. Arma la cola de trabajo.
      const tasks: ModelTask[] = [];
      await runPool(makes, this.concurrency, async (make) => {
        try {
          const makeDbId = await this.getOrCreateMake(make.id, make.name);
          const models = this.mapFormRows(
            await this.fetchFormDatalist(
              `/vehicle-specs/v1/models/form?section1Id=${this.sectionId}&makeId=${make.id}`
            )
          );
          for (const model of models) {
            tasks.push({ make, makeDbId, model });
          }
        } catch (error) {
          context.errors++;
          logger.error(`Error processing make: ${make.name}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

      // El progreso cuenta modelos (unidad de trabajo del pool).
      context.total = tasks.length;
      await this.updateCrawlLog(crawlId, context);
      logger.info(`Found ${tasks.length} models`);

      // Paso 3: cada modelo (carrocería → combustible → año → versiones).
      await runPool(tasks, this.concurrency, async (task) => {
        try {
          await this.crawlModel(task, context);
        } catch (error) {
          context.errors++;
          logger.error(
            `Error processing model: ${task.make.name} ${task.model.name}`,
            { error: error instanceof Error ? error.message : 'Unknown error' }
          );
        }
        context.processed++;
        await this.updateCrawlLog(crawlId, context);
      });

      // Mark as completed
      await query(
        `
        UPDATE crawl_logs
        SET status = $1, completed_at = CURRENT_TIMESTAMP
        WHERE crawl_id = $2
        `,
        ['completed', crawlId]
      );

      logger.info(`Crawl completed: ${crawlId}`, {
        processed: context.processed,
        errors: context.errors,
        duration: Date.now() - context.startedAt.getTime(),
      });

      return 'completed';
    } catch (error) {
      logger.error(`Crawl failed: ${crawlId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      await query(
        `
        UPDATE crawl_logs
        SET status = $1, completed_at = CURRENT_TIMESTAMP, message = $2
        WHERE crawl_id = $3
        `,
        ['failed', error instanceof Error ? error.message : 'Unknown error', crawlId]
      );

      return 'failed';
    } finally {
      this.clearCaches();
    }
  }
}
