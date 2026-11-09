# Cloudflare handoff, final v1

**Evidence date:** 9 November 2026, Europe/London

**Repository branch:** `feat/site-and-licence`

**Worker name:** `metabase-to-sheets`

**Compatibility date:** `2026-11-09`

**Wrangler:** `4.158.0`, pinned in `package-lock.json`

This handoff supersedes the earlier site and licence Vercel handoff. It is based on the implementation and dated source record in [OFFICIAL-SOURCES.md](OFFICIAL-SOURCES.md). The configured `workers.dev` hostname is a placeholder, not a live address. Replace it consistently before a production deployment.

## Hosting decision and card boundary

Cloudflare's Terms of Service section 2.1 grants conditional access to and use of Services. Sections 2.2.1, 2.6, and 2.7 contain no general non-commercial restriction, and section 2.6 says Cloudflare may offer free or trial Services. Cloudflare does not expressly say commercial use is permitted. The conclusion that this use fits the general grant is an inference from that grant and the absence of a prohibition in those sections. The Developer Platform service-specific terms cover Workers and Pages and say the Developer Platform can host content. The Website Terms exclude products provided under self-serve, enterprise, or other signed agreements.

**Free Services restriction:** Terms section 2.2.1(h) says a web property receiving Free Services must not process or collect personal or business credit card information. Payment Links and Checkout must remain hosted by Stripe. The Worker must not request or collect card details. No embedded checkout, card form, or payment/card object expansion may be added.

## Limits and availability

Official Workers pricing and limits reviewed on 9 November 2026 state: Free dynamic requests are limited to 100,000 per account per day and reset at midnight UTC; CPU is 10 ms per invocation; waiting on `fetch` is excluded from CPU time; memory is 128 MB; each invocation permits 50 subrequests; up to 20,000 static asset files may be uploaded, each no larger than 25 MiB. Requests to static assets are free and unlimited. Cloudflare may terminate Free Services at its discretion and makes no uptime promise. These limits and availability statements are not a service guarantee.

## Runtime and routes

One Worker serves the static `site/` directory through Workers Static Assets. `run_worker_first = ["/api/*"]` sends only API paths to Worker code; matched assets stay asset-first. No account ID, token, custom host, remote binding, or secret value is embedded in the repository.

Worker observability logs and traces are explicitly enabled in `wrangler.toml`; the default sampling rate is 100%. The handler adds no application logs and does not log request bodies, licence tokens, or secrets. Because only `/api/*` runs through Worker code, static asset requests remain asset-first and do not create Worker invocation logs or traces. On 9 November 2026, the Workers Free Logs allowance is 200,000 events per day with three-day retention. Cloudflare states that from 1 December 2026, Free observability includes 0.5 GB of ingestion per day and seven-day retention, with ingestion stopping at the daily limit. Recheck the current cap before deployment. These caps preserve the free boundary; they are not an allowance to exceed it.

- `POST /api/licence`: checks the subscription encoded in the licence key, stored key metadata, active status, and configured Price. Unconfigured response is HTTP 503 with `active:false`, `plan:"free"`, and `reason:"licensing not configured"`.
- `POST /api/webhook`: reads at most 512 KiB of raw bytes, verifies Stripe HMAC-SHA256 with Web Crypto and a five-minute timestamp tolerance, rejects malformed headers, and accepts any valid `v1` signature. It fulfils only the selected paid Checkout events and only after checking the configured Payment Link and Price.
- `GET /api/payment-link`: exposes only a valid Stripe-hosted Payment Link URL.
- `POST /api/success-session`: confirms the paid hosted Checkout session, configured Payment Link, configured Price, and subscription metadata before returning the licence key.
- All other `/api/*` routes return JSON 404. Other paths use Workers Static Assets and unknown paths return 404.

The API uses Fetch and Web Crypto, not Node-only APIs. Licence fulfilment uses a random token bound to subscription metadata and stable Stripe idempotency keys. The Apps Script keeps its current 24-hour active cache and seven-day last-good outage fallback. The manifest and its four OAuth scopes are unchanged.

## Secrets and production preparation

Secret commands are not read-only preparation. Each `wrangler secret put` command stores a secret and deploys a new Worker version immediately. With several secrets, each command is a separate deployment and may leave the Worker partially configured until all required values are set. Do not run them until a Worker exists and there is separate parent approval for the secret writes and version deployments. The prompts are interactive; never pass a secret as a shell argument or write it to a file.

```sh
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_ID
npx wrangler secret put STRIPE_PAYMENT_LINK_URL
npx wrangler secret put STRIPE_API_VERSION
```

`STRIPE_API_VERSION` is optional. Without it, the code uses `2026-09-30.endive`. Prefer a restricted Stripe key with Checkout Sessions Write, Subscriptions Write, Payment Links Read, and Prices Read. Leave all other resources at None and confirm required permissions from sandbox request logs. The product Stripe account is pending. Never use the tutoring account.

## Local validation and later deployment

Local commands require no Cloudflare or Stripe login. The local Worker has no remote bindings and no credentials. The configured placeholder makes the sidebar use the example host until the final URL is chosen.

```sh
npm ci
npm test
npm run build:site
npm run dev
npm run deploy:dry-run
```

Validation completed with Node.js `26.7.0`, npm `11.19.0`, and Wrangler `4.158.0`:

- `npm ci` completed. `npm test` passed all 86 tests; none call live Stripe or Metabase.
- `npm run build:site` passed for the 12 required site files.
- `git diff --check` and Node syntax checks passed. `src/appsscript.json` has no diff; its four OAuth scopes are unchanged.
- Local Wrangler used only `env.ASSETS` in local mode. HTTP checks returned 200 for `/`, `/privacy`, `/terms`, `/support`, `/pricing`, `/success`, `/styles.css`, `/site.js`, `/site-config.js`, `/assets/og.svg`, `/robots.txt`, and `/sitemap.xml`; `/missing` returned 404.
- Local `POST /api/licence` with missing secrets returned HTTP 503 and exactly `{"active":false,"plan":"free","reason":"licensing not configured"}`.
- `npm run deploy:dry-run` passed. Wrangler read 13 asset files and reported 22.95 KiB total upload, 6.06 KiB gzip, then exited at `--dry-run`.
- Local server was stopped after checking. `curl` was unavailable in the environment, so Node Fetch performed the same HTTP requests.

These local checks do not prove remote CPU usage or account limits, live Stripe Checkout, production webhook delivery, or deployment behavior.

After the production URLs are approved and replaced consistently, and after separate parent approval to create the initial Worker, run the identity check and deploy the Worker unconfigured. In this state, the licence endpoint returns the documented 503 response and payment routes remain unconfigured:

```sh
npx wrangler whoami
npx wrangler deploy --dry-run
npx wrangler deploy
```

The dry run does not deploy. The final command creates or updates a Worker version and is a deployment. After separate parent approval to write secrets and deploy each resulting version, and after the Stripe account, Price, Payment Link, webhook, legal terms, and access are approved, set the required secrets using the interactive commands above. `STRIPE_API_VERSION` remains optional. Deployment and secret writes are not authorised by this handoff. Local checks do not prove remote CPU usage, Cloudflare account limits, production availability, Stripe checkout, Stripe webhook delivery, or live billing.
