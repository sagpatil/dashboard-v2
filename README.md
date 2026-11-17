# Stellar Dashboard v2

A modern replacement for [dashboard.stellar.org](https://dashboard.stellar.org) ([stellar/dashboard](https://github.com/stellar/dashboard)): a React + TypeScript frontend backed by a small Node.js API server.

The server owns every connection to the outside world: it keeps one Horizon ledger stream per network, fetches and caches data from Horizon, dashboard.stellar.org and Stellar's StatusPage, and fans the results out to browsers. However many people have the dashboard open, upstream traffic stays the same, and the browser no longer needs the Stellar SDK or cross-origin access to third-party APIs.

## Features

- **Live network status** — real-time ledger streaming via Horizon SSE, with health classification (operational / slow / very slow / down) derived from ledger close latency
- **Fee stats** — full percentile breakdown (p10–p99) of fees charged, plus ledger capacity percentage
- **Ledger close time chart** — color-coded bar chart (green/yellow/red) of per-ledger close times for the last 100 ledgers
- **Transaction & operation charts** — per-ledger successful transactions, operations, and failed transactions
- **30-day historical chart** — daily transaction and operation counts (mainnet only)
- **Lumen supply breakdown** — total, non-circulating, and circulating supply with percentage calculations (mainnet only)
- **Recent operations stream** — live table of the latest operations with known-account labeling (exchanges, SDF accounts) and human-readable operation details
- **Incidents & status** — active incidents and scheduled maintenances pulled from Stellar's StatusPage
- **Mainnet / Testnet toggle** — switch between networks with a single click
- **Testnet Friendbot balance** — shows the current XLM balance of the Friendbot faucet account (testnet only)
- **Dark theme** — matches the Stellar Design System dark palette

## Architecture

```
Browser (React)                API server (Fastify, server/)            Upstream
───────────────                ─────────────────────────────            ────────
EventSource  ─── /api/networks/:n/ledgers/stream ──┐
                                                   ├── LedgerFeed ─ SSE ─── Horizon /ledgers
React Query  ─── /api/networks/:n/stats ───────────┘   (1 per network, last 200 ledgers in memory)
             ─── /api/networks/:n/fee-stats ───────┐
             ─── /api/networks/:n/operations ──────┤
             ─── /api/networks/:n/accounts/… ──────┼── TTL cache ─────────── Horizon
             ─── /api/lumens, /api/history/daily ──┤   (coalesced,          dashboard.stellar.org
             ─── /api/status/… ────────────────────┘    stale-if-error)     StatusPage
```

- **Ledger feeds** — one Horizon SSE connection per network for the whole server. Reconnects from the last seen ledger with exponential backoff, refetches the latest page after a long gap, and restarts the stream if Horizon goes quiet for 60s. Records are trimmed (no header XDR or links) before they reach browsers.
- **Cache** — each upstream response is cached for a fixed TTL. Concurrent requests for an expired key share one upstream call, and if the upstream fails the last good value is served for a while (`X-Cache: STALE`) instead of an error. `Cache-Control` tells browsers how long the value stays fresh.
- **Static hosting** — in production the same server serves the built app from `dist/`, so the app and API share an origin and there's nothing to configure for CORS.
- **Shared code** — `shared/` holds the types, network constants and ledger statistics used by both the browser and the server.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.9 (strict), Vite 7 |
| Data fetching | TanStack React Query 5 (polling) + EventSource (server-sent events) |
| Charts | Recharts 3 |
| Styling | Stellar Design System tokens + custom CSS (no CSS-in-JS) |
| API server | Node.js 22.18+ running TypeScript directly (type stripping), Fastify 5 |
| Tests | Node's built-in test runner |

## Getting Started

### Prerequisites

- Node.js **22.18+** (the server runs its `.ts` files directly) and npm

### Install & Run

```bash
npm install
```

```bash
npm run dev
```

This starts the API server on `http://localhost:8787` (restarting on changes) and the Vite dev server on `http://localhost:5173`, which proxies `/api` to the API server. Open `http://localhost:5173`. Use `npm run dev:server` or `npm run dev:web` to run either one alone.

### Build & Run in Production

```bash
npm run build
```

```bash
npm start
```

`npm run build` type-checks the frontend and server and builds the app into `dist/`. `npm start` runs the API server, which serves `dist/` and the API on port 8787.

### Test, Lint, Type-check

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run typecheck
```

The server tests use fake upstreams, so they need no network access.

## Configuration

All settings are optional environment variables. The server and Vite both read `.env.local` (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Where the API server listens |
| `LOG_LEVEL` | `info` | Pino log level (`silent` … `trace`) |
| `HORIZON_MAINNET_URL` | `https://horizon.stellar.org` | Mainnet Horizon (e.g. your own node, to avoid public rate limits) |
| `HORIZON_TESTNET_URL` | `https://horizon-testnet.stellar.org` | Testnet Horizon |
| `DASHBOARD_API_URL` | `https://dashboard.stellar.org` | Source of lumen supply and daily history |
| `STATUSPAGE_API_URL` | `https://9sl3dhr1twv1.statuspage.io` | Stellar StatusPage |
| `LEDGER_FEEDS` | `mainnet,testnet` | Networks to keep a live ledger stream for |
| `UPSTREAM_TIMEOUT_MS` | `10000` | Timeout for upstream requests |
| `STATIC_DIR` | `./dist` | Built app to serve; set to an empty string for API only |
| `CORS_ORIGINS` | *(none)* | Comma-separated origins allowed to call the API cross-origin |
| `VITE_API_BASE_URL` | *(same origin)* | **Build-time**: API origin, when the app is hosted separately |

## API

All endpoints are `GET`. `:network` is `mainnet` or `testnet`.

| Endpoint | Description | Cache TTL |
|---|---|---|
| `/api/health` | Uptime, cache size, connected stream clients, per-network feed status | none |
| `/api/networks/:network/ledgers?limit=` | Latest ledgers held by the live feed, newest first (max 200) | live |
| `/api/networks/:network/ledgers/stream` | Server-sent events: one `snapshot` (`{ network, ledgers }`), then a `ledger` event per new ledger | live |
| `/api/networks/:network/stats` | Status, last ledger, avg close time, tx/ops per second, failure rate | live |
| `/api/networks/:network/fee-stats` | Horizon `/fee_stats` | 5s |
| `/api/networks/:network/operations?limit=` | Latest operations (1–200, default 20) | 5s |
| `/api/networks/:network/accounts/:accountId/balance` | `{ accountId, balance }`, XLM balance (`0` if unfunded) | 60s |
| `/api/lumens` | Lumen supply breakdown | 5 min |
| `/api/history/daily` | Daily transaction and operation counts | 1 hr |
| `/api/status/summary` | StatusPage summary | 60s |
| `/api/status/incidents` | StatusPage incident history | 5 min |

Errors are JSON (`{ "error", "message" }`): `400` for invalid input, `502` when an upstream fails with nothing cached, `503` when a network's feed is disabled or has no ledgers yet. `/api/health` always returns `200` while the process is up; its `status` field is `degraded` if a feed is disconnected or more than 60s behind.

## Project Structure

```
server/
├── src/
│   ├── index.ts              # Entry point: config, listen, graceful shutdown
│   ├── app.ts                # Fastify app factory: hooks, errors, static hosting
│   ├── config.ts             # Environment variables → ServerConfig
│   ├── ledgerFeed.ts         # One Horizon ledger stream per network + buffer + fan-out
│   ├── cache.ts              # TTL cache with request coalescing and stale-if-error
│   ├── upstream.ts           # fetch JSON with timeout → UpstreamError
│   ├── sse.ts                # Server-sent events responses
│   ├── context.ts            # Shared per-app state and the cached() helper
│   └── routes/               # health, network (Horizon), external (lumens, history, status)
└── test/                     # node:test suites with fake upstreams
shared/
├── types.ts                  # API response types used by app and server
├── networks.ts               # Network names, Horizon URLs, window sizes
└── ledgerStats.ts            # Network status / throughput from a list of ledgers
src/
├── main.tsx                  # Entry point, QueryClient setup
├── App.tsx                   # Root component, network toggle, section layout
├── index.css                 # All styles (dark theme, 12-col grid, responsive)
├── components/               # KPI strip, charts, fee stats, supply, operations, incidents…
├── hooks/
│   └── useHorizon.ts         # Data hooks (EventSource stream + React Query polls of /api)
├── lib/
│   ├── api.ts                # API base URL and JSON fetch helper
│   ├── constants.ts          # Horizon links, known accounts, SDF accounts
│   └── format.ts             # Number/XLM/date/account formatting utilities
└── types/index.ts            # Re-exports shared/types.ts
```

## Data Sources

| Data | Upstream | How the server gets it |
|---|---|---|
| Ledgers (live) | Horizon `/ledgers` | One SSE stream per network |
| Operations | Horizon `/operations` | On request, cached 5s |
| Fee stats | Horizon `/fee_stats` | On request, cached 5s |
| Account balances | Horizon `/accounts/{id}` | On request, cached 60s |
| Lumen supply | `dashboard.stellar.org/api/v2/lumens` | On request, cached 5 min |
| Historical ledgers | `dashboard.stellar.org/api/ledgers/public` | On request, cached 1 hr |
| Incidents/status | StatusPage `summary.json`, `incidents.json` | On request, cached 1–5 min |

## How It Differs from the Original

The [original dashboard](https://github.com/stellar/dashboard) runs a Node.js backend with Redis and Google BigQuery. This project keeps a backend but a much lighter one:

- **No external stores** — caches and the ledger window live in memory, so there is nothing to provision besides Node
- **Thin by design** — the server aggregates and caches public APIs (Horizon, dashboard.stellar.org, StatusPage) rather than indexing the ledger itself
- **Modern stack** — React 19, Vite 7, TypeScript 5.9, TanStack Query 5, Fastify 5
- **Focuses on monitoring** — network health, fees, supply, and operations rather than account lookup or transaction exploration

### Not yet implemented

- Own historical storage (daily stats still come from dashboard.stellar.org; in-memory state resets on restart)
- Computing lumen supply from Horizon instead of dashboard.stellar.org
- Rate limiting on the API (put it behind a proxy or CDN that does this for public deployments)
- Account search / lookup
- Transaction detail viewer
- Node topology / validator explorer (links to [stellarbeat.io](https://stellarbeat.io) instead)
- URL routing / deep-linkable pages
- Light theme
- DEX / orderbook statistics

## Deployment

The app and API ship as one Node process.

**Docker:**
```bash
docker build -t stellar-dashboard .
```

```bash
docker run -p 8787:8787 stellar-dashboard
```

The image runs the tests during the build and includes a `HEALTHCHECK` against `/api/health`.

**Any Node host (Render, Fly.io, Railway, a VM…):** run `npm ci && npm run build`, then `npm start`. Set `PORT` if the platform assigns one.

**Behind a reverse proxy:** keep `/api/networks/*/ledgers/stream` unbuffered (the server sends `X-Accel-Buffering: no` for nginx) and allow long-lived connections. Run a single instance, or several: each instance keeps its own feeds and cache.

**Separate static hosting:** to keep the frontend on a static host, build it with `VITE_API_BASE_URL=https://your-api.example.com`, run the server with `STATIC_DIR=` and `CORS_ORIGINS=https://your-app.example.com`.

## License

See [LICENSE](LICENSE) for details.
