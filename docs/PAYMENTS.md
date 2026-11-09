# Payments and licence setup

This branch prepares the payment path. It does not create Stripe accounts, products, prices, subscriptions, Payment Links, webhooks, secrets, Cloudflare resources, or paid infrastructure. It does not deploy the website. The Stripe account for this product is still pending; never use the tutoring account.

## Hosting and card boundary

The configured host is a clearly marked placeholder: `https://metabase-to-sheets.example-subdomain.workers.dev`. It is not a live site or a confirmed Cloudflare subdomain. Replace it consistently in `src/Lib.js`, `site/site-config.js`, page canonical and Open Graph metadata, `site/robots.txt`, and `site/sitemap.xml` before production.

Cloudflare's general grant in section 2.1 of its [Terms of Service](https://www.cloudflare.com/terms/) grants a limited right to access and use the Services subject to the Agreement, including payment obligations. Sections 2.2.1, 2.6, and 2.7 contain no general non-commercial restriction. Cloudflare does not explicitly state that commercial use is allowed. The commercial-use conclusion here is an inference from the general grant and the absence of that restriction in those sections. The [Developer Platform service-specific terms](https://www.cloudflare.com/service-specific-terms-developer-platform/) cover Workers and Pages and state that the Developer Platform can host content. The [Website Terms](https://www.cloudflare.com/website-terms/) exclude products provided under self-serve, enterprise, or other signed agreements.

**Card restriction:** section 2.2.1(h) of Cloudflare's Terms prohibits processing or collecting personal or business credit card information on a web property receiving Free Services. Keep every card field and card collection on Stripe-hosted Payment Links or Checkout. This Worker must not request, receive, process, or store card details. Do not add an embedded checkout, card form, or payment/card object expansion.

## Worker configuration

The project uses one Worker and Workers Static Assets. Static requests use Cloudflare's asset-first path; `/api/*` invokes the Worker first. There are no remote bindings. The worker uses Web Crypto and Fetch, and does not use Node-only runtime APIs.

Configure these Worker secrets after the account, domain, Stripe account, and production details have been approved. Enter values only at Wrangler's interactive prompt. Never put a secret in shell arguments, source control, or logs.

- `STRIPE_SECRET_KEY`: preferably a Stripe restricted API key. Grant the minimum needed: Checkout Sessions Write, Subscriptions Write, Payment Links Read, and Prices Read. All other resources None. Write includes Read. Recheck this against sandbox request logs and the current Stripe permission model.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the endpoint below.
- `STRIPE_PRICE_ID`: exact recurring Pro Price ID.
- `STRIPE_PAYMENT_LINK_URL`: exact Stripe-hosted Payment Link URL.
- `STRIPE_API_VERSION`: optional Stripe API version. If omitted, the code uses `2026-09-30.endive`.

The API preserves the existing paths: `/api/licence`, `/api/webhook`, `/api/payment-link`, and `/api/success-session`. When licence configuration is missing, `/api/licence` returns HTTP 503 with `{"active":false,"plan":"free","reason":"licensing not configured"}`. The licence endpoint receives only the key. It checks the matching subscription metadata, active status, and configured product Price. The checkout verification checks the paid subscription session, configured Payment Link, session Price, and subscription Price. Fulfilment stores a random key in subscription metadata and uses stable Stripe idempotency keys. Webhook signatures cover the raw request bytes, reject timestamps outside five minutes, and accept any valid `v1` signature in a well-formed header.

## Stripe setup after approval

1. Confirm the production host and update every placeholder URL listed above. Keep the OAuth scopes and Apps Script manifest unchanged.
2. In the dedicated product Stripe account, create a product and recurring Price. Matt must choose and approve the amount, interval, cancellation and refund terms first.
3. Create a Stripe Payment Link for the Price. Leave payment methods under Dashboard control. Do not override card-related payment method configuration in code.
4. Set its after-payment redirect to `https://<approved-host>/success?session_id={CHECKOUT_SESSION_ID}`.
5. Create a webhook endpoint at `https://<approved-host>/api/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
6. Add the five secrets above with `npx wrangler secret put NAME`. Wrangler prompts for each value; do not add secret values to a command line.
7. Test in Stripe sandbox mode: paid, unpaid or asynchronous, duplicate delivery, wrong Price, wrong Payment Link, cancellation, inactive subscription, and an unavailable Stripe API. Confirm no mismatched or unpaid session gets a key.
8. Before any live charge, approve the final price, billing interval, refund and cancellation terms, privacy statement, support process, hosting setup, and Marketplace wording.

No Stripe account has been signed into and no live Stripe calls have been made for this task.

## Licence cache

The Apps Script cache is per Google user. A valid response is cached for 24 hours. An unreachable or malformed response can use the last valid active result for at most 7 days without moving its timestamp. An explicit inactive or configuration response revokes Pro immediately. Changing or clearing the key deletes the old cache. The server has no licence database or arbitrary inactive-user cache. Hosting request-log retention, Stripe record retention, and support mailbox retention remain subject to those providers' controls. The add-on does not store spreadsheet contents on the server.
