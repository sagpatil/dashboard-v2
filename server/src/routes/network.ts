import type { FastifyInstance } from 'fastify';
import { LEDGERS_IN_AVERAGE, isAccountId } from '../../../shared/networks.ts';
import type { NetworkType } from '../../../shared/networks.ts';
import { computeLedgerStats } from '../../../shared/ledgerStats.ts';
import type {
  AccountBalance,
  FeeStats,
  HorizonResponse,
  LedgerStreamSnapshot,
  OperationRecord,
} from '../../../shared/types.ts';
import { cached, getJson, httpError } from '../context.ts';
import type { AppContext } from '../context.ts';
import { commonErrors, errorResponse, ledger, networkParams, passthrough, passthroughList } from '../schemas.ts';
import { UpstreamError } from '../upstream.ts';
import { isAccount, isFeeStats, isOperationsPage } from '../validate.ts';

interface NetworkParams {
  network: NetworkType;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const tags = ['Network'];

export const networkRoutes = (ctx: AppContext) => async (app: FastifyInstance) => {
  const horizon = (network: NetworkType) => ctx.config.horizonUrls[network];
  const allowedAccounts = new Set(ctx.config.allowedAccounts);

  const feedFor = (network: NetworkType) => {
    const feed = ctx.feeds.get(network);
    if (!feed) throw httpError(503, `Ledger feed for ${network} is disabled on this server`);
    return feed;
  };

  app.get<{ Params: NetworkParams; Querystring: { limit: number } }>(
    '/networks/:network/ledgers',
    {
      schema: {
        tags,
        summary: 'Latest ledgers',
        description: 'Latest ledgers held by the live feed, newest first.',
        params: networkParams,
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: LEDGERS_IN_AVERAGE, default: LEDGERS_IN_AVERAGE },
          },
        },
        response: { 200: { type: 'array', items: ledger }, ...commonErrors },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-cache');
      return feedFor(req.params.network).snapshot(req.query.limit);
    },
  );

  // Every browser shares the server's single Horizon stream per network
  app.get<{ Params: NetworkParams }>(
    '/networks/:network/ledgers/stream',
    {
      schema: {
        tags,
        summary: 'Live ledger stream',
        description:
          'Server-sent events. Sends one `snapshot` event (`{ network, ledgers }`, newest first), ' +
          'then a `ledger` event for each new ledger. Limited per client IP and in total.',
        params: networkParams,
        produces: ['text/event-stream'],
        response: { 200: { type: 'string', description: 'Event stream' }, ...commonErrors },
      },
    },
    (req, reply) => {
      const { network } = req.params;
      const feed = feedFor(network);

      const refusal = ctx.streams.refusal(req.ip);
      if (refusal) {
        ctx.metrics.streamsRejected.inc({ reason: refusal });
        reply.header('Retry-After', '30');
        throw refusal === 'server_full'
          ? httpError(503, 'Too many open event streams; try again shortly')
          : httpError(429, 'Too many open event streams from this address');
      }

      const stream = ctx.streams.open(req, reply);
      const snapshot: LedgerStreamSnapshot = { network, ledgers: feed.snapshot() };
      stream.send('snapshot', snapshot);
      const unsubscribe = feed.subscribe(record => stream.send('ledger', record));
      stream.onClose(unsubscribe);
    },
  );

  app.get<{ Params: NetworkParams }>(
    '/networks/:network/stats',
    {
      schema: {
        tags,
        summary: 'Network health and throughput',
        description: 'Derived from the live ledger feed.',
        params: networkParams,
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['operational', 'slow', 'very_slow', 'down'] },
              protocolVersion: { type: 'integer' },
              lastLedgerSequence: { type: 'integer' },
              lastLedgerCloseTime: { type: 'string', format: 'date-time' },
              avgLedgerCloseTime: { type: 'number', description: 'Seconds' },
              secondsSinceLastLedger: { type: 'number' },
              lastLedgerDuration: { type: 'number', nullable: true },
              txPerSecond: { type: 'number' },
              opsPerSecond: { type: 'number' },
              failedTxRate: { type: 'number', description: 'Fraction of transactions that failed, 0–1' },
              throughputWindow: { type: 'integer', description: 'Ledgers the throughput covers' },
              avgWindow: { type: 'integer', description: 'Ledgers the average close time covers' },
            },
          },
          ...commonErrors,
        },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-cache');
      const stats = computeLedgerStats(feedFor(req.params.network).snapshot(), Date.now());
      if (!stats) throw httpError(503, 'No ledgers received yet');
      return stats;
    },
  );

  app.get<{ Params: NetworkParams }>(
    '/networks/:network/fee-stats',
    {
      schema: {
        tags,
        summary: 'Fee statistics',
        params: networkParams,
        response: { 200: passthrough('Horizon `/fee_stats` response'), ...commonErrors },
      },
    },
    async (req, reply) => {
      const { network } = req.params;
      return cached(ctx, reply, 'fee-stats', network, { ttlMs: 5 * SECOND, staleIfErrorMs: MINUTE }, () =>
        getJson<FeeStats>(ctx, `${horizon(network)}/fee_stats`, isFeeStats));
    },
  );

  app.get<{ Params: NetworkParams; Querystring: { limit: number } }>(
    '/networks/:network/operations',
    {
      schema: {
        tags,
        summary: 'Latest operations',
        params: networkParams,
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } },
        },
        response: { 200: passthroughList('Horizon operation records, newest first'), ...commonErrors },
      },
    },
    async (req, reply) => {
      const { network } = req.params;
      const { limit } = req.query;
      return cached(ctx, reply, 'operations', `${network}:${limit}`, { ttlMs: 5 * SECOND, staleIfErrorMs: MINUTE }, async () => {
        const page = await getJson<HorizonResponse<OperationRecord>>(
          ctx,
          `${horizon(network)}/operations?order=desc&limit=${limit}`,
          isOperationsPage,
        );
        return page._embedded.records;
      });
    },
  );

  app.get<{ Params: NetworkParams & { accountId: string } }>(
    '/networks/:network/accounts/:accountId/balance',
    {
      schema: {
        tags,
        summary: 'XLM balance of an allowed account',
        description: 'Only accounts on the server\'s allowlist (ALLOWED_ACCOUNTS) can be looked up.',
        params: {
          ...networkParams,
          required: ['network', 'accountId'],
          properties: {
            ...networkParams.properties,
            accountId: { type: 'string', description: 'Stellar public key (G...)' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['accountId', 'balance'],
            properties: {
              accountId: { type: 'string' },
              balance: { type: 'string', description: 'XLM; "0" if the account is unfunded' },
            },
          },
          403: errorResponse,
          ...commonErrors,
        },
      },
    },
    async (req, reply) => {
      const { network, accountId } = req.params;
      if (!isAccountId(accountId)) {
        throw httpError(400, 'accountId must be a Stellar public key (G...)');
      }
      // Without this, anyone could make the server query Horizon for any account
      if (!allowedAccounts.has(accountId)) {
        throw httpError(403, 'This account is not on the server\'s allowlist');
      }
      return cached(ctx, reply, 'balance', `${network}:${accountId}`, { ttlMs: MINUTE, staleIfErrorMs: 30 * MINUTE }, async () => {
        let account: { balances: Array<{ asset_type: string; balance: string }> };
        try {
          account = await getJson(ctx, `${horizon(network)}/accounts/${accountId}`, isAccount);
        } catch (error) {
          // An unfunded account simply holds nothing
          if (error instanceof UpstreamError && error.status === 404) {
            return { accountId, balance: '0' } satisfies AccountBalance;
          }
          throw error;
        }
        const native = account.balances.find(b => b.asset_type === 'native');
        return { accountId, balance: native?.balance ?? '0' } satisfies AccountBalance;
      });
    },
  );
};
