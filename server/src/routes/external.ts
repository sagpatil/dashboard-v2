import type { FastifyInstance } from 'fastify';
import type {
  LedgerStat,
  LumenSupplyV2,
  StatusPageIncidents,
  StatusPageSummary,
} from '../../../shared/types.ts';
import { cached, getJson } from '../context.ts';
import type { AppContext } from '../context.ts';
import { commonErrors, passthrough, passthroughList } from '../schemas.ts';
import { isDailyHistory, isIncidentHistory, isLumenSupply, isStatusSummary } from '../validate.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Data the dashboard takes from services other than Horizon. Proxying them
// avoids browser CORS problems and turns N visitors into one upstream call.
export const externalRoutes = (ctx: AppContext) => async (app: FastifyInstance) => {
  const { dashboardApiUrl, statusPageApiUrl } = ctx.config;

  app.get('/lumens', {
    schema: {
      tags: ['Supply'],
      summary: 'Lumen supply breakdown',
      response: { 200: passthrough('Supply figures from dashboard.stellar.org'), ...commonErrors },
    },
  }, async (_req, reply) =>
    cached(ctx, reply, 'lumens', 'all', { ttlMs: 5 * MINUTE, staleIfErrorMs: 24 * HOUR }, () =>
      getJson<LumenSupplyV2>(ctx, `${dashboardApiUrl}/api/v2/lumens`, isLumenSupply)));

  app.get('/history/daily', {
    schema: {
      tags: ['History'],
      summary: 'Daily transaction and operation counts (mainnet)',
      response: { 200: passthroughList('One entry per day, oldest first'), ...commonErrors },
    },
  }, async (_req, reply) =>
    cached(ctx, reply, 'history', 'daily', { ttlMs: HOUR, staleIfErrorMs: 24 * HOUR }, () =>
      getJson<LedgerStat[]>(ctx, `${dashboardApiUrl}/api/ledgers/public`, isDailyHistory)));

  app.get('/status/summary', {
    schema: {
      tags: ['Status'],
      summary: 'StatusPage summary',
      description: 'Overall status, active incidents and scheduled maintenances.',
      response: { 200: passthrough('StatusPage `summary.json`'), ...commonErrors },
    },
  }, async (_req, reply) =>
    cached(ctx, reply, 'status', 'summary', { ttlMs: MINUTE, staleIfErrorMs: HOUR }, () =>
      getJson<StatusPageSummary>(ctx, `${statusPageApiUrl}/api/v2/summary.json`, isStatusSummary)));

  app.get('/status/incidents', {
    schema: {
      tags: ['Status'],
      summary: 'StatusPage incident history',
      response: { 200: passthrough('StatusPage `incidents.json`'), ...commonErrors },
    },
  }, async (_req, reply) =>
    cached(ctx, reply, 'status', 'incidents', { ttlMs: 5 * MINUTE, staleIfErrorMs: 6 * HOUR }, () =>
      getJson<StatusPageIncidents>(ctx, `${statusPageApiUrl}/api/v2/incidents.json`, isIncidentHistory)));
};
