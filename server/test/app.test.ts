import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import type { ServerConfig } from '../src/config.ts';
import { fakeFetch, json, ledgerPage, makeLedger, testConfig, waitFor } from './helpers.ts';

const ACCOUNT = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';
const UNFUNDED = 'GBEZOC5U4TVH7ZY5N3FLYHTCZSI6VFGTULG7PBITLF5ZEBPJXFT46YZM';
const NOT_ALLOWED = 'GCGNWKCJ3KHRLPM3TM6N7D3W5YKDJFL6A2YCXFXNMRTZ4Q66MEMZ6FI2';

const percentiles = Object.fromEntries(
  ['max', 'min', 'mode', 'p10', 'p20', 'p30', 'p40', 'p50', 'p60', 'p70', 'p80', 'p90', 'p95', 'p99'].map(k => [k, '100']),
);
const feeStats = {
  last_ledger: '100', last_ledger_base_fee: '100', ledger_capacity_usage: '0.5',
  fee_charged: percentiles, max_fee: percentiles,
};
const operation = (i: number) => ({
  id: String(i), type: 'payment', source_account: ACCOUNT, created_at: '2026-11-17T00:00:00Z', _links: {},
});
const summary = {
  status: { indicator: 'none', description: 'All Systems Operational' }, incidents: [], scheduled_maintenances: [],
};

const makeUpstream = () => {
  const state = { statusUp: true, feeStats: feeStats as unknown };
  const upstream = fakeFetch({
    'horizon.test/fee_stats': () => json(state.feeStats),
    'horizon.test/operations': url => json({
      _embedded: { records: Array.from({ length: Number(url.searchParams.get('limit')) }, (_, i) => operation(i)) },
    }),
    [`horizon-testnet.test/accounts/${ACCOUNT}`]: () => json({
      balances: [{ asset_type: 'credit_alphanum4', balance: '5' }, { asset_type: 'native', balance: '123.4567890' }],
    }),
    [`horizon-testnet.test/accounts/${UNFUNDED}`]: () => json({ status: 404 }, 404),
    'dashboard.test/api/v2/lumens': () => json({
      originalSupply: '100000000000', inflationLumens: '5', burnedLumens: '5', totalSupply: '105443902087',
      upgradeReserve: '0', feePool: '1', sdfMandate: '2', circulatingSupply: '3',
    }),
    'dashboard.test/api/ledgers/public': () => json([{ date: '2026-11-16', transaction_count: 1, operation_count: 2 }]),
    'status.test/api/v2/summary.json': () => (state.statusUp ? json(summary) : new Response('', { status: 500 })),
    'status.test/api/v2/incidents.json': () => json({ incidents: [] }),
  });
  return { upstream, state };
};

const start = async (overrides: Partial<ServerConfig> = {}) => {
  const { upstream, state } = makeUpstream();
  const { app, ctx } = await buildApp(
    testConfig({ allowedAccounts: [ACCOUNT, UNFUNDED], ...overrides }),
    { fetchImpl: upstream.impl, startFeeds: false, logger: false },
  );
  return { app, ctx, upstream, state };
};

describe('API server', async () => {
  const { app, ctx, upstream } = await start();
  after(() => app.close());

  it('caches Horizon fee stats across requests', async () => {
    const first = await app.inject('/api/v1/networks/mainnet/fee-stats');
    const second = await app.inject('/api/v1/networks/mainnet/fee-stats');
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().last_ledger, '100');
    assert.equal(first.headers['x-cache'], 'MISS');
    assert.equal(second.headers['x-cache'], 'HIT');
    assert.match(String(second.headers['cache-control']), /^public, max-age=[0-5]$/);
    assert.equal(upstream.count('fee_stats'), 1);
  });

  it('rejects unknown networks and bad query values', async () => {
    assert.equal((await app.inject('/api/v1/networks/devnet/fee-stats')).statusCode, 400);
    assert.equal((await app.inject('/api/v1/networks/mainnet/operations?limit=500')).statusCode, 400);
  });

  it('returns operations with a validated limit', async () => {
    const res = await app.inject('/api/v1/networks/mainnet/operations?limit=3');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().length, 3);
    assert.equal(res.json()[0].source_account, ACCOUNT, 'upstream fields pass through');
    assert.equal((await app.inject('/api/v1/networks/mainnet/operations')).json().length, 20);
  });

  it('returns the native balance, and 0 for unfunded accounts', async () => {
    const funded = await app.inject(`/api/v1/networks/testnet/accounts/${ACCOUNT}/balance`);
    assert.deepEqual(funded.json(), { accountId: ACCOUNT, balance: '123.4567890' });

    const unfunded = await app.inject(`/api/v1/networks/testnet/accounts/${UNFUNDED}/balance`);
    assert.deepEqual(unfunded.json(), { accountId: UNFUNDED, balance: '0' });
  });

  it('refuses malformed and non-allowlisted accounts without calling Horizon', async () => {
    const bad = await app.inject('/api/v1/networks/testnet/accounts/not-a-key/balance');
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().message, /public key/);

    const before = upstream.calls.length;
    const denied = await app.inject(`/api/v1/networks/testnet/accounts/${NOT_ALLOWED}/balance`);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error, 'Forbidden');
    assert.equal(upstream.calls.length, before);
  });

  it('proxies lumen supply, history and StatusPage', async () => {
    assert.equal((await app.inject('/api/v1/lumens')).json().totalSupply, '105443902087');
    assert.equal((await app.inject('/api/v1/history/daily')).json()[0].date, '2026-11-16');
    assert.equal((await app.inject('/api/v1/status/summary')).json().status.indicator, 'none');
    assert.deepEqual((await app.inject('/api/v1/status/incidents')).json(), { incidents: [] });
  });

  it('serves ledgers and stats from the live feed', async () => {
    const feed = ctx.feeds.get('mainnet')!;
    assert.equal((await app.inject('/api/v1/networks/mainnet/stats')).statusCode, 503);

    for (const ledger of ledgerPage(500, 10).reverse()) feed.ingest(ledger);
    const ledgers = (await app.inject('/api/v1/networks/mainnet/ledgers?limit=3')).json();
    assert.deepEqual(ledgers.map((l: { sequence: number }) => l.sequence), [500, 499, 498]);
    assert.equal(ledgers[0].fee_pool, '1', 'fields outside the documented schema are kept');

    const stats = (await app.inject('/api/v1/networks/mainnet/stats')).json();
    assert.equal(stats.lastLedgerSequence, 500);
    assert.equal(stats.status, 'operational');
    assert.ok(Math.abs(stats.avgLedgerCloseTime - 5) < 0.01);
  });

  it('compresses large responses when the client accepts it', async () => {
    const feed = ctx.feeds.get('mainnet')!;
    for (const ledger of ledgerPage(700, 100).reverse()) feed.ingest(ledger);
    const res = await app.inject({ url: '/api/v1/networks/mainnet/ledgers', headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.headers['content-encoding'], 'gzip');
  });

  it('reports liveness as 200 and readiness as 503 while feeds are down', async () => {
    const live = await app.inject('/api/health');
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().status, 'degraded'); // feeds were never started
    assert.deepEqual(live.json().feeds.map((f: { network: string }) => f.network), ['mainnet', 'testnet']);
    assert.equal((await app.inject('/api/health/ready')).statusCode, 503);
  });

  it('sets security headers', async () => {
    const res = await app.inject('/api/health');
    assert.match(String(res.headers['content-security-policy']), /default-src 'self'/);
    assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['strict-transport-security']);
  });

  it('publishes an OpenAPI document of the versioned API only', async () => {
    const doc = (await app.inject('/api/v1/openapi.json')).json();
    assert.equal(doc.info.title, 'Stellar Dashboard API');
    const paths = Object.keys(doc.paths);
    assert.ok(paths.includes('/api/v1/networks/{network}/fee-stats'));
    assert.ok(paths.includes('/api/v1/status/summary'));
    assert.ok(!paths.some(p => p.includes('health') || p.includes('metrics')));
  });

  it('exposes Prometheus metrics', async () => {
    const res = await app.inject('/metrics');
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /^text\/plain/);
    assert.match(res.body, /http_requests_total\{route="\/api\/v1\/networks\/:network\/fee-stats",method="GET",status="200"\} 2/);
    assert.match(res.body, /cache_requests_total\{resource="fee-stats",result="hit"\} 1/);
    assert.match(res.body, /upstream_requests_total\{host="horizon\.test",outcome="ok"\} \d+/);
    assert.match(res.body, /ledger_feed_connected\{network="mainnet"\} 0/);
    assert.match(res.body, /http_request_duration_seconds_bucket\{route="[^"]+",le="\+Inf"\} \d+/);
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await app.inject('/api/v1/nope');
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, 'Not Found');
  });
});

describe('upstream failures', async () => {
  const { app, state, upstream } = await start();
  after(() => app.close());

  it('returns 502 when an upstream fails and nothing is cached', async () => {
    state.statusUp = false;
    const res = await app.inject('/api/v1/status/summary');
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error, 'Bad Gateway');
  });

  it('treats an unexpected response shape as an upstream failure', async () => {
    state.feeStats = { error: 'maintenance' };
    const res = await app.inject('/api/v1/networks/mainnet/fee-stats');
    assert.equal(res.statusCode, 502);
    const metrics = (await app.inject('/metrics')).body;
    assert.match(metrics, /upstream_requests_total\{host="horizon\.test",outcome="invalid_response"\} 1/);
  });

  it('returns 503 for a network whose feed is disabled', async () => {
    const { app: mainnetOnly } = await buildApp(testConfig({ ledgerFeeds: ['mainnet'] }), {
      fetchImpl: upstream.impl, startFeeds: false, logger: false,
    });
    const res = await mainnetOnly.inject('/api/v1/networks/testnet/ledgers');
    assert.equal(res.statusCode, 503);
    assert.match(res.json().message, /disabled/);
    await mainnetOnly.close();
  });
});

describe('abuse limits', async () => {
  it('rate limits each client on the API but not on health checks', async () => {
    const { app } = await start({ rateLimitMax: 3 });
    for (let i = 0; i < 3; i++) {
      assert.equal((await app.inject('/api/v1/status/incidents')).statusCode, 200);
    }
    const limited = await app.inject('/api/v1/status/incidents');
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error, 'Too Many Requests');
    assert.ok(limited.headers['retry-after']);
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    await app.close();
  });

  it('requires the token for metrics when one is set', async () => {
    const { app } = await start({ metricsToken: 's3cret' });
    assert.equal((await app.inject('/metrics')).statusCode, 401);
    assert.equal((await app.inject({ url: '/metrics', headers: { authorization: 'Bearer wrong' } })).statusCode, 401);
    assert.equal((await app.inject({ url: '/metrics', headers: { authorization: 'Bearer s3cret' } })).statusCode, 200);
    await app.close();
  });

  it('does not serve metrics when disabled', async () => {
    const { app } = await start({ metricsEnabled: false });
    assert.equal((await app.inject('/metrics')).statusCode, 404);
    await app.close();
  });
});

describe('ledger event stream', async () => {
  const { app, ctx } = await start({ maxStreamsPerIp: 2 });
  let base = '';
  before(async () => {
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  });
  after(() => app.close());

  const url = () => `${base}/api/v1/networks/testnet/ledgers/stream`;

  it('sends a snapshot, then each new ledger', async () => {
    const feed = ctx.feeds.get('testnet')!;
    for (const ledger of ledgerPage(50, 3).reverse()) feed.ingest(ledger);

    const controller = new AbortController();
    const res = await fetch(url(), { signal: controller.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.ok(res.headers.get('content-security-policy'), 'security headers survive the raw response');

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
    assert.equal(ctx.streams.size, 0);
  });

  it('caps open streams per client address and frees the slot on disconnect', async () => {
    const controllers = [new AbortController(), new AbortController()];
    for (const c of controllers) {
      assert.equal((await fetch(url(), { signal: c.signal })).status, 200);
    }
    const refused = await fetch(url());
    assert.equal(refused.status, 429);
    assert.match(((await refused.json()) as { message: string }).message, /Too many open event streams/);

    controllers[0].abort();
    await waitFor(() => ctx.streams.size === 1);
    const again = new AbortController();
    assert.equal((await fetch(url(), { signal: again.signal })).status, 200);
    again.abort();
    controllers[1].abort();
    await waitFor(() => ctx.streams.size === 0);
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
    assert.match(String(index.headers['content-security-policy']), /script-src 'self'/);

    const asset = await app.inject('/assets/app-abc123.js');
    assert.match(String(asset.headers['cache-control']), /immutable/);
  });

  it('falls back to index.html for app paths but not for /api', async () => {
    assert.match((await app.inject('/some/page')).body, /id="root"/);
    assert.equal((await app.inject('/api/v1/missing')).statusCode, 404);
  });
});
