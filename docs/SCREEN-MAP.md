# Screen map

What a person can open, taken from the current source. The add-on has no dialog. `src/` never calls `alert`, `prompt`, or a modal.

Shared site chrome, on every HTML page: skip link, brand link to `/`, nav (Pricing, Support, Privacy, Terms), the Marketplace status line, and a footer with the same four pages plus the GitHub repo and email support. Source: each file under `site/*.html`.

## Sheets menu

File: [src/Main.js](../src/Main.js).

Reached when the spreadsheet opens. `onOpen` adds a menu named "Metabase to Sheets" with one item, "Open", which calls `showSidebar`.

## Sheets sidebar

File: [src/Sidebar.html](../src/Sidebar.html). Title "Metabase to Sheets", width 360.

Reached from the menu item Open.

Main controls:

- Metabase site URL
- API key (password). Hint text says where to create one in Metabase.
- Remove saved API key. Shown only when a key is already saved.
- Question ID
- Load questions. Reveals a question select and a short note.
- Sheet. Options come from the tabs in the open spreadsheet (`buildSidebarState` in [src/Lib.js](../src/Lib.js)).
- Schedule. Options are Manual only, Hourly, Every 6 hours, and Daily (`SCHEDULE_OPTIONS` in `src/Lib.js`).
- Pro licence key (password), with a status line. The HTML default is "Free plan. Manual sync and Daily are available."
- See pricing. Opens `https://metabase-to-sheets.matthew-k-galea.workers.dev/pricing` in a new tab.
- Remove saved licence key. Shown only when a licence key is already saved.
- Save
- Sync now

Status in the same sidebar, not separate screens:

- A notice after a successful Save or Sync now.
- A Pro notice when the result says a Pro schedule was refused. It links to the same pricing page.
- An error panel.
- "Not synced yet." until a sync status replaces it.

## Home

File: [site/index.html](../site/index.html). Path `/`.

Reached as the site root.

Main controls: the waitlist form (email, optional note, Join the waitlist) and "Read the setup guide" (GitHub README `#test-install`). The right-hand figure is an HTML example of a sheet, marked `TODO(dev)` until a real sidebar screenshot exists. It is not a screenshot.

## Pricing

File: [site/pricing.html](../site/pricing.html). Path `/pricing`.

Reached from the nav, the footer, or the sidebar pricing links.

Main controls: Free and Pro plan text ($0, and $9 per month, USD). Pro says it is not on sale yet. A second waitlist form asks for an email and an optional note, then "Join the waitlist". Email support sits under the form.

## Support

File: [site/support.html](../site/support.html). Path `/support`.

Reached from the nav or the footer.

No form. The page is setup steps, API-key advice, schedule notes, a list of common errors, how to stop a schedule or remove keys, and what to include in an email to support.

## Privacy

File: [site/privacy.html](../site/privacy.html). Path `/privacy`.

Reached from the nav, the footer, or the home page link.

No form. The page states what the add-on reads and writes, how the licence check and waitlist store data, and how to remove access.

## Terms

File: [site/terms.html](../site/terms.html). Path `/terms`.

Reached from the nav or the footer.

No form. Draft terms, including the note that paid terms are not final and that the pricing page keeps Pro on the waitlist until sale opens.

## Payment confirmation

File: [site/success.html](../site/success.html). Path `/success`.

Reached by opening `/success`. The page is `noindex` and is not in the sitemap. Nothing else in `site/` links to it. [site/site.js](../site/site.js) reads `session_id` from the query string and posts it to `/api/success-session`.

Static heading: "Your Pro licence key". Before the script runs, the status box says "Checking your payment."

States `describeSession` can show:

- No `session_id`: "This page shows a Pro licence key after payment. This link has no payment reference, so there is no key to show."
- The request fails: "The payment check could not reach the server. Check your connection, then refresh this page." plus Refresh.
- Pending: "Your payment is still being confirmed. Refresh this page in a minute to see your key." plus Refresh.
- Verified, with a key: "Payment confirmed. Your key is below." The key panel opens, with Copy key and three steps for pasting the key into the sidebar.
- Unrecognised reference: "This link has a payment reference the server does not recognise. Use the link Stripe opened after payment."
- Payments not configured: "Pro is not on sale yet, so there is no key to show."
- Any other failure: "This payment could not be confirmed, so no key is shown."

Copy key then says "Copied." or "Copy is blocked here. The key is selected, so press Ctrl+C or Cmd+C."

## Waitlist form

The same form is on the home page and the pricing page (`data-waitlist` in both HTML files). [site/site.js](../site/site.js) posts email, note, a hidden company field, and a `ref` value to `/api/waitlist`. The company field is a honeypot: it is hidden, and a filled value is not stored.

Status line on the form:

- While the request is in flight: "Sending…"
- New signup, from [worker/index.mjs](../worker/index.mjs): "Thanks. We will email you when the add-on is on the Marketplace."
- Email already stored: "You are already on the list. We will email you when it launches."
- If the server says ok but sends no message: "Thanks. We will email you when it launches."
- Invalid email: "Enter a valid email address."
- Rate limit: "Too many signups from this connection. Try again in an hour."
- Save failure: "Could not save your email. Try again in a minute."
- Other error body with no reason: "Could not join the waitlist. Try again."
- Network failure: "Could not reach the server. Check your connection and try again."

There is no separate confirmation page.
