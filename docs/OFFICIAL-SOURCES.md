# Official source record

This is an append-only source record for launch and any later Marketplace review. Dates use Europe/London. Recheck each source before a listing submission.

## 2026-11-09

| Source | Claim used | Scope | Expiry or recheck |
| --- | --- | --- | --- |
| [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) | The privacy page uses the exact product commitment: “Metabase to Sheets uses information received from Google APIs in accordance with the Google API Services User Data Policy, including its Limited Use requirements.” | Privacy wording and data-use boundary. This is not a Google certification claim. | Recheck immediately before Marketplace submission. |
| [Google Workspace Marketplace policies](https://developers.google.com/workspace/marketplace/terms/policies) | Marketplace copy must link privacy, describe transparent pricing and data use, and follow the Google user-data and Limited Use requirements. | Submission preparation only. No claim that the product is published or approved. | Recheck immediately before listing submission. |
| [Vercel Hobby plan](https://vercel.com/docs/plans/hobby) | Current connected Vercel team is Hobby and the plan is for non-commercial personal use. | Hosting blocker for the paid product. | Recheck before deployment. |
| [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) | Commercial use includes advertising a product or service and requesting or processing payments. | Hosting blocker. Do not use the current Hobby team for a commercial test. | Recheck before deployment. |
| [Stripe Billing quickstart](https://docs.stripe.com/billing/quickstart) | Stripe Billing and Checkout support hosted subscription flows and recurring Prices. | Payment design and setup notes. | Recheck before paid launch. |
| [Stripe Payment Links](https://docs.stripe.com/payment-links) | Payment Links can sell subscriptions and are configured in the Dashboard. | No live Payment Link was created by this branch. | Recheck before paid launch. |
| [Stripe Payment Link post-payment](https://docs.stripe.com/payment-links/post-payment) | Payment Links can redirect after payment and may include `{CHECKOUT_SESSION_ID}`. Stripe sends `checkout.session.completed`; delayed methods need additional payment confirmation events. | Success redirect and webhook setup. | Recheck before paid launch. |
| [Stripe webhook security](https://docs.stripe.com/webhooks) | Webhook signatures must be verified against the raw request body. | `/api/webhook` implementation. | Recheck before paid launch. |
| [Stripe security guide](https://docs.stripe.com/security/guide) | Stripe integrations should use HTTPS and keep secret keys server-side. | API and deployment security. | Recheck before deployment. |
| Stripe CLI `1.55.8`, `stripe docs` | `stripe docs /references/billing.md` and `stripe docs /references/security.md` returned 404. Current CLI pages above were used instead. | Tooling evidence. No login or account creation. | Recheck if a Stripe agent skill becomes available. |
