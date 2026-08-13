import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db/connection.js';
import { parseInitialProps } from './initialPropsParser.js';
import {
  BotProtectionError,
  BrowserLaunchError,
  fetchPageHtml,
  specsCrawlDelay,
} from './playwrightClient.js';
import { buildTechnicalSheetUrl } from '../utils/urlBuilder.js';
import { logger } from '../utils/logger.js';
import type {
  TechnicalSheetPageInfo,
  TechnicalSheetSpecifications,
  VersionSpecification,
} from '../types/technicalSheet.js';

export interface StartSpecsCrawlOptions {
  limit?: number;
  offset?: number;
}

interface SpecsCrawlContext {
  crawlId: string;
  processed: number;
  total: number;
  errors: number;
  startedAt: Date;
}

interface PendingVersionRow {
  versionId: number;
  name: string;
  technicalUrlPath: string | null;
  makeName: string;
  modelName: string;
  bodyTypeId: number;
  doors: number | null;
}

const DEFAULT_MAX_CONSECUTIVE_BOT_ERRORS = 5;

const CANONICAL_LINK_REGEX =
  /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i;
const CANONICAL_LINK_HREF_FIRST_REGEX =
  /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i;

const normalizePath = (path: string): string => {
  const trimmedPath = path.trim();

  if (!trimmedPath.startsWith('/')) {
    throw new Error('La ruta canónica debe ser absoluta');
  }

  return trimmedPath.endsWith('/') ? trimmedPath : `${trimmedPath}/`;
};

const extractCanonicalPathFromHtml = (html: string): string | null => {
  const match =
    html.match(CANONICAL_LINK_REGEX) ??
    html.match(CANONICAL_LINK_HREF_FIRST_REGEX);

  if (!match?.[1]) {
    return null;
  }

  try {
    const canonicalUrl = new URL(match[1], 'https://www.coches.net');
    return normalizePath(canonicalUrl.pathname);
  } catch {
    return null;
  }
};

const buildCanonicalPathFromPageInfo = (
  pageInfo: TechnicalSheetPageInfo
): string | null => {
  const {
    versionId,
    makeUrlParam,
    modelUrlParam,
    bodyType,
    doors,
    version,
  } = pageInfo;

  if (
    !makeUrlParam ||
    !modelUrlParam ||
    !bodyType ||
    doors === null ||
    !version
  ) {
    return null;
  }

  return normalizePath(
    `/fichas_tecnicas/${makeUrlParam}/${modelUrlParam}/${bodyType}/${doors}-puertas/${version}/${versionId}/`
  );
};

const resolveCanonicalPath = (
  html: string,
  pageInfo: TechnicalSheetPageInfo
): string => {
  const fromHtml = extractCanonicalPathFromHtml(html);
  if (fromHtml) {
    return fromHtml;
  }

  const fromProps = buildCanonicalPathFromPageInfo(pageInfo);
  if (fromProps) {
    return fromProps;
  }

  throw new Error(
    'No se pudo determinar la ruta canónica de la ficha técnica'
  );
};

const toVersionSpecification = (
  pageInfo: TechnicalSheetPageInfo
): VersionSpecification => {
  return {
    versionId: pageInfo.versionId,
    ...pageInfo.specifications,
    year: pageInfo.year,
    price: pageInfo.price,
    initMarketedDate: pageInfo.initMarketedDate,
    images: pageInfo.images,
    marketedVersions: pageInfo.marketedVersions,
  };
};

const parseInitMarketedDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const mapSpecificationToDbValues = (
  specification: VersionSpecification,
  crawlId: string
): unknown[] => {
  const specs: TechnicalSheetSpecifications = specification;

  return [
    specification.versionId,
    specs.acceleration,
    specs.consumptionAverage,
    specs.consumptionExtraUrban,
    specs.consumptionUrban,
    specs.cubicCapacity,
    specs.cylinders,
    specs.distribution,
    specs.doors,
    specs.emissions,
    specs.fuelTankCapacity,
    specs.fuelType,
    specs.gearBox,
    specs.height,
    specs.length,
    specs.width,
    specs.weight,
    specs.hp,
    specs.hpRpm,
    specs.torque,
    specs.torqueRpm,
    specs.seats,
    specs.luggageCapacity,
    specs.supply,
    specs.traction,
    specs.topSpeed,
    specification.year,
    specification.price,
    parseInitMarketedDate(specification.initMarketedDate),
    JSON.stringify(specification.images),
    JSON.stringify(specification.marketedVersions),
    crawlId,
  ];
};

export class TechnicalSheetScraper {
  private async updateCrawlLog(
    crawlId: string,
    updates: Partial<SpecsCrawlContext>
  ): Promise<void> {
    try {
      await query(
        `
        UPDATE crawl_logs
        SET
          processed_count = COALESCE($2, processed_count),
          total_count = COALESCE($3, total_count),
          error_count = COALESCE($4, error_count),
          updated_at = CURRENT_TIMESTAMP
        WHERE crawl_id = $1
        `,
        [crawlId, updates.processed, updates.total, updates.errors]
      );
    } catch (error) {
      logger.error('Failed to update specs crawl log', {
        crawlId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async countPendingVersions(): Promise<number> {
    const row = await queryOne<{ total: number }>(
      `
      SELECT COUNT(*)::int AS total
      FROM versions
      WHERE specs_scraped_at IS NULL
      `
    );

    return row?.total ?? 0;
  }

  private async fetchPendingVersions(
    limit?: number,
    offset?: number
  ): Promise<PendingVersionRow[]> {
    const values: number[] = [];
    let paginationClause = '';

    if (limit !== undefined) {
      values.push(limit);
      paginationClause += ` LIMIT $${values.length}`;
    }

    if (offset !== undefined) {
      values.push(offset);
      paginationClause += ` OFFSET $${values.length}`;
    }

    const rows = await query<{
      version_id: number;
      name: string;
      technical_url_path: string | null;
      make_name: string;
      model_name: string;
      body_type_id: number;
      doors: number | null;
    }>(
      `
      SELECT
        v.version_id,
        v.name,
        v.technical_url_path,
        m.name AS make_name,
        mo.name AS model_name,
        bt.body_type_id,
        bt.doors
      FROM versions v
      JOIN makes m ON v.make_id = m.id
      JOIN models mo ON v.model_id = mo.id
      JOIN body_types bt ON v.body_type_id = bt.id
      WHERE v.specs_scraped_at IS NULL
      ORDER BY v.id
      ${paginationClause}
      `,
      values
    );

    return rows.map((row) => ({
      versionId: row.version_id,
      name: row.name,
      technicalUrlPath: row.technical_url_path,
      makeName: row.make_name,
      modelName: row.model_name,
      bodyTypeId: row.body_type_id,
      doors: row.doors,
    }));
  }

  private resolveVersionUrl(version: PendingVersionRow): string {
    if (version.doors === null) {
      throw new Error(
        `La versión ${version.versionId} no tiene puertas definidas para construir la URL`
      );
    }

    return buildTechnicalSheetUrl({
      versionId: version.versionId,
      makeName: version.makeName,
      modelName: version.modelName,
      bodyTypeId: version.bodyTypeId,
      doors: version.doors,
      versionName: version.name,
      technicalUrlPath: version.technicalUrlPath,
    });
  }

  private async upsertVersionSpecification(
    specification: VersionSpecification,
    crawlId: string
  ): Promise<void> {
    await query(
      `
      INSERT INTO version_specifications (
        version_id,
        acceleration,
        consumption_average,
        consumption_extra_urban,
        consumption_urban,
        cubic_capacity,
        cylinders,
        distribution,
        doors,
        emissions,
        fuel_tank_capacity,
        fuel_type,
        gear_box,
        height,
        length,
        width,
        weight,
        hp,
        hp_rpm,
        torque,
        torque_rpm,
        seats,
        luggage_capacity,
        supply,
        traction,
        top_speed,
        year,
        price,
        init_marketed_date,
        images,
        marketed_versions,
        crawl_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30::jsonb,
        $31::jsonb, $32
      )
      ON CONFLICT (version_id) DO UPDATE SET
        acceleration = EXCLUDED.acceleration,
        consumption_average = EXCLUDED.consumption_average,
        consumption_extra_urban = EXCLUDED.consumption_extra_urban,
        consumption_urban = EXCLUDED.consumption_urban,
        cubic_capacity = EXCLUDED.cubic_capacity,
        cylinders = EXCLUDED.cylinders,
        distribution = EXCLUDED.distribution,
        doors = EXCLUDED.doors,
        emissions = EXCLUDED.emissions,
        fuel_tank_capacity = EXCLUDED.fuel_tank_capacity,
        fuel_type = EXCLUDED.fuel_type,
        gear_box = EXCLUDED.gear_box,
        height = EXCLUDED.height,
        length = EXCLUDED.length,
        width = EXCLUDED.width,
        weight = EXCLUDED.weight,
        hp = EXCLUDED.hp,
        hp_rpm = EXCLUDED.hp_rpm,
        torque = EXCLUDED.torque,
        torque_rpm = EXCLUDED.torque_rpm,
        seats = EXCLUDED.seats,
        luggage_capacity = EXCLUDED.luggage_capacity,
        supply = EXCLUDED.supply,
        traction = EXCLUDED.traction,
        top_speed = EXCLUDED.top_speed,
        year = EXCLUDED.year,
        price = EXCLUDED.price,
        init_marketed_date = EXCLUDED.init_marketed_date,
        images = EXCLUDED.images,
        marketed_versions = EXCLUDED.marketed_versions,
        scraped_at = CURRENT_TIMESTAMP,
        crawl_id = EXCLUDED.crawl_id
      `,
      mapSpecificationToDbValues(specification, crawlId)
    );
  }

  private async markVersionAsScraped(
    versionId: number,
    technicalUrlPath: string
  ): Promise<void> {
    await query(
      `
      UPDATE versions
      SET
        technical_url_path = $2,
        specs_scraped_at = CURRENT_TIMESTAMP
      WHERE version_id = $1
      `,
      [versionId, technicalUrlPath]
    );
  }

  private async processVersion(
    version: PendingVersionRow,
    crawlId: string
  ): Promise<void> {
    const url = this.resolveVersionUrl(version);
    const html = await fetchPageHtml(url);
    const initialProps = parseInitialProps(html);
    const pageInfo = initialProps.pageInfoResponse;

    if (pageInfo.versionId !== version.versionId) {
      throw new Error(
        `versionId del JSON (${pageInfo.versionId}) no coincide con BD (${version.versionId})`
      );
    }

    const specification = toVersionSpecification(pageInfo);
    const canonicalPath = resolveCanonicalPath(html, pageInfo);

    await this.upsertVersionSpecification(specification, crawlId);
    await this.markVersionAsScraped(version.versionId, canonicalPath);
  }

  async startSpecsCrawl(options: StartSpecsCrawlOptions = {}): Promise<string> {
    const crawlId = uuidv4();
    const pendingTotal = await this.countPendingVersions();

    try {
      await query(
        `
        INSERT INTO crawl_logs (
          crawl_id,
          crawl_type,
          status,
          processed_count,
          total_count,
          error_count,
          message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [crawlId, 'specs', 'running', 0, 0, 0, `Specs crawl started (${pendingTotal} pendientes)`]
      );

      logger.info(`Specs crawl started with ID: ${crawlId}`, {
        pendingTotal,
        limit: options.limit,
        offset: options.offset,
      });
    } catch (error) {
      logger.error('Failed to create specs crawl log', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }

    this.runSpecsCrawl(crawlId, options).catch((error) => {
      logger.error('Specs crawl failed', {
        crawlId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

    return crawlId;
  }

  private async runSpecsCrawl(
    crawlId: string,
    options: StartSpecsCrawlOptions
  ): Promise<void> {
    const context: SpecsCrawlContext = {
      crawlId,
      processed: 0,
      total: 0,
      errors: 0,
      startedAt: new Date(),
    };

    try {
      const versions = await this.fetchPendingVersions(
        options.limit,
        options.offset
      );

      context.total = versions.length;
      await this.updateCrawlLog(crawlId, context);

      logger.info(`Running specs crawl: ${crawlId}`, {
        batchSize: versions.length,
        limit: options.limit,
        offset: options.offset,
      });

      let consecutiveBotErrors = 0;
      const maxConsecutiveBotErrors = parseInt(
        process.env.SPECS_MAX_CONSECUTIVE_BOT_ERRORS ||
          String(DEFAULT_MAX_CONSECUTIVE_BOT_ERRORS),
        10
      );

      for (const version of versions) {
        try {
          await specsCrawlDelay();
          await this.processVersion(version, crawlId);
          consecutiveBotErrors = 0;
        } catch (error) {
          context.errors++;
          logger.error(`Error scraping specs for version ${version.versionId}`, {
            versionId: version.versionId,
            versionName: version.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          if (error instanceof BrowserLaunchError) {
            throw error;
          }

          if (error instanceof BotProtectionError) {
            consecutiveBotErrors++;
            if (
              Number.isFinite(maxConsecutiveBotErrors) &&
              maxConsecutiveBotErrors > 0 &&
              consecutiveBotErrors >= maxConsecutiveBotErrors
            ) {
              throw new Error(
                `Abortando crawl specs tras ${consecutiveBotErrors} bloqueos WAF consecutivos. ` +
                  'Revisa xvfb/headless y el perfil Playwright, luego reintenta con limit pequeño.'
              );
            }
          } else {
            consecutiveBotErrors = 0;
          }
        }

        context.processed++;
        await this.updateCrawlLog(crawlId, context);
      }

      await query(
        `
        UPDATE crawl_logs
        SET status = $1, completed_at = CURRENT_TIMESTAMP
        WHERE crawl_id = $2
        `,
        ['completed', crawlId]
      );

      logger.info(`Specs crawl completed: ${crawlId}`, {
        processed: context.processed,
        errors: context.errors,
        duration: Date.now() - context.startedAt.getTime(),
      });
    } catch (error) {
      logger.error(`Specs crawl failed: ${crawlId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      await query(
        `
        UPDATE crawl_logs
        SET status = $1, completed_at = CURRENT_TIMESTAMP, message = $2
        WHERE crawl_id = $3
        `,
        [
          'failed',
          error instanceof Error ? error.message : 'Unknown error',
          crawlId,
        ]
      );
    }
  }
}

export const startSpecsCrawl = (
  options?: StartSpecsCrawlOptions
): Promise<string> => {
  const scraper = new TechnicalSheetScraper();
  return scraper.startSpecsCrawl(options);
};
