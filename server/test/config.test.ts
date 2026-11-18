import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.ts';
import { FRIENDBOT_ACCOUNT } from '../../shared/networks.ts';

describe('loadConfig', () => {
  it('has safe defaults', () => {
    const config = loadConfig({});
    assert.equal(config.port, 8787);
    assert.equal(config.trustProxy, false);
    assert.deepEqual(config.ledgerFeeds, ['mainnet', 'testnet']);
    assert.deepEqual(config.allowedAccounts, [FRIENDBOT_ACCOUNT]);
    assert.deepEqual(config.corsOrigins, []);
    assert.equal(config.horizonUrls.mainnet, 'https://horizon.stellar.org');
    assert.match(config.staticDir ?? '', /dist$/);
  });

  it('reads and normalizes values', () => {
    const config = loadConfig({
      PORT: '9000', HORIZON_MAINNET_URL: 'http://horizon.internal:8000/', STATIC_DIR: '',
      CORS_ORIGINS: 'https://a.example, https://b.example', LEDGER_FEEDS: 'mainnet',
      ALLOWED_ACCOUNTS: '', METRICS_ENABLED: 'false', METRICS_TOKEN: 'abc',
    });
    assert.equal(config.port, 9000);
    assert.equal(config.horizonUrls.mainnet, 'http://horizon.internal:8000');
    assert.equal(config.staticDir, null);
    assert.deepEqual(config.corsOrigins, ['https://a.example', 'https://b.example']);
    assert.deepEqual(config.ledgerFeeds, ['mainnet']);
    assert.deepEqual(config.allowedAccounts, []);
    assert.equal(config.metricsEnabled, false);
    assert.equal(config.metricsToken, 'abc');
  });

  it('accepts the documented TRUST_PROXY forms', () => {
    assert.equal(loadConfig({ TRUST_PROXY: 'true' }).trustProxy, true);
    assert.equal(loadConfig({ TRUST_PROXY: '2' }).trustProxy, 2);
    assert.equal(loadConfig({ TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy, '10.0.0.0/8, 127.0.0.1');
  });

  it('reports every problem at once', () => {
    assert.throws(
      () => loadConfig({
        PORT: 'abc', HORIZON_TESTNET_URL: 'not a url', LEDGER_FEEDS: 'mainnet,devnet', CORS_ORIGINS: 'example.com',
        ALLOWED_ACCOUNTS: 'nope', LOG_LEVEL: 'loud', TRUST_PROXY: 'maybe', RATE_LIMIT_MAX: '0', METRICS_ENABLED: 'si',
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.equal(error.problems.length, 9);
        assert.match(error.message, /PORT must be a whole number from 0 to 65535 \(got "abc"\)/);
        assert.match(error.message, /unknown network "devnet"/);
        return true;
      },
    );
  });
});
