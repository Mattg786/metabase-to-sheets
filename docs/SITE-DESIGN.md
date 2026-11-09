# Site design

## Direction

Metabase to Sheets copies a saved Metabase question into spreadsheet cells. The site shows that directly: an example question above a small sheet grid, with real column letters and row numbers and the result starting at A1. That grid is the one memorable element. Everything else stays quiet: left aligned, plain rules, no card grid, no eyebrow labels, no gradients, no invented users, ratings, or testimonials.

## Colour

- `#F6F9FC` paper, page background
- `#183344` ink, text and strong rules
- `#0A716F` teal, links, buttons, the active A1 cell, and the sidebar accent
- `#CAD8E1` grid, rules and cell borders
- `#E7F0F7` pale blue, the shared status line and quiet surfaces
- `#B55218` orange, keyboard focus and the "Not yet available to buy" line only

Status colours pair a tint with text, never colour alone: teal tint for success or an active licence, amber for the licence fallback, red tint for errors.

The sidebar uses the same teal. Its input borders are `#7B8D99`, 3.4:1 against white, which meets the 3:1 minimum for control borders.

## Type

System stack: `Avenir Next`, `Trebuchet MS`, `Arial`, sans-serif. No font request. Headings are sentence case with slight negative tracking. The home h1 is capped near 3.1rem, so the setup button sits about 560px down at 1440 by 900.

## Layout

One left edge. Every block, including inner page headings and prose, sits inside `.page-width`. Prose is limited to 68 characters but is not centred.

```text
header      brand                                Pricing Support Privacy Terms
status      Not on the Google Workspace Marketplace yet. Setup is manual ...
home hero   h1, lede, [Read the setup guide] [See pricing]   | question card
                                                             |   arrow to A1
                                                             | sheet grid A-C, rows 1-5
setup       1. Create key   2. Open sidebar   3. Tab and schedule
split       What it reads and writes | three short paragraphs
footer      one-line description               Pricing Support Privacy Terms Source code Email support
```

Pricing is two plans split by one vertical rule, stacking below 600px. Header, status line, and footer are identical on every page. Navigation marks the current page with `aria-current="page"`.

Below 900px the hero stacks and the grid follows the copy. At 390px nothing scrolls sideways.

## Open Graph image

`site/assets/og.png` is 1200 by 630, rendered from `scripts/og-image.html` with headless Chrome. The command is in that file. It uses example data only.

## Screenshot

The home page uses a labelled example grid, not a product screenshot. There is no real screenshot of the sidebar in a test sheet yet. A `TODO(dev)` comment in `site/index.html` marks where one should go. Do not replace it with a rendered mock.

## Review notes

The earlier version floated the question card over the sheet with absolute positioning, which overlapped the header row on desktop. It also used decorative eyebrows, a hero h1 near 5.8rem that pushed the button below the fold, and several different Marketplace disclaimers. This version stacks the illustration in normal flow, uses one shared status line, and removes the payment button until Pro is on sale.
