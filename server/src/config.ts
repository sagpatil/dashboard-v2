import { fileURLToPath } from 'node:url';
import { FRIENDBOT_ACCOUNT, HORIZON_URLS, NETWORKS, isAccountId, isNetwork } from '../../shared/networks.ts';
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
  // Which proxies' X-Forwarded-* headers to believe: false (none), true (any),
  // a hop count, or a comma-separated list of IPs / CIDR ranges
  trustProxy: boolean | number | string;
  // Requests each client IP may make per window
  rateLimitMax: number;
  rateLimitWindowMs: number;
  // Open ledger event streams allowed in total and per client IP
  maxStreamClients: number;
  maxStreamsPerIp: number;
  // Accounts whose balance may be looked up
  allowedAccounts: string[];
  // Serve Prometheus metrics at /metrics; if a token is set it must be sent as
  // a bearer token
  metricsEnabled: boolean;
  metricsToken: string | null;
  // How long shutdown may take before the process exits anyway
  shutdownTimeoutMs: number;
}

// Raised with every problem found, so one run shows all of them
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map(p => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const problems: string[] = [];
  // Treat empty values as unset, except where empty is meaningful (STATIC_DIR)
  const get = (name: string) => (env[name]?.trim() ? env[name]!.trim() : undefined);

  const list = (name: string) =>
    (get(name) ?? '').split(',').map(s => s.trim()).filter(Boolean);

  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
      return fallback;
    }
    return value;
  };

  const bool = (name: string, fallback: boolean) => {
    const raw = get(name)?.toLowerCase();
    if (raw === undefined) return fallback;
    if (['true', '1', 'yes', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'off'].includes(raw)) return false;
    problems.push(`${name} must be true or false (got "${raw}")`);
    return fallback;
  };

  const url = (name: string, fallback: string) => {
    const raw = get(name) ?? fallback;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    } catch {
      problems.push(`${name} must be an http(s) URL (got "${raw}")`);
    }
    return raw.replace(/\/+$/, '');
  };

  const origins = list('CORS_ORIGINS');
  for (const origin of origins) {
    let ok = false;
    try {
      ok = new URL(origin).origin === origin;
    } catch {
      // reported below
    }
    if (!ok) problems.push(`CORS_ORIGINS entries must be origins like https://example.com (got "${origin}")`);
  }

  const feeds = env.LEDGER_FEEDS === undefined ? [...NETWORKS] : list('LEDGER_FEEDS');
  for (const feed of feeds) {
    if (!isNetwork(feed)) problems.push(`LEDGER_FEEDS has an unknown network "${feed}" (use mainnet, testnet)`);
  }

  const allowedAccounts = env.ALLOWED_ACCOUNTS === undefined ? [FRIENDBOT_ACCOUNT] : list('ALLOWED_ACCOUNTS');
  for (const account of allowedAccounts) {
    if (!isAccountId(account)) problems.push(`ALLOWED_ACCOUNTS has an invalid account id "${account}"`);
  }

  const logLevel = get('LOG_LEVEL') ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${logLevel}")`);
  }

  let trustProxy: ServerConfig['trustProxy'] = false;
  const rawTrust = get('TRUST_PROXY');
  if (rawTrust !== undefined) {
    const lower = rawTrust.toLowerCase();
    if (lower === 'true' || lower === 'false') trustProxy = lower === 'true';
    else if (/^\d+$/.test(rawTrust)) trustProxy = Number(rawTrust);
    else if (/^[0-9a-fA-F.:/,\s]+$/.test(rawTrust)) trustProxy = rawTrust;
    else problems.push(`TRUST_PROXY must be true, false, a hop count, or IPs/CIDR ranges (got "${rawTrust}")`);
  }

  const config: ServerConfig = {
    host: get('HOST') ?? '0.0.0.0',
    port: int('PORT', 8787, 0, 65535),
    logLevel,
    horizonUrls: {
      mainnet: url('HORIZON_MAINNET_URL', HORIZON_URLS.mainnet),
      testnet: url('HORIZON_TESTNET_URL', HORIZON_URLS.testnet),
    },
    dashboardApiUrl: url('DASHBOARD_API_URL', 'https://dashboard.stellar.org'),
    statusPageApiUrl: url('STATUSPAGE_API_URL', 'https://9sl3dhr1twv1.statuspage.io'),
    ledgerFeeds: feeds as NetworkType[],
    upstreamTimeoutMs: int('UPSTREAM_TIMEOUT_MS', 10_000, 100, 120_000),
    staticDir: env.STATIC_DIR === ''
      ? null
      : get('STATIC_DIR') ?? fileURLToPath(new URL('../../dist', import.meta.url)),
    corsOrigins: origins,
    trustProxy,
    rateLimitMax: int('RATE_LIMIT_MAX', 600, 1, 1_000_000),
    rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000, 1000, 3_600_000),
    maxStreamClients: int('MAX_STREAM_CLIENTS', 2000, 1, 1_000_000),
    maxStreamsPerIp: int('MAX_STREAMS_PER_IP', 20, 1, 1_000_000),
    allowedAccounts,
    metricsEnabled: bool('METRICS_ENABLED', true),
    metricsToken: get('METRICS_TOKEN') ?? null,
    shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10_000, 0, 600_000),
  };

  if (problems.length) throw new ConfigError(problems);
  return config;
};
