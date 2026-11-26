const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Limita la tasa global de requests: reparte "turnos" separados por
 * `minIntervalMs` entre todos los workers que comparten la instancia.
 */
export class RateLimiter {
  private nextSlot = 0;

  constructor(private readonly minIntervalMs: number) {}

  static perSecond(maxPerSecond: number): RateLimiter {
    return new RateLimiter(maxPerSecond > 0 ? 1000 / maxPerSecond : 0);
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    const wait = slot - now;
    if (wait > 0) {
      await sleep(wait);
    }
  }
}

/**
 * Procesa `items` con como máximo `concurrency` workers a la vez.
 * El worker debe capturar sus propios errores: si lanza, la promesa
 * rechaza cuando terminen los demás workers en curso.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const size = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: size }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
}

/**
 * Caché de promesas por clave: llamadas concurrentes con la misma clave
 * comparten la misma promesa. Si la promesa falla, la clave se libera.
 */
export class PromiseCache<V> {
  private readonly entries = new Map<string, Promise<V>>();

  get(key: string, factory: () => Promise<V>): Promise<V> {
    const cached = this.entries.get(key);
    if (cached) {
      return cached;
    }
    const promise = factory().catch((error: unknown) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}
