# Metabase to Sheets

A Google Sheets Editor add-on that copies the results of one saved Metabase question into a sheet.

The sync is read-only. Data moves from one Metabase instance into the active spreadsheet. Nothing is written back to Metabase.

This repository contains the Apps Script project and a static launch site with a Cloudflare Worker for the licence and payment API. It is not published on the Google Workspace Marketplace.

## What you do in the sheet

1. Open the sheet and choose **Extensions**, **Metabase to Sheets**, **Open**.
2. Enter the Metabase site URL. It must be `https`. Use the site root, for example `https://example.metabaseapp.com`. A path prefix is allowed when Metabase is not hosted at the root.
3. Enter an API key. In Metabase this is under Admin, Settings, Authentication, API keys. See [Metabase API keys](https://www.metabase.com/docs/latest/people-and-groups/api-keys).
4. Enter the question ID. That is the number in a URL such as `/question/42`. **Load questions** can fill the ID from `GET /api/card` when the key is allowed to list questions. Typing the ID is enough.
5. Choose the sheet tab that should receive the rows.
6. Choose **Manual only** or **Daily**, then **Save**. Hourly and Every 6 hours require a verified Pro licence. **Sync now** runs a sync immediately.

Each sync calls `POST {site}/api/card/{id}/query/json` with the header `X-API-Key`. The JSON export is a list of row objects. The add-on writes those keys as the header row and the values as the rows underneath, starting at cell A1. It does not add columns of its own.

The request asks Metabase for unformatted values (`format_rows: false`) and for the underlying rows rather than a pivot layout (`pivot_results: false`). Documented export formats are `csv`, `json`, `xlsx`, and `api`. This add-on uses `json`. Official reference: [Metabase API](https://www.metabase.com/docs/latest/api).

Each sync clears only the previously synced block for this configuration, then writes the new result starting at A1. Cells you typed outside that block are left alone. An empty JSON list (`[]`) clears the previous synced block and writes nothing. The JSON export does not include column names when there are no rows, so the add-on does not invent headers for an empty result.

String values are written as plain text so Sheets does not treat leading `=`, `+`, `-`, or `@` as formulas, and so values such as `00123` keep their leading zeros. Numbers stay numbers.

The sidebar shows the last sync time in UTC, the row count, and the last error. A successful sync clears the error. A failed sync leaves the previous cells in place.

The schedule runs as the Google account that saved it, and it uses that account's API key. The free plan permits one saved sync per spreadsheet, manual sync, and Daily. A verified Pro licence permits Hourly and Every 6 hours. Apps Script chooses the exact minute. A scheduled run checks the licence again so a stale trigger cannot bypass the plan.

Very large results are refused before the sheet is changed: more than 100,000 rows, or more than 2,000 columns. A sync is also refused when growing the sheet would push the spreadsheet past Google Sheets' cell limit.

## Known limitations

- The Metabase JSON export uses one object per row. Duplicate column names collapse to a single key in that format, so the add-on cannot keep two columns that share a name. Switching to CSV would keep duplicate headers, but this add-on stays on the JSON export to keep the same high row limit and typed values. Prefer distinct column aliases in the Metabase question.
- Integers with 16 or more digits are kept as text so they are not rounded by JavaScript number parsing. Shorter integers stay numbers.

## Where the API key is stored

The API key is stored in Apps Script **UserProperties** for the Google account that entered it. It is not written to the sheet, not stored in document properties, and not written to the Apps Script log by this project. The sidebar receives only `hasApiKey`, never the key itself.

Redirects are not followed, so the key is not sent on to another host. Site URLs must be `https`, with no username or password in the URL.

Other settings (site URL, question ID, sheet name, schedule, last sync time, and last error) are stored in document properties for the spreadsheet.

The optional Pro licence key and its 24-hour verification cache are stored in UserProperties. The cache may use the last valid active result for up to 7 days when the licence endpoint is unreachable or returns malformed data. An explicit inactive or configuration response revokes Pro immediately. Changing or clearing the key clears the old cache.

A `401` means Metabase rejected the key. A `403` means the key cannot access that question. A `404` means the question ID was not found. If the host cannot be reached, the sidebar says so and the sheet is left unchanged. A new key is saved only after Metabase accepts it during **Sync now**. **Save** stores a key without calling Metabase, so you can check it with **Sync now** afterwards.

## Privacy

The add-on reads the selected saved question from the user's Metabase host and writes its rows to the selected current spreadsheet. It does not store sheet data on the licence server. Read the [privacy statement](site/privacy.html), [support guide](site/support.html), and [payment setup](docs/PAYMENTS.md) before deployment. The launch site says Marketplace publication is pending and provides no fake install URL.

## Scopes

`appsscript.json` requests only:

- `https://www.googleapis.com/auth/spreadsheets.currentonly`
- `https://www.googleapis.com/auth/script.container.ui`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.scriptapp`

`script.container.ui` is for the sidebar. `script.external_request` is for the call to Metabase. `script.scriptapp` is for the schedule trigger. The add-on does not request full Drive, Gmail, or the full Spreadsheets scope.

## Project layout

```
src/appsscript.json    Apps Script manifest
src/Lib.js             Validation, Metabase calls, sheet writing, schedule
src/Main.js            Menu and functions called by the sidebar
src/Sidebar.html       Sidebar UI
worker/                Cloudflare Worker API routes
server/_lib/           Shared Stripe REST, licence, checkout, and webhook logic
site/                  Static launch pages, styles, sitemap, and OG asset
wrangler.toml          Worker and Static Assets configuration
docs/SITE-DESIGN.md    Launch site design decisions
docs/PRIVACY-EVIDENCE.md Source trace for the privacy statement
docs/PAYMENTS.md      Cloudflare hosting and Stripe setup
docs/OFFICIAL-SOURCES.md Dated official source record
.clasp.json.example    Copy to .clasp.json locally. Do not commit .clasp.json.
tests/                 Node tests with a mocked Metabase API
```

`.clasp.json` is gitignored. `rootDir` is `src`, so tests are not pushed to Apps Script.

## Tests

```bash
npm ci
npm test
npm run build:site
```

The tests mock Metabase and Stripe responses, including invalid and overlong licence keys, missing configuration, wrong products, inactive subscriptions, paid and unpaid Checkout Sessions, signed-webhook fulfilment paths, duplicate webhook retries, cache expiry, outage fallback, revocation, static output, and sidebar state. They do not call a live Metabase or Stripe account, and they do not need a Google account. Node.js 20 or newer is required.

## Website deployment shape

Cloudflare Workers Static Assets serves `site/`; `worker/index.mjs` handles `/api/licence`, `/api/webhook`, `/api/payment-link`, and `/api/success-session`. `wrangler.toml` runs the Worker first only for `/api/*` and leaves static assets on the asset-first path. The planned host is `https://metabase-to-sheets.matthew-k-galea.workers.dev`; it is not yet live or verified. See [docs/PAYMENTS.md](docs/PAYMENTS.md) and [docs/HANDOFF-CLOUDFLARE-FINAL-v1.md](docs/HANDOFF-CLOUDFLARE-FINAL-v1.md).

## Test install

This is a private test install with [clasp](https://github.com/google/clasp). It does not publish the add-on.

1. Install clasp: `npm install -g @google/clasp`
2. Turn on the Apps Script API for your Google account at [script.google.com/home/usersettings](https://script.google.com/home/usersettings).
3. Log in: `clasp login`
4. Create a Google Sheet.
5. In that sheet, open **Extensions**, **Apps Script**.
6. Open **Project settings** and copy the Script ID.
7. From this repository, copy the example config and paste the Script ID into `scriptId`:

   ```bash
   cp .clasp.json.example .clasp.json
   ```

8. Push the project: `clasp push`
9. In the Apps Script editor, choose the function `onOpen` and run it. Approve the consent screen. Google may say the app is unverified. That is expected for a private test that has not been through Marketplace review. The prompt should be limited to the current spreadsheet, external requests, and Apps Script triggers.
10. Reload the spreadsheet. Open **Extensions**, **Metabase to Sheets**, **Open**.
11. Enter the site URL, API key, and question ID, then choose **Sync now**.

Do not commit `.clasp.json`. Do not put an API key in the repository, the sheet, or a log.

To update the test copy later, change the code and run `clasp push` again, then reload the sheet.
