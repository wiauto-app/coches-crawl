import { v4 as uuidv4 } from 'uuid';
import { RetryClient } from './retryClient.js';
import { query, queryOne } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type {
  Make,
  Model,
  BodyType,
  FuelType,
  Year,
  Version,
  ScraperFormResponse,
} from '../types/index.js';

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

export class VehiclesScraper {
  private client: RetryClient;
  private sectionId: number;
  private delayMin: number;
  private delayMax: number;

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
  }

  private async delay(): Promise<void> {
    const ms = Math.random() * (this.delayMax - this.delayMin) + this.delayMin;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchFormDatalist(
    path: string
  ): Promise<Array<{ value: string; text: string }>> {
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

  private async getOrCreateMake(
    section1Id: number,
    name: string
  ): Promise<number> {
    try {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM makes WHERE section_1_id = $1',
        [section1Id]
      );

      if (existing) {
        return existing.id;
      }

      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO makes (section_1_id, name) VALUES ($1, $2) RETURNING id',
        [section1Id, name]
      );

      if (!inserted) {
        throw new Error('Failed to insert make');
      }

      return inserted.id;
    } catch (error) {
      logger.error('Error in getOrCreateMake', {
        section1Id,
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async getOrCreateModel(
    makeId: number,
    modelId: number,
    name: string
  ): Promise<number> {
    try {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM models WHERE make_id = $1 AND model_id = $2',
        [makeId, modelId]
      );

      if (existing) {
        return existing.id;
      }

      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO models (make_id, model_id, name) VALUES ($1, $2, $3) RETURNING id',
        [makeId, modelId, name]
      );

      if (!inserted) {
        throw new Error('Failed to insert model');
      }

      return inserted.id;
    } catch (error) {
      logger.error('Error in getOrCreateModel', {
        makeId,
        modelId,
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async getOrCreateBodyType(
    bodyTypeId: number,
    doors: number | null,
    name: string
  ): Promise<number> {
    try {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM body_types WHERE body_type_id = $1 AND doors = $2',
        [bodyTypeId, doors]
      );

      if (existing) {
        return existing.id;
      }

      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO body_types (body_type_id, doors, name) VALUES ($1, $2, $3) RETURNING id',
        [bodyTypeId, doors, name]
      );

      if (!inserted) {
        throw new Error('Failed to insert body type');
      }

      return inserted.id;
    } catch (error) {
      logger.error('Error in getOrCreateBodyType', {
        bodyTypeId,
        doors,
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async getOrCreateFuelType(
    fuelId: number,
    name: string
  ): Promise<number> {
    try {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM fuel_types WHERE fuel_id = $1',
        [fuelId]
      );

      if (existing) {
        return existing.id;
      }

      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO fuel_types (fuel_id, name) VALUES ($1, $2) RETURNING id',
        [fuelId, name]
      );

      if (!inserted) {
        throw new Error('Failed to insert fuel type');
      }

      return inserted.id;
    } catch (error) {
      logger.error('Error in getOrCreateFuelType', {
        fuelId,
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async getOrCreateYear(year: number): Promise<number> {
    try {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM years WHERE year = $1',
        [year]
      );

      if (existing) {
        return existing.id;
      }

      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO years (year) VALUES ($1) RETURNING id',
        [year]
      );

      if (!inserted) {
        throw new Error('Failed to insert year');
      }

      return inserted.id;
    } catch (error) {
      logger.error('Error in getOrCreateYear', {
        year,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async insertVersion(
    versionId: number,
    makeId: number,
    modelId: number,
    bodyTypeId: number,
    fuelTypeId: number,
    yearId: number,
    name: string
  ): Promise<void> {
    try {
      await query(
        `
        INSERT INTO versions
        (version_id, make_id, model_id, body_type_id, fuel_type_id, year_id, name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (version_id) DO NOTHING
        `,
        [versionId, makeId, modelId, bodyTypeId, fuelTypeId, yearId, name]
      );
    } catch (error) {
      logger.error('Error in insertVersion', {
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

  private async runCrawl(crawlId: string): Promise<CatalogCrawlStatus> {
    const context: CrawlContext = {
      crawlId,
      processed: 0,
      total: 0,
      errors: 0,
      startedAt: new Date(),
    };

    try {
      logger.info(`Running crawl: ${crawlId}`);

      // Step 1: Get all makes
      logger.info('Fetching makes...');
      const makes = this.mapFormRows(
        await this.fetchFormDatalist(
          `/vehicle-specs/v1/makes/form?section1Id=${this.sectionId}`
        )
      );
      context.total = makes.length;
      logger.info(`Found ${makes.length} makes`);

      for (const make of makes) {
        try {
          await this.delay();
          const makeId = await this.getOrCreateMake(make.id, make.name);

          // Step 2: Get models for this make
          logger.debug(`Fetching models for make: ${make.name}`);
          const models = this.mapFormRows(
            await this.fetchFormDatalist(
              `/vehicle-specs/v1/models/form?section1Id=${this.sectionId}&makeId=${make.id}`
            )
          );

          for (const model of models) {
            try {
              await this.delay();
              const modelId = await this.getOrCreateModel(
                makeId,
                model.id,
                model.name
              );

              // Step 3: Get body types for this model
              logger.debug(
                `Fetching body types for model: ${model.name}`
              );
              const bodyTypes = this.mapBodyTypeRows(
                await this.fetchFormDatalist(
                  `/vehicle-specs/v1/body-types/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}`
                )
              );

              for (const bodyTypeData of bodyTypes) {
                try {
                  await this.delay();

                  const bodyTypeId = bodyTypeData.id;
                  const doors = bodyTypeData.doors;

                  const bodyTypeDbId = await this.getOrCreateBodyType(
                    bodyTypeId,
                    doors,
                    bodyTypeData.name
                  );

                  // Step 4: Get fuel types
                  logger.debug(
                    `Fetching fuel types for body type: ${bodyTypeData.name}`
                  );
                  const fuelTypes = this.mapFormRows(
                    await this.fetchFormDatalist(
                      `/vehicle-specs/v1/fuel-types/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}&bodyTypeId=${bodyTypeId}&doors=${doors || 0}`
                    )
                  );

                  for (const fuelType of fuelTypes) {
                    try {
                      await this.delay();
                      const fuelTypeId = await this.getOrCreateFuelType(
                        fuelType.id,
                        fuelType.name
                      );

                      // Step 5: Get years
                      logger.debug(`Fetching years for fuel type: ${fuelType.name}`);
                      const years = this.mapFormRows(
                        await this.fetchFormDatalist(
                          `/vehicle-specs/v1/years/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}&fuelId=${fuelType.id}&bodyTypeId=${bodyTypeId}&doors=${doors || 0}`
                        )
                      );

                      for (const yearData of years) {
                        try {
                          await this.delay();
                          const yearDbId = await this.getOrCreateYear(
                            yearData.id
                          );

                          // Step 6: Get versions
                          logger.debug(`Fetching versions for year: ${yearData.id}`);
                          const versions = this.mapFormRows(
                            await this.fetchFormDatalist(
                              `/vehicle-specs/v1/versions/form?section1Id=${this.sectionId}&makeId=${make.id}&modelId=${model.id}&fuelId=${fuelType.id}&year=${yearData.id}&bodyTypeId=${bodyTypeId}&doors=${doors || 0}`
                            )
                          );

                          for (const version of versions) {
                            try {
                              await this.insertVersion(
                                version.id,
                                makeId,
                                modelId,
                                bodyTypeDbId,
                                fuelTypeId,
                                yearDbId,
                                version.name
                              );
                            } catch (error) {
                              context.errors++;
                              logger.error(
                                `Error inserting version: ${version.name}`,
                                {
                                  error: error instanceof Error ? error.message : 'Unknown error',
                                }
                              );
                            }
                          }
                        } catch (error) {
                          context.errors++;
                          logger.error(
                            `Error processing year: ${yearData.id}`,
                            {
                              error: error instanceof Error ? error.message : 'Unknown error',
                            }
                          );
                        }
                      }
                    } catch (error) {
                      context.errors++;
                      logger.error(
                        `Error processing fuel type: ${fuelType.name}`,
                        {
                          error: error instanceof Error ? error.message : 'Unknown error',
                        }
                      );
                    }
                  }
                } catch (error) {
                  context.errors++;
                  logger.error(
                    `Error processing body type: ${bodyTypeData.name}`,
                    {
                      error: error instanceof Error ? error.message : 'Unknown error',
                    }
                  );
                }
              }
            } catch (error) {
              context.errors++;
              logger.error(`Error processing model: ${model.name}`, {
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }

          context.processed++;
          await this.updateCrawlLog(crawlId, context);
        } catch (error) {
          context.errors++;
          logger.error(`Error processing make: ${make.name}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

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
    }
  }
}
