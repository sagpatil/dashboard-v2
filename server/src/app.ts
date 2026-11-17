import { existsSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { NetworkType } from '../../shared/networks.ts';
import { TtlCache } from './cache.ts';
import type { ServerConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { LedgerFeed } from './ledgerFeed.ts';
import { UpstreamError } from './upstream.ts';
import type { FetchFn } from './upstream.ts';
import { closeAllEventStreams } from './sse.ts';
import { healthRoutes } from './routes/health.ts';
import { networkRoutes } from './routes/network.ts';
import { externalRoutes } from './routes/external.ts';

export interface BuildAppOptions {
  fetchImpl?: FetchFn;
  // Connect ledger feeds when the server starts (off in tests)
  startFeeds?: boolean;
  logger?: FastifyServerOptions['logger'];
}

export const buildApp = async (config: ServerConfig, options: BuildAppOptions = {}) => {
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: true,
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  const feeds = new Map<NetworkType, LedgerFeed>();
  for (const network of config.ledgerFeeds) {
    feeds.set(network, new LedgerFeed({
      network,
      horizonUrl: config.horizonUrls[network],
      logger: app.log.child({ component: 'ledger-feed' }),
      fetchImpl,
      timeoutMs: config.upstreamTimeoutMs,
    }));
  }

  const ctx: AppContext = {
    config,
    cache: new TtlCache(),
    feeds,
    fetchImpl,
    startedAt: Date.now(),
  };

  if (options.startFeeds ?? true) {
    app.addHook('onReady', async () => {
      for (const feed of feeds.values()) feed.start();
    });
  }
  // Long-lived event streams would otherwise hold the server open on shutdown
  app.addHook('preClose', async () => closeAllEventStreams());
  app.addHook('onClose', async () => {
    await Promise.all([...feeds.values()].map(feed => feed.stop()));
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  if (config.corsOrigins.length) {
    await app.register(fastifyCors, { origin: config.corsOrigins, methods: ['GET'] });
  }

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof UpstreamError) {
      req.log.warn({ url: error.url, status: error.status }, error.message);
      return reply.code(502).send({ error: 'Bad Gateway', message: 'Upstream service unavailable' });
    }
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    // Only hide details of unexpected failures
    const expose = status < 500 || err.statusCode !== undefined;
    if (!expose) req.log.error(err);
    return reply.code(status).send({
      error: STATUS_CODES[status] ?? 'Error',
      message: expose ? err.message : 'Something went wrong',
    });
  });

  await app.register(async api => {
    await api.register(healthRoutes(ctx));
    await api.register(networkRoutes(ctx));
    await api.register(externalRoutes(ctx));
  }, { prefix: '/api' });

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
        res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  } else if (staticDir !== null) {
    app.log.warn({ staticDir }, 'no built frontend found; serving the API only (run `npm run build`)');
  }

  app.setNotFoundHandler((req, reply) => {
    if (serveFrontend && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found', message: `No route for ${req.method} ${req.url}` });
  });

  return { app, ctx };
};
