import { chromium, type BrowserContext, type Page } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

const DEFAULT_PROFILE_PATH = './playwright-profile';
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_CHALLENGE_WAIT_MS = 15_000;
const INITIAL_PROPS_MARKER = 'window.__INITIAL_PROPS__';
const WARMUP_URL = 'https://www.coches.net/fichas_tecnicas/';

let contextPromise: Promise<BrowserContext> | null = null;
let hasWarmedUp = false;

export class BotProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotProtectionError';
  }
}

export class BrowserLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserLaunchError';
  }
}

const clearStaleChromiumLocks = async (profilePath: string): Promise<void> => {
  const lockNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

  await Promise.all(
    lockNames.map(async (lockName) => {
      try {
        await fs.unlink(path.join(profilePath, lockName));
      } catch {
        // ignore missing locks
      }
    })
  );
};

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const getProfilePath = (): string => {
  return process.env.PLAYWRIGHT_PROFILE_PATH?.trim() || DEFAULT_PROFILE_PATH;
};

const getHeadless = (): boolean => {
  return parseBooleanEnv(process.env.PLAYWRIGHT_HEADLESS, true);
};

const getNavigationTimeoutMs = (): number => {
  const fromEnv = parseInt(
    process.env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS ||
      process.env.SCRAPER_TIMEOUT_MS ||
      String(DEFAULT_NAVIGATION_TIMEOUT_MS),
    10
  );

  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : DEFAULT_NAVIGATION_TIMEOUT_MS;
};

const getChallengeWaitMs = (): number => {
  const fromEnv = parseInt(
    process.env.PLAYWRIGHT_CHALLENGE_WAIT_MS || String(DEFAULT_CHALLENGE_WAIT_MS),
    10
  );

  return Number.isFinite(fromEnv) && fromEnv >= 0
    ? fromEnv
    : DEFAULT_CHALLENGE_WAIT_MS;
};

const getSpecsDelayBounds = (): { minMs: number; maxMs: number } => {
  const minMs = parseInt(process.env.SPECS_CRAWL_DELAY_MIN_MS || '500', 10);
  const maxMs = parseInt(process.env.SPECS_CRAWL_DELAY_MAX_MS || '1500', 10);

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs < 0 || maxMs < minMs) {
    return { minMs: 500, maxMs: 1500 };
  }

  return { minMs, maxMs };
};

const looksLikeBotWall = (html: string, status?: number): boolean => {
  if (status === 403 || status === 405 || status === 429) {
    return true;
  }

  const sample = html.slice(0, 8_000).toLowerCase();

  return (
    sample.includes('captcha') ||
    sample.includes('datadome') ||
    sample.includes('px-captcha') ||
    sample.includes('access denied') ||
    sample.includes('please enable js') ||
    sample.includes('cf-challenge') ||
    sample.includes('challenge-platform') ||
    sample.includes('parece que algo no va bien') ||
    sample.includes('ups!')
  );
};

const htmlHasInitialProps = (html: string): boolean => {
  return html.includes(INITIAL_PROPS_MARKER);
};

const createPersistentContext = async (): Promise<BrowserContext> => {
  const profilePath = getProfilePath();
  const headless = getHeadless();

  logger.info('Iniciando contexto persistente de Playwright', {
    profilePath,
    headless,
    display: process.env.DISPLAY || null,
    hasXauthority: Boolean(process.env.XAUTHORITY),
  });

  // Locks huérfanos tras crashes previos de Chromium en Docker.
  await clearStaleChromiumLocks(profilePath);

  // No fijar userAgent antiguo: Playwright usa el del Chromium real instalado.
  try {
    return await chromium.launchPersistentContext(profilePath, {
      headless,
      viewport: { width: 1365, height: 900 },
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
      extraHTTPHeaders: {
        'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes('XServer') ||
      message.includes('Missing X server') ||
      message.includes('$DISPLAY')
    ) {
      throw new BrowserLaunchError(
        'Chromium headed sin display. En Docker usa la imagen con xvfb-run ' +
          '(CMD del Dockerfile) o PLAYWRIGHT_HEADLESS=true.'
      );
    }

    throw new BrowserLaunchError(
      `No se pudo iniciar Playwright: ${message.slice(0, 300)}`
    );
  }
};

export const getPlaywrightContext = async (): Promise<BrowserContext> => {
  if (!contextPromise) {
    contextPromise = createPersistentContext().catch((error) => {
      contextPromise = null;
      throw error;
    });
  }

  return contextPromise;
};

export const specsCrawlDelay = async (): Promise<void> => {
  const { minMs, maxMs } = getSpecsDelayBounds();
  const delayMs = Math.random() * (maxMs - minMs) + minMs;

  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const warmUpSession = async (page: Page): Promise<void> => {
  if (hasWarmedUp) {
    return;
  }

  logger.info('Warm-up de sesión Playwright', { url: WARMUP_URL });

  try {
    await page.goto(WARMUP_URL, {
      waitUntil: 'domcontentloaded',
      timeout: getNavigationTimeoutMs(),
    });
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(getChallengeWaitMs(), 5_000))
    );
  } catch (error) {
    logger.warn('Warm-up de Playwright falló (se continúa)', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    hasWarmedUp = true;
  }
};

const waitForInitialPropsInDom = async (page: Page): Promise<string | null> => {
  const challengeWaitMs = getChallengeWaitMs();

  if (challengeWaitMs <= 0) {
    return null;
  }

  try {
    await page.waitForFunction(
      (marker) => document.documentElement.innerHTML.includes(marker),
      INITIAL_PROPS_MARKER,
      { timeout: challengeWaitMs }
    );

    return page.content();
  } catch {
    return null;
  }
};

/**
 * Obtiene el HTML crudo de la ficha.
 * Prioriza el body de la respuesta de navegación (contiene __INITIAL_PROPS__).
 * Evita un segundo fetch() en el browser: el WAF suele responder 403 ahí.
 */
export const fetchPageHtml = async (url: string): Promise<string> => {
  const context = await getPlaywrightContext();
  const page = await context.newPage();
  const navigationTimeoutMs = getNavigationTimeoutMs();

  try {
    await warmUpSession(page);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs,
    });

    const status = response?.status();
    let html = '';

    try {
      html = (await response?.text()) ?? '';
    } catch {
      html = '';
    }

    if (!html.trim()) {
      html = await page.content();
    }

    if (!htmlHasInitialProps(html)) {
      logger.warn('HTML sin __INITIAL_PROPS__; esperando challenge/hidratación', {
        url,
        status,
      });

      const waitedHtml = await waitForInitialPropsInDom(page);
      if (waitedHtml && htmlHasInitialProps(waitedHtml)) {
        html = waitedHtml;
      }
    }

    if (!html.trim()) {
      throw new Error('La respuesta HTML está vacía');
    }

    if (looksLikeBotWall(html, status) || !htmlHasInitialProps(html)) {
      throw new BotProtectionError(
        `WAF/bot protection bloqueó la ficha (status=${status ?? 'n/a'}). ` +
          'Desde Docker coches.net suele devolver 405 ("Ups! Parece que algo no va bien..."). ' +
          'Prueba el crawl de specs en el host (npm run dev) con navegador real, ' +
          'o importa cookies de una sesión ya validada en el perfil Playwright.'
      );
    }

    return html;
  } finally {
    await page.close();
  }
};

export const closePlaywrightContext = async (): Promise<void> => {
  if (!contextPromise) {
    return;
  }

  try {
    const context = await contextPromise;
    await context.close();
    logger.info('Contexto persistente de Playwright cerrado');
  } catch (error) {
    logger.error('Error al cerrar el contexto de Playwright', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  } finally {
    contextPromise = null;
    hasWarmedUp = false;
  }
};
