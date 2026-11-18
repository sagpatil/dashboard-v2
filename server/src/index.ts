import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import type { ServerConfig } from './config.ts';

let config: ServerConfig;
try {
  config = loadConfig();
} catch (error) {
  // No logger yet: say plainly what to fix and stop
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}

const { app } = await buildApp(config);

let shuttingDown = false;
const shutdown = async (reason: string, exitCode: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ reason }, 'shutting down');
  // Never let a stuck connection keep the process alive
  setTimeout(() => {
    app.log.error('shutdown timed out; exiting');
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();
  try {
    await app.close();
    process.exit(exitCode);
  } catch (error) {
    app.log.error(error, 'error during shutdown');
    process.exit(1);
  }
};

process.once('SIGINT', () => void shutdown('SIGINT', 0));
process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
// The process state is unknown after these: log, stop cleanly, let the supervisor restart
process.on('uncaughtException', error => {
  app.log.fatal(error, 'uncaught exception');
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', reason => {
  app.log.fatal({ err: reason }, 'unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal(error, 'failed to start');
  process.exit(1);
}
