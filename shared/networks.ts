// Network constants shared by the browser app and the API server.
// Keep this file free of browser- or Vite-only APIs (e.g. import.meta.env).

export type NetworkType = 'mainnet' | 'testnet';

export const NETWORKS: readonly NetworkType[] = ['mainnet', 'testnet'];

export const isNetwork = (value: unknown): value is NetworkType =>
  value === 'mainnet' || value === 'testnet';

export const HORIZON_URLS: Record<NetworkType, string> = {
  mainnet: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

// Ledgers kept for the average close time and throughput figures
export const LEDGERS_IN_AVERAGE = 200;
// Ledgers drawn in the per-ledger charts
export const LEDGERS_FOR_CHARTS = 100;

// Stellar ed25519 public key (G... strkey). Checksum is not verified here;
// Horizon rejects a bad checksum, and this keeps junk out of upstream URLs.
export const isAccountId = (value: string): boolean => /^G[A-Z2-7]{55}$/.test(value);
