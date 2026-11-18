import type { FastifyReply } from 'fastify';
import type { NetworkType } from '../../shared/networks.ts';
import type { TtlCache, CacheOptions } from './cache.ts';
import type { ServerConfig } from './config.ts';
import type { LedgerFeed } from './ledgerFeed.ts';
import type { Metrics } from './metrics.ts';
import type { EventStreamHub } from './sse.ts';
import { fetchJson } from './upstream.ts';
import type { FetchFn } from './upstream.ts';

// Everything route handlers need, created once per app instance
export interface AppContext {
  config: ServerConfig;
  cache: TtlCache;
  feeds: Map<NetworkType, LedgerFeed>;
  streams: EventStreamHub;
  metrics: Metrics;
  fetchImpl: FetchFn;
  startedAt: number;
}

// An error whose status code is sent to the client along with its message
export const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

// Fetch JSON from an upstream, checking its shape and recording metrics
export const getJson = <T>(ctx: AppContext, url: string, validate: (body: unknown) => boolean) =>
  fetchJson<T>(ctx.fetchImpl, url, {
    timeoutMs: ctx.config.upstreamTimeoutMs,
    validate,
    onResult: upstreamRecorder(ctx.metrics),
  });

export const upstreamRecorder = (metrics: Metrics) => (host: string, outcome: string, seconds: number) => {
  metrics.upstreamRequests.inc({ host, outcome });
  metrics.upstreamDuration.observe({ host }, seconds);
};

// Serve `load()` through the shared cache and set response headers telling the
// browser how much longer the value stays fresh. `resource` names the kind of
// data for metrics; `key` identifies the exact entry.
export const cached = async <T>(
  ctx: AppContext,
  reply: FastifyReply,
  resource: string,
  key: string,
  options: CacheOptions,
  load: () => Promise<T>,
): Promise<T> => {
  const { value, status, ageMs } = await ctx.cache.get(`${resource}:${key}`, options, load);
  ctx.metrics.cacheRequests.inc({ resource, result: status });
  const maxAge = Math.max(0, Math.floor((options.ttlMs - ageMs) / 1000));
  reply.header('X-Cache', status.toUpperCase());
  reply.header('Cache-Control', status === 'stale' ? 'no-store' : `public, max-age=${maxAge}`);
  return value;
};
