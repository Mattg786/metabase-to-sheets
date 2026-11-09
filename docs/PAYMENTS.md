# Payments and licence setup

This branch prepares the payment path. It does not create Stripe accounts, products, prices, subscriptions, payment links, webhooks, secrets, or paid hosting. It does not deploy the website.

## Current blockers

- The intended future site address is `https://metabase-to-sheets.vercel.app`. It is a configurable default, not a claim that the site is live or Google verified.
- On 9 November 2026, the available Vercel connector showed only the `matthew-galea` team on the Hobby plan. Vercel's [Hobby plan](https://vercel.com/docs/plans/hobby) is for non-commercial personal use. Vercel's [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) say commercial use includes advertising a product or service and requesting or processing payments. Do not deploy this paid product to the current Hobby team, even as a commercial test. Matt must approve an eligible hosting account or paid plan before deployment.
- The Stripe CLI was installed at version `1.55.8` for public documentation only. No login or sandbox account was created. The requested `stripe docs /references/billing.md` and `stripe docs /references/security.md` paths returned 404 in this CLI version. The current official pages used are listed in `docs/OFFICIAL-SOURCES.md`.

## Stripe setup after approval

1. Choose an eligible host and approve the final public base URL. Set the same value in `site/site-config.js` and the canonical, sitemap, and robots values if the host changes. Keep this repository's Vercel config as the deployment shape, but do not deploy to the current Hobby team.
2. In Stripe test mode first, create a product for Metabase to Sheets. Create one recurring price for Pro. Leave the final amount as a Matt decision. The site intentionally says `Price TBC` and does not claim unlimited Pro syncs.
3. Create a Stripe Payment Link for that recurring price. Do not override `payment_method_types` in code. Let the Payment Link use its Dashboard payment-method configuration.
4. Set the Payment Link after-payment redirect to:

   `https://metabase-to-sheets.vercel.app/success?session_id={CHECKOUT_SESSION_ID}`

   Stripe's Payment Link documentation confirms that the Dashboard can redirect to a chosen URL and replace `{CHECKOUT_SESSION_ID}` with the current Checkout Session ID. This implementation does not create or update the Payment Link through an API. The link and redirect therefore need Dashboard configuration after the final host is approved.
5. Create a webhook endpoint at `https://<approved-host>/api/webhook`. Subscribe it to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. The signed endpoint reads the raw request body, validates `Stripe-Signature`, requires `payment_status: paid`, checks the configured Payment Link and price, then writes an idempotent random licence key into the subscription metadata field `metabase_sheets_licence`.
6. Add these environment variables in the approved host's private settings. Never commit them:

   - `STRIPE_SECRET_KEY`: preferably a Stripe restricted API key. Based on the calls in `server/_lib/checkout.js` and `server/_lib/licensing.js`, grant the minimum resource permissions below. Stripe restricted keys use None, Read, or Write per resource, and Write includes Read. Set **Subscriptions: Write** because the webhook writes only `metabase_sheets_licence` metadata and the licence check retrieves subscriptions. Set **Checkout Sessions: Write** because the webhook writes only licence metadata to the session and the success check retrieves sessions. Set **Payment Links: Read** because the server retrieves the configured link to compare its exact URL. Set **Prices: Read** because the subscription and Checkout Session retrievals expand their line-item Prices for the configured `STRIPE_PRICE_ID`; there is no standalone Price write or create call. Set every other resource to **None**. If the Stripe Dashboard treats expanded Price data as covered by the parent resource in the selected API version, verify that in sandbox request logs and leave Prices at the lowest setting that passes. Do not use an unrestricted key unless Stripe's permission model makes the required restricted-key calls impossible.
   - `STRIPE_WEBHOOK_SECRET`: the signing secret for the endpoint above.
   - `STRIPE_PRICE_ID`: the exact recurring Pro price ID.
   - `STRIPE_PAYMENT_LINK_URL`: the exact hosted Payment Link URL.
   - `STRIPE_API_VERSION`: optional. If omitted, the code uses `2026-09-30.endive`.

7. The Apps Script sidebar uses the fixed endpoint `https://metabase-to-sheets.vercel.app/api/licence` until the product host is deliberately changed in `src/Lib.js`. That endpoint receives only the entered licence key. It does not receive sheet data, a Metabase API key, or a Google token.
8. Test in Stripe sandbox mode. Test a successful subscription, an incomplete or asynchronous payment, a duplicate webhook delivery, a wrong price, a wrong Payment Link, cancellation, and an inactive subscription. Confirm that an unpaid or mismatched session never receives a key. Confirm that the success page shows a key only after the webhook has written subscription metadata.
9. Before any live charge, approve the final price, billing interval, refund and cancellation terms, privacy statement, support process, hosting plan, and Marketplace wording. No live spend is authorised by this branch.

## Licence design

The key format is `mts_<subscription-id>_<random-token>`. The subscription ID is only a lookup handle. The random token is the bearer secret, and the complete key must match the `metabase_sheets_licence` subscription metadata in a timing-safe comparison. The licence API retrieves exactly that subscription, then checks the metadata, `active` status, and `STRIPE_PRICE_ID`. It does not scan all subscriptions or rely on an eventually consistent metadata search for every check.

Webhook retries are safe because existing valid metadata is reused. New metadata writes use a stable Stripe idempotency key based on the subscription ID. The success page never provisions a key. It only reads a matching paid session after webhook fulfilment.

The Apps Script cache is per Google user. A fresh active response is cached for 24 hours. An unreachable or malformed response can use the last valid active result for at most 7 days without moving its timestamp. An explicit inactive or configuration response revokes Pro immediately. Changing or clearing the key deletes the old cache. The server has no licence database or arbitrary inactive-user cache. Hosting request-log retention, Stripe record retention, and support mailbox retention remain subject to those providers' controls. The add-on does not store spreadsheet contents on the server.
