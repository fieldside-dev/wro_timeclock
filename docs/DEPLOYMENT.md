# Deployment & Portability

This document outlines how to deploy this project on Cloudflare and keep it portable across domains.

## Cloudflare Pages + Workers + D1 setup

1. **Create the D1 database**
   - In the Cloudflare dashboard, go to **Workers & Pages → D1 → Create database**.
   - Note the database name and ID.

2. **Create a Worker (API/backend)**
   - Go to **Workers & Pages → Create application → Worker**.
   - Attach the D1 database in the Worker settings (Bindings → D1).
   - Add any additional bindings you need (KV, R2, Queues) here as well.

3. **Create a Pages project (frontend)**
   - Connect your Git repository.
   - Configure build settings (framework preset, build command, and output directory).
   - Set the Pages project to call the Worker via the environment-configured API base URL.

4. **Link Pages to Worker (optional but common)**
   - Use a custom domain or route so that the Pages app can call the Worker on the same top-level domain.

## Environment variables & secrets

Define configuration in environment variables instead of hard-coding values. Typical variables:

- `API_BASE_URL` – Base URL for the Worker API (e.g., `https://api.wildrock.net`).
- `SESSION_COOKIE_DOMAIN` – Cookie domain (e.g., `wildrock.net` or `.wildrock.net`).
- `ALLOWED_ORIGINS` – Comma-separated list of allowed origins for CORS.
- `CSRF_ALLOWED_ORIGINS` – Comma-separated list of origins or hostnames used for CSRF validation.
- `APP_PUBLIC_URL` – Public-facing URL of the web app.

**Cloudflare Pages**
- Pages → Settings → Environment variables
- Add variables for **Preview** and **Production** as needed.

**Cloudflare Workers**
- Worker → Settings → Variables & Secrets
- For sensitive values (API keys, tokens), use **Secrets** instead of plain text.

## Cron trigger configuration

If your Worker uses scheduled tasks, add a cron trigger:

1. Open the Worker in Cloudflare dashboard.
2. Navigate to **Triggers → Cron Triggers**.
3. Add the cron schedule (e.g., `0 2 * * *` for nightly runs).
4. Deploy to activate the trigger.

## Domain migration notes (fieldside.ca → wildrock.net)

- **No hard-coded domains**: Keep all domain references in environment variables (`APP_PUBLIC_URL`, `API_BASE_URL`, `ALLOWED_ORIGINS`, etc.).
- **DNS setup**: Point the new domain to Cloudflare and create DNS records for Pages/Worker routes.
- **Redirects**: Add a redirect from `fieldside.ca` to `wildrock.net` at the edge (Cloudflare Rules → Redirect Rules) to preserve SEO.
- **Cookie scope**: Use cookie domain settings compatible with both domains (set per environment), and avoid assuming a single TLD.

## CORS, CSRF, and session compatibility

To support both `fieldside.ca` and `wildrock.net` without code changes:

- **CORS**: Configure `ALLOWED_ORIGINS` with both domains in production during migration.
- **CSRF**: Validate `Origin`/`Referer` against `CSRF_ALLOWED_ORIGINS` rather than a single hard-coded domain.
- **Sessions**: Set the cookie domain via `SESSION_COOKIE_DOMAIN` per environment to ensure cookies are scoped correctly.
- **SameSite**: If the frontend and API are on the same top-level domain, `SameSite=Lax` works well. If they are on different domains, use `SameSite=None; Secure`.

## Validation checklist

- [ ] No hard-coded `fieldside.ca` or `wildrock.net` in source code.
- [ ] `ALLOWED_ORIGINS` includes both domains during migration.
- [ ] CSRF validation references env-configured allowlists.
- [ ] Session cookies are scoped via environment variables.
