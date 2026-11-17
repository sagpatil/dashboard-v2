import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { openEventStreamCount } from '../sse.ts';

// A feed is healthy if it is connected and its newest ledger is recent
const MAX_LEDGER_AGE_S = 60;

export const healthRoutes = (ctx: AppContext) => async (app: FastifyInstance) => {
  // Always 200 while the process is up, so a Horizon outage does not get the
  // server restarted; `status` says whether the live data is current.
  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const now = Date.now();
    const feeds = [...ctx.feeds.values()].map(feed => {
      const status = feed.status();
      const ageS = status.latestClosedAt ? (now - Date.parse(status.latestClosedAt)) / 1000 : null;
      return {
        ...status,
        latestLedgerAgeSeconds: ageS === null ? null : Math.round(ageS),
        healthy: status.connected && ageS !== null && ageS < MAX_LEDGER_AGE_S,
      };
    });

    return {
      status: feeds.every(f => f.healthy) ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((now - ctx.startedAt) / 1000),
      cacheEntries: ctx.cache.size,
      eventStreamClients: openEventStreamCount(),
      feeds,
    };
  });
};
