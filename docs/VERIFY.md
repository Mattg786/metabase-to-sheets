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

## Edge-case checklist (cards 42 to 46)

Use the MacBook test Metabase (or the same throwaway instance) with these saved questions:

| Case | Card ID | Name | Expect |
|---|---|---|---|
| Zero rows | 42 | edge-zero-rows | Sync reports no rows. Only the previous synced block is cleared. Cells typed outside that block stay. |
| Large (~18760 ORDERS) | 43 | edge-large-orders-all | Sync writes all returned rows (under the 100,000-row guard). Second sync does not duplicate. |
| Awkward values | 44 | edge-awkward-values | Strings that look like formulas (`=`, `+`, `-`, `@`) stay literal text. Leading zeros such as `00123` stay. Numbers stay numbers. |
| Dup / blank colnames | 45 | edge-dup-blank-colnames | Metabase JSON collapses duplicate column names. Confirm the README known-limitation note. Prefer distinct aliases in the question. |
| Schema shrink | 46 | edge-question-x-schema-change | Sync 3 columns, then shrink the question to 2 columns (see `put-question-x-2cols.sh`). The old third column inside the previous synced block is cleared; cells outside that block stay. |

Also check manually:

- Wrong API key: 401, sheet unchanged
- Missing question ID: clear validation error
- Unreachable site URL: network error, sheet unchanged
- Renamed target tab: choose the new name and sync
- Text typed next to the synced block: survives the next sync

## Notes

- Apps Script V8 has no WHATWG `URL` global. Keep site URL parsing on the manual parser in `src/Lib.js`, and keep the Node tests that delete `globalThis.URL`.
- Do not sign into Google from the shared box browser for publish or billing work. Live sheet tests may use an already-authorised `clasp` session.
- Cell-limit guard: the add-on refuses a sync that would grow the spreadsheet past a 10,000,000-cell budget. Official Google Drive Help (`https://support.google.com/drive/answer/37603`, checked 2026-11-09) lists up to 20 million cells for Sheets created in or converted to Google Sheets. The user-facing error does not claim a specific Google number.
