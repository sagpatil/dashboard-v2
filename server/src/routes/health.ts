import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { httpError } from '../context.ts';
import type { AppContext } from '../context.ts';

// A feed is healthy if it is connected and its newest ledger is recent
const MAX_LEDGER_AGE_S = 60;

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Operational endpoints: not versioned, not rate limited, not in the API docs
export const healthRoutes = (ctx: AppContext) => async (app: FastifyInstance) => {
  const report = () => {
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
      eventStreamClients: ctx.streams.size,
      feeds,
    };
  };

  // Liveness: 200 while the process is up, so a Horizon outage does not get
  // the server restarted; `status` says whether the live data is current.
  app.get('/api/health', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return report();
  });

  // Readiness: 503 until every ledger feed is connected and current
  app.get('/api/health/ready', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const body = report();
    return reply.code(body.status === 'ok' ? 200 : 503).send(body);
  });

  if (ctx.config.metricsEnabled) {
    app.get('/metrics', { schema: { hide: true } }, async (req, reply) => {
      const token = ctx.config.metricsToken;
      if (token) {
        const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
        if (!sameToken(given, token)) {
          reply.header('WWW-Authenticate', 'Bearer');
          throw httpError(401, 'A valid metrics token is required');
        }
      }
      reply.header('Cache-Control', 'no-store');
      return reply.type('text/plain; version=0.0.4; charset=utf-8').send(ctx.metrics.render());
    });
  }
};
