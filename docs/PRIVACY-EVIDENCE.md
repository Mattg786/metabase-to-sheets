# Privacy evidence

This file records the current source facts before the launch site and licence flow were added. It is evidence for the product privacy statement, not a claim that Google has verified the add-on.

## Current spreadsheet and Metabase access

- `src/appsscript.json:6-11` requests only current-spreadsheet access, container UI, external requests, and Apps Script triggers. It does not request Drive, Gmail, or full spreadsheet access.
- `src/Lib.js:271-281` builds the query call to the user's Metabase host at `/api/card/{id}/query/json` and sends `X-API-Key`.
- `src/Lib.js:284-292` builds the optional question-list call to the same Metabase host at `/api/card`.
- `src/Lib.js:125-177` accepts only `https:` Metabase URLs, rejects credentials, queries, hashes, localhost, question URLs, and an `/api` suffix.
- `src/Lib.js:296-317` builds the Metabase requests with `followRedirects: false` and `validateHttpsCertificates: true`; `src/Lib.js:141-190` accepts only HTTPS site roots. `src/Lib.js:1373-1412` performs those requests through Apps Script `UrlFetchApp` and returns only the response status and body to the sync code.
- `src/Lib.js:451-508` interprets the Metabase response, while `src/Lib.js:681-731` writes the result to the selected sheet and restores the previous block if a write fails. `src/Lib.js:1160-1196` records sync status in document properties and does not send sheet rows to the licence service.

## Credential and settings storage

- `src/Lib.js:756-807` stores the Metabase API key and licence key in `UserProperties`, and clearing either licence key removes its cache. `src/Lib.js:808-865` stores the site URL, question ID, selected sheet, schedule, status, and last synced range in document properties. The current data model has one saved configuration per spreadsheet.
- `src/Lib.js:958-983` returns `hasApiKey` and `hasLicenceKey` to the sidebar, not either secret.
- `src/Sidebar.html:154-174` marks both secret inputs as password fields and offers removal of the saved API key and licence key.
- `src/Sidebar.html:247-310` hydrates visible state with text and option nodes. `src/Sidebar.html:317-333` keeps failed save values in the form without rendering server text as HTML.

## Data sharing and retention boundaries

The launch code sends only the licence key to the configured Cloudflare Worker licence endpoint. The licence API sends no sheet data or Metabase credentials to Stripe. Stripe stores the subscription, payment, and licence metadata needed to verify the product. Cloudflare receives the licence request and may retain hosting request logs under its service controls. The site links to support at `mattgalea@mail.grokbot.com`. Support may need information Matt chooses to provide. Humans do not read data except with support consent, for security work, or when required by law. The product does not sell data or use it for advertising.

## Privacy claim and source boundary

The privacy page will say: “Metabase to Sheets uses information received from Google APIs in accordance with the Google API Services User Data Policy, including its Limited Use requirements.” It will link to the official policy. This is a product commitment, not a Google certification. Recheck the policy before any Marketplace submission.

## HTTPS and limits

The current source rejects non-HTTPS Metabase URLs before any request. The published build keeps that rule. Scheduled syncs use the stored spreadsheet configuration and the Google account's saved API key. The site must not claim that other files, accounts, or email are inaccessible unless a future review confirms that boundary.
