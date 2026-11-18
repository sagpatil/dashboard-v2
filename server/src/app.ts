import { existsSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import type { NetworkType } from '../../shared/networks.ts';
import { TtlCache } from './cache.ts';
import type { ServerConfig } from './config.ts';
import { upstreamRecorder } from './context.ts';
import type { AppContext } from './context.ts';
import { LedgerFeed } from './ledgerFeed.ts';
import { Metrics } from './metrics.ts';
import { EventStreamHub } from './sse.ts';
import { UpstreamError } from './upstream.ts';
import type { FetchFn } from './upstream.ts';
import { healthRoutes } from './routes/health.ts';
import { networkRoutes } from './routes/network.ts';
import { externalRoutes } from './routes/external.ts';

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions {
  fetchImpl?: FetchFn;
  // Connect ledger feeds when the server starts (off in tests)
  startFeeds?: boolean;
  logger?: FastifyServerOptions['logger'];
}

export const buildApp = async (config: ServerConfig, options: BuildAppOptions = {}) => {
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    // A hop count means "trust that many proxies in front of the server"
    trustProxy: typeof config.trustProxy === 'number'
      ? (_address: string, hop: number) => hop < (config.trustProxy as number)
      : config.trustProxy,
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  const metrics = new Metrics();
  const streams = new EventStreamHub(
    { maxClients: config.maxStreamClients, maxPerIp: config.maxStreamsPerIp },
    reason => metrics.streamsRejected.inc({ reason }),
  );

  const feeds = new Map<NetworkType, LedgerFeed>();
  for (const network of config.ledgerFeeds) {
    feeds.set(network, new LedgerFeed({
      network,
      horizonUrl: config.horizonUrls[network],
      logger: app.log.child({ component: 'ledger-feed' }),
      fetchImpl,
      timeoutMs: config.upstreamTimeoutMs,
      onUpstreamResult: upstreamRecorder(metrics),
    }));
  }

  const ctx: AppContext = {
    config,
    cache: new TtlCache(),
    feeds,
    streams,
    metrics,
    fetchImpl,
    startedAt: Date.now(),
  };

  const feedGauge = (pick: (feed: LedgerFeed) => number) => () =>
    [...feeds.values()].map(feed => ({ labels: { network: feed.network }, value: pick(feed) }));
  metrics.gauge('event_stream_clients', 'Open ledger event streams', () => [{ value: streams.size }]);
  metrics.gauge('cache_entries', 'Entries in the response cache', () => [{ value: ctx.cache.size }]);
  metrics.gauge('ledger_feed_connected', '1 if the Horizon ledger stream is connected',
    feedGauge(feed => (feed.status().connected ? 1 : 0)));
  metrics.gauge('ledger_feed_latest_sequence', 'Sequence of the newest ledger received',
    feedGauge(feed => feed.status().latestSequence ?? 0));
  metrics.gauge('ledger_feed_reconnects', 'Times the Horizon ledger stream was reconnected',
    feedGauge(feed => feed.status().reconnects));
  metrics.gauge('ledger_feed_subscribers', 'Event streams subscribed to the feed',
    feedGauge(feed => feed.status().subscribers));

  if (options.startFeeds ?? true) {
    app.addHook('onReady', async () => {
      for (const feed of feeds.values()) feed.start();
    });
  }
  // Long-lived event streams would otherwise hold the server open on shutdown
  app.addHook('preClose', async () => streams.closeAll());
  app.addHook('onClose', async () => {
    await Promise.all([...feeds.values()].map(feed => feed.stop()));
  });

  app.addHook('onResponse', async (req, reply) => {
    // Label by route pattern, not URL, to keep the number of series bounded
    const route = req.routeOptions.url ?? 'unmatched';
    metrics.httpRequests.inc({ route, method: req.method, status: reply.statusCode });
    // An event stream's "duration" is how long the client stayed connected
    if (!route.endsWith('/stream')) {
      metrics.httpDuration.observe({ route }, reply.elapsedTime / 1000);
    }
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // The app loads its fonts from Google Fonts; React and the charts set style attributes
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // API responses must stay readable by the origins CORS allows
    crossOriginResourcePolicy: { policy: config.corsOrigins.length ? 'cross-origin' : 'same-origin' },
  });

  // Event streams are written to the raw response, so they are not compressed
  await app.register(fastifyCompress, { threshold: 1024 });

  if (config.corsOrigins.length) {
    await app.register(fastifyCors, { origin: config.corsOrigins, methods: ['GET'] });
  }

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Stellar Dashboard API',
        description: 'Cached, aggregated network data for the Stellar dashboard.',
        version: '1.0.0',
      },
      tags: [
        { name: 'Network', description: 'Per-network data from Horizon' },
        { name: 'Supply', description: 'Lumen supply' },
        { name: 'History', description: 'Historical activity' },
        { name: 'Status', description: 'Incidents and maintenance from StatusPage' },
      ],
    },
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof UpstreamError) {
      req.log.warn({ url: error.url, status: error.status }, error.message);
      return reply.code(502).send({ error: 'Bad Gateway', message: 'Upstream service unavailable' });
    }
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    // Only hide details of unexpected failures
    const expose = err.statusCode !== undefined;
    if (!expose) req.log.error(err);
    return reply.code(status).send({
      error: STATUS_CODES[status] ?? 'Error',
      message: expose ? err.message : 'Something went wrong',
    });
  });

  await app.register(healthRoutes(ctx));

  await app.register(async api => {
    await api.register(fastifyRateLimit, {
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindowMs,
    });
    api.get('/openapi.json', { schema: { hide: true } }, async (_req, reply) => {
      reply.header('Cache-Control', 'public, max-age=300');
      return app.swagger();
    });
    await api.register(networkRoutes(ctx));
    await api.register(externalRoutes(ctx));
  }, { prefix: API_PREFIX });

  const staticDir = config.staticDir;
  const serveFrontend = staticDir !== null && existsSync(join(staticDir, 'index.html'));
  if (serveFrontend) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      // Headers are set below; the plugin's own would override them
      cacheControl: false,
      setHeaders(res, path) {
        // Vite fingerprints everything under assets/
        const immutable = /[\\/]assets[\\/]/.test(path);
        res.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  } else if (staticDir !== null) {
    app.log.warn({ staticDir }, 'no built frontend found; serving the API only (run `npm run build`)');
  }

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url === '/metrics';
    if (serveFrontend && req.method === 'GET' && !isApi) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found', message: `No route for ${req.method} ${req.url}` });
  });

  return { app, ctx };
};
