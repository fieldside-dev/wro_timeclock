# WRO Timeclock

Initial scaffold for a Cloudflare Pages frontend and a Worker API backed by D1.

## Repository layout

```
apps/
  api/           # Cloudflare Worker API + D1 migrations
  web/           # Cloudflare Pages static frontend
```

## Prerequisites

- Node.js 18+
- Cloudflare Wrangler (`npm install` from repo root installs it locally)

## Environment variables

The Worker expects the following variables:

- `TIMEZONE` (e.g. `America/Toronto`)
- `PAY_PERIOD_ANCHOR_DATE` (ISO date, e.g. `2026-01-02`)
- `PAYROLL_RECIPIENTS` (comma-separated emails)
- `EMAIL_FROM` (sender email address)

For local development, copy the example file and adjust as needed:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

For production, set them using Wrangler secrets or your Cloudflare dashboard:

```bash
wrangler secret put TIMEZONE --config apps/api/wrangler.toml
wrangler secret put PAY_PERIOD_ANCHOR_DATE --config apps/api/wrangler.toml
wrangler secret put PAYROLL_RECIPIENTS --config apps/api/wrangler.toml
wrangler secret put EMAIL_FROM --config apps/api/wrangler.toml
```

## D1 setup & migrations

1. Create a D1 database (once):

```bash
wrangler d1 create timeclock_db
```

2. Update `apps/api/wrangler.toml` with the returned `database_id`.
3. Apply migrations to production:

```bash
wrangler d1 migrations apply timeclock_db --config apps/api/wrangler.toml
```

### Local D1 workflow

Apply migrations against the local D1 emulator:

```bash
npm run d1:local
```

## Local development

Start the API Worker:

```bash
npm run dev:api
```

Start the Pages frontend (static):

```bash
npm run dev:web
```

- API health endpoint: `http://localhost:8787/health`
- Pages frontend: `http://localhost:8788`

## Deploy

- API: `wrangler deploy --config apps/api/wrangler.toml`
- Pages: use the Cloudflare Pages dashboard and set the build output directory to `apps/web`.
