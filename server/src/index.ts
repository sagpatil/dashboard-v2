import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const { app } = await buildApp(config);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, 'error during shutdown');
    process.exit(1);
  }
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
