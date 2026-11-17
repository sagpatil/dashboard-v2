import { fileURLToPath } from 'node:url';
import { HORIZON_URLS, NETWORKS, isNetwork } from '../../shared/networks.ts';
import type { NetworkType } from '../../shared/networks.ts';

export interface ServerConfig {
  host: string;
  port: number;
  logLevel: string;
  horizonUrls: Record<NetworkType, string>;
  dashboardApiUrl: string;
  statusPageApiUrl: string;
  // Networks whose ledger feed the server keeps open
  ledgerFeeds: NetworkType[];
  upstreamTimeoutMs: number;
  // Built frontend to serve; null to run as an API-only server
  staticDir: string | null;
  // Origins allowed to call the API cross-origin; empty means same-origin only
  corsOrigins: string[];
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

const list = (value: string | undefined) =>
  (value ?? '').split(',').map(s => s.trim()).filter(Boolean);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const feeds = env.LEDGER_FEEDS === undefined ? [...NETWORKS] : list(env.LEDGER_FEEDS);
  const invalid = feeds.filter(n => !isNetwork(n));
  if (invalid.length) {
    throw new Error(`LEDGER_FEEDS has unknown networks: ${invalid.join(', ')}`);
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8787),
    logLevel: env.LOG_LEVEL ?? 'info',
    horizonUrls: {
      mainnet: trimSlash(env.HORIZON_MAINNET_URL ?? HORIZON_URLS.mainnet),
      testnet: trimSlash(env.HORIZON_TESTNET_URL ?? HORIZON_URLS.testnet),
    },
    dashboardApiUrl: trimSlash(env.DASHBOARD_API_URL ?? 'https://dashboard.stellar.org'),
    statusPageApiUrl: trimSlash(env.STATUSPAGE_API_URL ?? 'https://9sl3dhr1twv1.statuspage.io'),
    ledgerFeeds: feeds as NetworkType[],
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? 10_000),
    staticDir: env.STATIC_DIR === ''
      ? null
      : env.STATIC_DIR ?? fileURLToPath(new URL('../../dist', import.meta.url)),
    corsOrigins: list(env.CORS_ORIGINS),
  };
};
