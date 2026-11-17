import type { FastifyInstance } from 'fastify';
import { NETWORKS, LEDGERS_IN_AVERAGE, isAccountId } from '../../../shared/networks.ts';
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
import { UpstreamError } from '../upstream.ts';
import { openEventStream } from '../sse.ts';

const networkParams = {
  type: 'object',
  required: ['network'],
  properties: { network: { type: 'string', enum: NETWORKS } },
} as const;

interface NetworkParams {
  network: NetworkType;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const networkRoutes = (ctx: AppContext) => async (app: FastifyInstance) => {
  const horizon = (network: NetworkType) => ctx.config.horizonUrls[network];

  const feedFor = (network: NetworkType) => {
    const feed = ctx.feeds.get(network);
    if (!feed) throw httpError(503, `Ledger feed for ${network} is disabled on this server`);
    return feed;
  };

  // Latest ledgers held by the server's live feed, newest first
  app.get<{ Params: NetworkParams; Querystring: { limit: number } }>(
    '/networks/:network/ledgers',
    {
      schema: {
        params: networkParams,
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: LEDGERS_IN_AVERAGE, default: LEDGERS_IN_AVERAGE },
          },
        },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-cache');
      return feedFor(req.params.network).snapshot(req.query.limit);
    },
  );

  // Server-sent events: one `snapshot` with the buffered ledgers, then a
  // `ledger` event per new ledger. Every browser shares the server's single
  // Horizon stream per network.
  app.get<{ Params: NetworkParams }>(
    '/networks/:network/ledgers/stream',
    { schema: { params: networkParams } },
    (req, reply) => {
      const { network } = req.params;
      const feed = feedFor(network);
      const stream = openEventStream(req, reply);
      const snapshot: LedgerStreamSnapshot = { network, ledgers: feed.snapshot() };
      stream.send('snapshot', snapshot);
      const unsubscribe = feed.subscribe(ledger => stream.send('ledger', ledger));
      stream.onClose(unsubscribe);
    },
  );

  // Network health and throughput derived from the live feed
  app.get<{ Params: NetworkParams }>(
    '/networks/:network/stats',
    { schema: { params: networkParams } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-cache');
      const stats = computeLedgerStats(feedFor(req.params.network).snapshot(), Date.now());
      if (!stats) throw httpError(503, 'No ledgers received yet');
      return stats;
    },
  );

  app.get<{ Params: NetworkParams }>(
    '/networks/:network/fee-stats',
    { schema: { params: networkParams } },
    async (req, reply) => {
      const { network } = req.params;
      return cached(ctx, reply, `fee-stats:${network}`, { ttlMs: 5 * SECOND, staleIfErrorMs: MINUTE }, () =>
        getJson<FeeStats>(ctx, `${horizon(network)}/fee_stats`));
    },
  );

  app.get<{ Params: NetworkParams; Querystring: { limit: number } }>(
    '/networks/:network/operations',
    {
      schema: {
        params: networkParams,
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } },
        },
      },
    },
    async (req, reply) => {
      const { network } = req.params;
      const { limit } = req.query;
      return cached(ctx, reply, `operations:${network}:${limit}`, { ttlMs: 5 * SECOND, staleIfErrorMs: MINUTE }, async () => {
        const page = await getJson<HorizonResponse<OperationRecord>>(
          ctx,
          `${horizon(network)}/operations?order=desc&limit=${limit}`,
        );
        return page._embedded.records;
      });
    },
  );

  app.get<{ Params: NetworkParams & { accountId: string } }>(
    '/networks/:network/accounts/:accountId/balance',
    {
      schema: {
        params: {
          ...networkParams,
          required: ['network', 'accountId'],
          properties: { ...networkParams.properties, accountId: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const { network, accountId } = req.params;
      if (!isAccountId(accountId)) {
        throw httpError(400, 'accountId must be a Stellar public key (G...)');
      }
      return cached(ctx, reply, `balance:${network}:${accountId}`, { ttlMs: MINUTE, staleIfErrorMs: 30 * MINUTE }, async () => {
        let account: { balances: Array<{ asset_type: string; balance: string }> };
        try {
          account = await getJson(ctx, `${horizon(network)}/accounts/${accountId}`);
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
