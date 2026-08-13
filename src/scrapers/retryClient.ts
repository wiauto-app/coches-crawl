import { logger } from '../utils/logger.js';

export interface RetryClientConfig {
  headers?: HeadersInit;
  signal?: AbortSignal;
  maxRetries?: number;
  baseDelay?: number;
}

export class RetryClient {
  private baseURL: string;
  private maxRetries: number;
  private baseDelay: number;
  private timeoutMs: number;
  private defaultHeaders: Headers;
  private referer: string;

  constructor(baseURL: string, maxRetries = 3, baseDelay = 1000) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.timeoutMs = parseInt(process.env.SCRAPER_TIMEOUT_MS || '10000', 10);

    this.referer =
      process.env.SCRAPER_REFERER || 'https://www.coches.net/';

    this.defaultHeaders = new Headers({
      accept: '*/*',
      'accept-language': 'es-419,es;q=0.9',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      priority: 'u=1, i',
      'sec-ch-ua': '"Not-A.Brand";v="24", "Chromium";v="146"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'x-schibsted-tenant': 'coches',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    });
  }

  private mergeHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(this.defaultHeaders);
    if (extra) {
      new Headers(extra).forEach((value, key) => {
        headers.set(key, value);
      });
    }
    return headers;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get<T = unknown>(
    url: string,
    config?: RetryClientConfig
  ): Promise<T> {
    const maxRetries = config?.maxRetries ?? this.maxRetries;
    const baseDelay = config?.baseDelay ?? this.baseDelay;
    const targetUrl = new URL(url, `${this.baseURL}/`).href;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId =
        config?.signal === undefined
          ? setTimeout(() => controller.abort(), this.timeoutMs)
          : null;
      const signal = config?.signal ?? controller.signal;

      try {
        logger.debug(
          `GET ${targetUrl} (attempt ${attempt + 1}/${maxRetries + 1})`
        );

        const response = await fetch(targetUrl, {
          method: 'GET',
          headers: this.mergeHeaders(config?.headers),
          referrer: this.referer,
          credentials: 'include',
          mode: 'cors',
          signal,
        });

        if (!response.ok) {
          const error = await response.json()
          console.log(error)
          logger.error('Request failed', {
            url: targetUrl,
            status: response.status,
          });
          throw new Error(`Request failed with status ${response.status}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error('Unknown error during request');

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          logger.warn(
            `Request failed, retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
            { url: targetUrl, error: lastError.message }
          );
          await this.sleep(delay);
        } else {
          logger.error(`Request failed after ${maxRetries + 1} attempts`, {
            url: targetUrl,
            error: lastError.message,
          });
        }
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    }

    throw lastError || new Error('Request failed after all retries');
  }
}
