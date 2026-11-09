# Verify Metabase to Sheets in a real spreadsheet

Use this after code changes that touch Apps Script runtime behaviour, the sidebar, or Metabase requests.

## Prerequisites

- `clasp` logged in on the machine that will push
- `.clasp.json` points at a bound Apps Script project for a test sheet (not a production sheet)
- A public https Metabase with an API key and a known question ID (a temporary Cloudflare tunnel to a local Metabase is fine)
- Repo tests already green: `npm test`

## Steps

1. Confirm `src/appsscript.json` still has only these scopes:
   - `spreadsheets.currentonly`
   - `script.container.ui`
   - `script.external_request`
   - `script.scriptapp`
2. From the repo root run `clasp push -f`.
3. Open the bound test spreadsheet in Google Sheets.
4. Reload the sheet if the sidebar was already open, then open **Metabase to Sheets → Open**.
5. Enter the Metabase site URL (https only, no path unless Metabase is mounted on a subpath), API key, question ID, and target sheet.
6. Click **Save**. Expect "Saved." with no URL validation error.
7. Click **Sync now**. Expect the question rows to appear from A1, leftover cells cleared, and a last-sync status with a row count.
8. Negative checks:
   - Paste a `/question/…` URL into the site URL field. Expect the question-URL error.
   - Use a bad API key. Expect 401, and the previous sheet data left in place.
9. Optional: set a schedule, save, then set it back to Manual only.

## Pass criteria

- Site URL validation accepts a normal https Metabase host in the live sidebar
- Sync writes the question into the chosen sheet
- Failures show a clear error and do not blank the fields the user just typed

## Notes

- Apps Script V8 has no WHATWG `URL` global. Keep site URL parsing on the manual parser in `src/Lib.js`, and keep the Node tests that delete `globalThis.URL`.
- Do not sign into Google from the shared box browser for publish or billing work. Live sheet tests may use an already-authorised `clasp` session.
