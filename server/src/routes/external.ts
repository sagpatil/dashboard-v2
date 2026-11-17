import type { FastifyInstance } from 'fastify';
import type {
  LedgerStat,
  LumenSupplyV2,
  StatusPageIncidents,
  StatusPageSummary,
} from '../../../shared/types.ts';
import { cached, getJson } from '../context.ts';
import type { AppContext } from '../context.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Data the dashboard takes from services other than Horizon. Proxying them
// avoids browser CORS problems and turns N visitors into one upstream call.
export const externalRoutes = (ctx: AppContext) => async (app: FastifyInstance) => {
  const { dashboardApiUrl, statusPageApiUrl } = ctx.config;

  app.get('/lumens', async (_req, reply) =>
    cached(ctx, reply, 'lumens', { ttlMs: 5 * MINUTE, staleIfErrorMs: 24 * HOUR }, () =>
      getJson<LumenSupplyV2>(ctx, `${dashboardApiUrl}/api/v2/lumens`)));

  app.get('/history/daily', async (_req, reply) =>
    cached(ctx, reply, 'history:daily', { ttlMs: HOUR, staleIfErrorMs: 24 * HOUR }, () =>
      getJson<LedgerStat[]>(ctx, `${dashboardApiUrl}/api/ledgers/public`)));

  app.get('/status/summary', async (_req, reply) =>
    cached(ctx, reply, 'status:summary', { ttlMs: MINUTE, staleIfErrorMs: HOUR }, () =>
      getJson<StatusPageSummary>(ctx, `${statusPageApiUrl}/api/v2/summary.json`)));

  app.get('/status/incidents', async (_req, reply) =>
    cached(ctx, reply, 'status:incidents', { ttlMs: 5 * MINUTE, staleIfErrorMs: 6 * HOUR }, () =>
      getJson<StatusPageIncidents>(ctx, `${statusPageApiUrl}/api/v2/incidents.json`)));
};
