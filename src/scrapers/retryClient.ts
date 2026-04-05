import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { logger } from '../utils/logger.js';

export interface RetryClientConfig extends AxiosRequestConfig {
  maxRetries?: number;
  baseDelay?: number;
}

export class RetryClient {
  private client: AxiosInstance;
  private maxRetries: number;
  private baseDelay: number;

  constructor(baseURL: string, maxRetries = 3, baseDelay = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;

    this.client = axios.create({
      baseURL,
      timeout: parseInt(process.env.SCRAPER_TIMEOUT_MS || '10000', 10),
      headers: {
        'x-schibsted-tenant': 'coches',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get<T = unknown>(
    url: string,
    config?: RetryClientConfig
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`GET ${url} (attempt ${attempt + 1}/${this.maxRetries + 1})`);
        const response = await this.client.get<T>(url, config);
        return response.data;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error('Unknown error during request');

        if (attempt < this.maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt);
          logger.warn(
            `Request failed, retrying after ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`,
            { url, error: lastError.message }
          );
          await this.sleep(delay);
        } else {
          logger.error(`Request failed after ${this.maxRetries + 1} attempts`, {
            url,
            error: lastError.message,
          });
        }
      }
    }

    throw lastError || new Error('Request failed after all retries');
  }
}
