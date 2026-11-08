# Metabase to Sheets

A Google Sheets Editor add-on that copies the results of a Metabase saved question into a sheet on a schedule.

- Read-only, one-way sync: data flows from one Metabase instance into the active spreadsheet. Nothing is written back to Metabase.
- Uses the Metabase REST API with an API key (`X-API-Key` header). The key is stored in the user's Apps Script user properties, never in the sheet or this repo.
- Schedules: hourly, every 6 hours, or daily, plus Sync now.

Status: early development. Not yet on the Google Workspace Marketplace.
