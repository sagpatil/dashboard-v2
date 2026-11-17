import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/cache.ts';

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
};

describe('TtlCache', () => {
  it('serves a hit within the TTL and reloads after it', async () => {
    const c = clock();
    const cache = new TtlCache(10, c.now);
    let loads = 0;
    const load = async () => ++loads;

    assert.deepEqual(await cache.get('k', { ttlMs: 100 }, load), { value: 1, status: 'miss', ageMs: 0 });
    c.advance(50);
    assert.deepEqual(await cache.get('k', { ttlMs: 100 }, load), { value: 1, status: 'hit', ageMs: 50 });
    c.advance(60);
    assert.equal((await cache.get('k', { ttlMs: 100 }, load)).value, 2);
  });

  it('coalesces concurrent misses into one load', async () => {
    const cache = new TtlCache();
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const load = async () => { loads++; await gate; return 'v'; };

    const pending = Promise.all([1, 2, 3].map(() => cache.get('k', { ttlMs: 100 }, load)));
    release();
    const results = await pending;
    assert.equal(loads, 1);
    assert.ok(results.every(r => r.value === 'v'));
  });

  it('serves a stale value when a refresh fails, within staleIfErrorMs', async () => {
    const c = clock();
    const cache = new TtlCache(10, c.now);
    await cache.get('k', { ttlMs: 100 }, async () => 'good');
    c.advance(150);
    const fail = async () => { throw new Error('upstream down'); };

    const stale = await cache.get('k', { ttlMs: 100, staleIfErrorMs: 100 }, fail);
    assert.deepEqual(stale, { value: 'good', status: 'stale', ageMs: 150 });

    c.advance(100);
    await assert.rejects(cache.get('k', { ttlMs: 100, staleIfErrorMs: 100 }, fail), /upstream down/);
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache();
    await assert.rejects(cache.get('k', { ttlMs: 100 }, async () => { throw new Error('x'); }));
    assert.equal((await cache.get('k', { ttlMs: 100 }, async () => 'ok')).value, 'ok');
  });

  it('evicts the oldest entries beyond maxEntries', async () => {
    const cache = new TtlCache(2);
    for (const key of ['a', 'b', 'c']) await cache.get(key, { ttlMs: 1000 }, async () => key);
    assert.equal(cache.size, 2);
    let reloaded = false;
    await cache.get('a', { ttlMs: 1000 }, async () => { reloaded = true; return 'a'; });
    assert.ok(reloaded, 'oldest key should have been evicted');
  });
});
