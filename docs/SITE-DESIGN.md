# Site design

## Direction

Metabase to Sheets is about a saved question becoming cells in a spreadsheet. The site uses a calm, technical reading order and shows that action directly. It does not use invented metrics, testimonials, neon gradients, a generic SaaS card grid, or decorative labels.

## Colour system

- `#F6F9FC` cool off-white page background
- `#183344` ink navy for body text and deep panels
- `#0A716F` muted teal for links and primary actions
- `#CAD8E1` spreadsheet grey for rules and grid lines
- `#E7F0F7` pale blue for quiet panels and the spreadsheet surface
- `#B55218` focused orange for keyboard focus and small status accents

The orange is reserved for focus and attention. Teal carries actions. Navy carries reading text. This keeps the interface readable without turning the page into a dark theme.

## Type

The site uses the system stack `Avenir Next`, `Trebuchet MS`, `Arial`, sans-serif. Avenir Next gives the headings a friendly utility feel on macOS. Trebuchet MS and Arial keep the layout usable on systems without it. No external font request is needed.

## Layout

The layout stays left aligned inside a narrow reading column. On wide screens the hero has two columns. The left side explains the saved-question workflow. The right side is a labelled illustration, not a product screenshot or a claim about live data.

```text
site header
  brand                         navigation

main
  hero copy                     saved question panel
    heading                     question title
    short explanation           cell grid: Name | Value | Updated
    action links                honest labels and row lines

  how it works                  short steps, one idea per line
  pricing or support            plain text blocks

footer                          privacy | terms | support
```

Mobile collapses the illustration below the copy and keeps the navigation usable without horizontal scrolling. Focus rings remain visible. Motion is removed when the user prefers reduced motion.

## Review notes

The first generic direction was a centred SaaS hero with three feature cards and a bright gradient button. That was rejected because it says nothing about saved questions or spreadsheet cells. The revised direction uses the saved-question panel and row geometry as the memorable element. It keeps the product explanation concrete and makes the Marketplace and pricing status explicit.
