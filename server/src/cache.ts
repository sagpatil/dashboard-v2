export type CacheStatus = 'hit' | 'miss' | 'stale';

export interface CacheResult<T> {
  value: T;
  status: CacheStatus;
  // Age of the returned value
  ageMs: number;
}

interface Entry {
  value: unknown;
  storedAt: number;
}

export interface CacheOptions {
  // How long a value is served without going upstream
  ttlMs: number;
  // How long past its TTL a value may still be served if a refresh fails or is slow
  staleIfErrorMs?: number;
  // How long a request waits for a refresh before settling for the stale value
  // (the refresh carries on in the background). Default 2s.
  maxWaitMs?: number;
}

const DEFAULT_MAX_WAIT_MS = 2000;
// After a failed refresh, wait this long (or the TTL if shorter) before trying
// the upstream again, so an outage is not hammered and callers are not delayed
const MAX_FAILURE_BACKOFF_MS = 10_000;

// In-memory TTL cache that
//  - coalesces concurrent misses for a key into one upstream request,
//  - keeps serving the last good value for a while if the upstream fails, and
//  - never makes a caller wait long when it has an older value to give.
// Entries are evicted oldest-first once maxEntries is reached.
export class TtlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly failedAt = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(maxEntries = 1000, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  async get<T>(key: string, options: CacheOptions, load: () => Promise<T>): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);
    const age = entry ? this.now() - entry.storedAt : Infinity;
    if (entry && age < options.ttlMs) {
      return { value: entry.value as T, status: 'hit', ageMs: age };
    }

    if (!entry || age >= options.ttlMs + (options.staleIfErrorMs ?? 0)) {
      // Nothing to fall back on: the caller has to wait for the upstream
      const value = await this.load(key, load);
      return { value, status: 'miss', ageMs: this.ageOf(key) };
    }

    const stale = (): CacheResult<T> => {
      const latest = this.entries.get(key) ?? entry;
      return { value: latest.value as T, status: 'stale', ageMs: this.now() - latest.storedAt };
    };

    // The last refresh just failed: answer at once instead of trying again
    const failedAt = this.failedAt.get(key);
    const backoff = Math.min(options.ttlMs, MAX_FAILURE_BACKOFF_MS);
    if (failedAt !== undefined && this.now() - failedAt < backoff && !this.inflight.has(key)) {
      return stale();
    }

    const refresh = this.load(key, load).then(
      value => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<{ ok: false }>(resolve => {
      timer = setTimeout(() => resolve({ ok: false }), options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
    });
    const outcome = await Promise.race([refresh, timeout]);
    clearTimeout(timer);

    return outcome.ok
      ? { value: outcome.value, status: 'miss', ageMs: this.ageOf(key) }
      : stale();
  }

  private ageOf(key: string): number {
    const entry = this.entries.get(key);
    return entry ? this.now() - entry.storedAt : 0;
  }

  private load<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = load()
      .then(
        value => {
          this.failedAt.delete(key);
          this.set(key, value);
          return value;
        },
        error => {
          // Only worth remembering while there is a value to serve instead
          if (this.entries.has(key)) this.failedAt.set(key, this.now());
          throw error;
        },
      )
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private set(key: string, value: unknown) {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
      this.failedAt.delete(oldest);
    }
  }
}
