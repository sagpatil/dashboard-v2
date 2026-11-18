import { FRIENDBOT_ACCOUNT } from '../../shared/networks.ts';
import type { LedgerRecord } from '../../shared/types.ts';
import type { ServerConfig } from '../src/config.ts';
import type { FetchFn } from '../src/upstream.ts';

export const testConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  horizonUrls: { mainnet: 'https://horizon.test', testnet: 'https://horizon-testnet.test' },
  dashboardApiUrl: 'https://dashboard.test',
  statusPageApiUrl: 'https://status.test',
  ledgerFeeds: ['mainnet', 'testnet'],
  upstreamTimeoutMs: 1000,
  staticDir: null,
  corsOrigins: [],
  trustProxy: false,
  rateLimitMax: 1000,
  rateLimitWindowMs: 60_000,
  maxStreamClients: 100,
  maxStreamsPerIp: 10,
  allowedAccounts: [FRIENDBOT_ACCOUNT],
  metricsEnabled: true,
  metricsToken: null,
  shutdownTimeoutMs: 1000,
  ...overrides,
});

export const makeLedger = (sequence: number, closedAt: Date = new Date()): LedgerRecord & { header_xdr: string } => ({
  id: `id-${sequence}`,
  paging_token: String(sequence * 4096),
  hash: `hash-${sequence}`,
  sequence,
  successful_transaction_count: 10,
  failed_transaction_count: 1,
  operation_count: 30,
  tx_set_operation_count: 31,
  closed_at: closedAt.toISOString(),
  total_coins: '105443902087.3472865',
  fee_pool: '1',
  base_fee_in_stroops: 100,
  base_reserve_in_stroops: 5000000,
  max_tx_set_size: 1000,
  protocol_version: 23,
  header_xdr: 'AAAA'.repeat(50),
});

// Ledgers `count` back from `latest`, newest first, 5s apart, ending now
export const ledgerPage = (latest: number, count: number) => {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => makeLedger(latest - i, new Date(now - i * 5000)));
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

// fetch stand-in that routes by "host/path" and records every call
export const fakeFetch = (routes: Record<string, Route>) => {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    const route = routes[`${url.host}${url.pathname}`];
    if (!route) return new Response('not found', { status: 404 });
    return route(url, init);
  }) as FetchFn;
  return { impl, calls, count: (fragment: string) => calls.filter(c => c.includes(fragment)).length };
};

// A Horizon-style SSE response whose events the test pushes by hand
export const controllableStream = (signal?: AbortSignal | null) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start: c => { controller = c; } });
  signal?.addEventListener('abort', () => {
    try { controller.error(signal.reason); } catch { /* already closed */ }
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
};

export const waitFor = async (check: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise(r => setTimeout(r, 5));
  }
};

export const silentLogger = { info() {}, warn() {}, debug() {} };
