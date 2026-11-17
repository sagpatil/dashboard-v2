import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { fakeFetch, json, ledgerPage, makeLedger, testConfig, waitFor } from './helpers.ts';

const ACCOUNT = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';
const UNFUNDED = 'GBEZOC5U4TVH7ZY5N3FLYHTCZSI6VFGTULG7PBITLF5ZEBPJXFT46YZM';

const upstreamRoutes = () => {
  let statusUp = true;
  const upstream = fakeFetch({
    'horizon.test/fee_stats': () => json({ last_ledger: '100', fee_charged: { p50: '100' } }),
    'horizon.test/operations': url => json({
      _embedded: { records: Array.from({ length: Number(url.searchParams.get('limit')) }, (_, i) => ({ id: String(i) })) },
    }),
    [`horizon-testnet.test/accounts/${ACCOUNT}`]: () => json({
      balances: [{ asset_type: 'credit_alphanum4', balance: '5' }, { asset_type: 'native', balance: '123.4567890' }],
    }),
    [`horizon-testnet.test/accounts/${UNFUNDED}`]: () => json({ status: 404 }, 404),
    'dashboard.test/api/v2/lumens': () => json({ totalSupply: '105443902087' }),
    'dashboard.test/api/ledgers/public': () => json([{ date: '2026-11-16', transaction_count: 1, operation_count: 2 }]),
    'status.test/api/v2/summary.json': () => (statusUp ? json({ status: { indicator: 'none' } }) : new Response('', { status: 500 })),
    'status.test/api/v2/incidents.json': () => json({ incidents: [] }),
  });
  return { upstream, setStatusUp: (up: boolean) => { statusUp = up; } };
};

describe('API server', async () => {
  const { upstream } = upstreamRoutes();
  const { app, ctx } = await buildApp(testConfig(), { fetchImpl: upstream.impl, startFeeds: false, logger: false });
  after(() => app.close());

  it('caches Horizon fee stats across requests', async () => {
    const first = await app.inject('/api/networks/mainnet/fee-stats');
    const second = await app.inject('/api/networks/mainnet/fee-stats');
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().last_ledger, '100');
    assert.equal(first.headers['x-cache'], 'MISS');
    assert.equal(second.headers['x-cache'], 'HIT');
    assert.match(String(second.headers['cache-control']), /^public, max-age=[0-5]$/);
    assert.equal(upstream.count('fee_stats'), 1);
  });

  it('rejects unknown networks and bad query values', async () => {
    assert.equal((await app.inject('/api/networks/devnet/fee-stats')).statusCode, 400);
    assert.equal((await app.inject('/api/networks/mainnet/operations?limit=500')).statusCode, 400);
  });

  it('returns operations with a validated limit', async () => {
    const res = await app.inject('/api/networks/mainnet/operations?limit=3');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().length, 3);
    assert.equal((await app.inject('/api/networks/mainnet/operations')).json().length, 20);
  });

  it('returns the native balance, 0 for unfunded accounts, 400 for bad ids', async () => {
    const funded = await app.inject(`/api/networks/testnet/accounts/${ACCOUNT}/balance`);
    assert.deepEqual(funded.json(), { accountId: ACCOUNT, balance: '123.4567890' });

    const unfunded = await app.inject(`/api/networks/testnet/accounts/${UNFUNDED}/balance`);
    assert.deepEqual(unfunded.json(), { accountId: UNFUNDED, balance: '0' });

    const bad = await app.inject('/api/networks/testnet/accounts/not-a-key/balance');
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().message, /public key/);
  });

  it('proxies lumen supply, history and StatusPage', async () => {
    assert.equal((await app.inject('/api/lumens')).json().totalSupply, '105443902087');
    assert.equal((await app.inject('/api/history/daily')).json()[0].date, '2026-11-16');
    assert.equal((await app.inject('/api/status/summary')).json().status.indicator, 'none');
    assert.deepEqual((await app.inject('/api/status/incidents')).json(), { incidents: [] });
  });

  it('serves ledgers and stats from the live feed', async () => {
    const feed = ctx.feeds.get('mainnet')!;
    assert.equal((await app.inject('/api/networks/mainnet/stats')).statusCode, 503);

    for (const ledger of ledgerPage(500, 10).reverse()) feed.ingest(ledger);
    const ledgers = (await app.inject('/api/networks/mainnet/ledgers?limit=3')).json();
    assert.deepEqual(ledgers.map((l: { sequence: number }) => l.sequence), [500, 499, 498]);

    const stats = (await app.inject('/api/networks/mainnet/stats')).json();
    assert.equal(stats.lastLedgerSequence, 500);
    assert.equal(stats.status, 'operational');
    assert.ok(Math.abs(stats.avgLedgerCloseTime - 5) < 0.01);
  });

  it('reports feed health', async () => {
    const body = (await app.inject('/api/health')).json();
    assert.equal(body.status, 'degraded'); // feeds were never started
    assert.deepEqual(body.feeds.map((f: { network: string }) => f.network), ['mainnet', 'testnet']);
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await app.inject('/api/nope');
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, 'Not Found');
  });
});

describe('API server upstream failures', async () => {
  const { upstream, setStatusUp } = upstreamRoutes();
  const { app } = await buildApp(testConfig(), { fetchImpl: upstream.impl, startFeeds: false, logger: false });
  after(() => app.close());

  it('returns 502 when an upstream fails and nothing is cached', async () => {
    setStatusUp(false);
    const res = await app.inject('/api/status/summary');
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error, 'Bad Gateway');
  });

  it('returns 503 for a network whose feed is disabled', async () => {
    const { app: apiOnly } = await buildApp(testConfig({ ledgerFeeds: ['mainnet'] }), {
      fetchImpl: upstream.impl, startFeeds: false, logger: false,
    });
    const res = await apiOnly.inject('/api/networks/testnet/ledgers');
    assert.equal(res.statusCode, 503);
    assert.match(res.json().message, /disabled/);
    await apiOnly.close();
  });
});

describe('ledger event stream', async () => {
  const { upstream } = upstreamRoutes();
  const { app, ctx } = await buildApp(testConfig(), { fetchImpl: upstream.impl, startFeeds: false, logger: false });
  let base = '';
  before(async () => {
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  });
  after(() => app.close());

  it('sends a snapshot, then each new ledger', async () => {
    const feed = ctx.feeds.get('testnet')!;
    for (const ledger of ledgerPage(50, 3).reverse()) feed.ingest(ledger);

    const controller = new AbortController();
    const res = await fetch(`${base}/api/networks/testnet/ledgers/stream`, { signal: controller.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');

    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    const readUntil = async (pattern: RegExp) => {
      while (!pattern.test(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        text += value;
      }
    };

    await readUntil(/event: snapshot\ndata: .*\n\n/);
    const snapshot = JSON.parse(/event: snapshot\ndata: (.*)\n/.exec(text)![1]);
    assert.equal(snapshot.network, 'testnet');
    assert.deepEqual(snapshot.ledgers.map((l: { sequence: number }) => l.sequence), [50, 49, 48]);

    await waitFor(() => feed.status().subscribers === 1);
    feed.ingest(makeLedger(51));
    await readUntil(/event: ledger\ndata: .*\n\n/);
    assert.equal(JSON.parse(/event: ledger\ndata: (.*)\n/.exec(text)![1]).sequence, 51);

    controller.abort();
    await waitFor(() => feed.status().subscribers === 0);
  });
});

describe('frontend hosting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const { app } = await buildApp(testConfig({ staticDir: dir }), { startFeeds: false, logger: false });
  after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html with no-cache and fingerprinted assets as immutable', async () => {
    const index = await app.inject('/');
    assert.equal(index.statusCode, 200);
    assert.match(index.body, /id="root"/);
    assert.equal(index.headers['cache-control'], 'no-cache');

    const asset = await app.inject('/assets/app-abc123.js');
    assert.match(String(asset.headers['cache-control']), /immutable/);
  });

  it('falls back to index.html for app paths but not for /api', async () => {
    assert.match((await app.inject('/some/page')).body, /id="root"/);
    assert.equal((await app.inject('/api/missing')).statusCode, 404);
  });
});
