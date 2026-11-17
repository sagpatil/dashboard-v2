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
  // How long past its TTL a value may still be served if a refresh fails
  staleIfErrorMs?: number;
}

// In-memory TTL cache that
//  - coalesces concurrent misses for a key into one upstream request, and
//  - keeps serving the last good value for a while if the upstream fails.
// Entries are evicted oldest-first once maxEntries is reached.
export class TtlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
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

    try {
      const value = await this.load(key, load);
      return { value, status: 'miss', ageMs: this.ageOf(key) };
    } catch (error) {
      const staleLimit = options.ttlMs + (options.staleIfErrorMs ?? 0);
      // Re-read: another caller may have stored a fresh value meanwhile
      const latest = this.entries.get(key);
      const latestAge = latest ? this.now() - latest.storedAt : Infinity;
      if (latest && latestAge < staleLimit) {
        return { value: latest.value as T, status: 'stale', ageMs: latestAge };
      }
      throw error;
    }
  }

  private ageOf(key: string): number {
    const entry = this.entries.get(key);
    return entry ? this.now() - entry.storedAt : 0;
  }

  private load<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = load()
      .then(value => {
        this.set(key, value);
        return value;
      })
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
    }
  }
}
