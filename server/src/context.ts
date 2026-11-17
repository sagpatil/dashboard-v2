import type { FastifyReply } from 'fastify';
import type { NetworkType } from '../../shared/networks.ts';
import type { TtlCache, CacheOptions } from './cache.ts';
import type { ServerConfig } from './config.ts';
import type { LedgerFeed } from './ledgerFeed.ts';
import { fetchJson } from './upstream.ts';
import type { FetchFn } from './upstream.ts';

// Everything route handlers need, created once per app instance
export interface AppContext {
  config: ServerConfig;
  cache: TtlCache;
  feeds: Map<NetworkType, LedgerFeed>;
  fetchImpl: FetchFn;
  startedAt: number;
}

// An error whose status code is sent to the client along with its message
export const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

export const getJson = <T>(ctx: AppContext, url: string) =>
  fetchJson<T>(ctx.fetchImpl, url, ctx.config.upstreamTimeoutMs);

// Serve `load()` through the shared cache and set response headers telling the
// browser how much longer the value stays fresh.
export const cached = async <T>(
  ctx: AppContext,
  reply: FastifyReply,
  key: string,
  options: CacheOptions,
  load: () => Promise<T>,
): Promise<T> => {
  const { value, status, ageMs } = await ctx.cache.get(key, options, load);
  const maxAge = Math.max(0, Math.floor((options.ttlMs - ageMs) / 1000));
  reply.header('X-Cache', status.toUpperCase());
  reply.header('Cache-Control', status === 'stale' ? 'no-store' : `public, max-age=${maxAge}`);
  return value;
};
