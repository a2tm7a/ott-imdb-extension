# IMDB Ratings for OTT – Chrome Extension

A Chrome Extension (Manifest V3) that auto-detects movies and TV shows on OTT streaming platforms and overlays their **IMDB ratings as compact badges** directly on the thumbnails — without disrupting the platform's native UI.

---

## High-Level Design (HLD)

### Architecture Overview

The extension is split into three isolated execution contexts that communicate via Chrome's messaging API:

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER                           │
│                                                                 │
│  ┌──────────────────────────────────┐                          │
│  │       NETFLIX PAGE               │                          │
│  │                                  │                          │
│  │  ┌──────────────────────────┐    │     ┌─────────────────┐  │
│  │  │   Content Script         │    │     │ Service Worker  │  │
│  │  │                          │◄───┼────►│                 │  │
│  │  │  base-adapter.js         │    │MSG  │OMDb API calls   │  │
│  │  │  netflix.js              │    │     │In-memory cache  │  │
│  │  │                          │    │     └─────────────────┘  │
│  │  │  • DOM observation       │    │              ▲           │
│  │  │  • Title extraction      │    │              │ HTTPS     │
│  │  │  • Badge injection       │    │              ▼           │
│  │  └──────────────────────────┘    │     ┌─────────────────┐  │
│  │          ▲  injects              │     │   OMDb API      │  │
│  │          │  .imdb-ott-badge      │     │ omdbapi.com     │  │
│  └──────────┼───────────────────────┘     └─────────────────┘  │
│             │                                                   │
│  ┌──────────┴──────────┐          ┌──────────────────────────┐ │
│  │    badge.css        │          │    Popup UI              │ │
│  │  (injected styles)  │          │  popup.html/css/js       │ │
│  └─────────────────────┘          │  • API key management    │ │
│                                   │  • Platform toggles      │ │
│                                   └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | File(s) | Responsibility |
|---|---|---|
| **Content Script** | `netflix.js`, `base-adapter.js` | Runs inside the Netflix page. Detects title cards, extracts show names, injects rating badges into the DOM |
| **Service Worker** | `background/service-worker.js` | Background process. Makes OMDb API calls (avoids CORS), caches results in memory |
| **Popup UI** | `popup/` | Settings panel for API key and per-platform on/off toggles |
| **Badge Styles** | `styles/badge.css` | CSS injected into the OTT page to style the rating overlay |

---

## Request Flow

```
User browses Netflix
       │
       ▼
MutationObserver fires (new card added to DOM)
       │
       ▼
netflix.js: querySelectorAll('a[href*="/watch/"], a[href*="/title/"]')
       │
       ▼
Already processed this card? ──YES──► Skip
       │ NO
       ▼
extractTitleFromCard()
  1. Read aria-label on the <a> element
  2. Fallback: img[alt]
  3. Fallback: img src filename
  4. Clean title (strip "Season 2", "- Netflix", etc.)
       │
       ▼
Title found? ──NO──► Skip (log: "Could not extract title")
       │ YES
       ▼
sendMessage({type: 'FETCH_RATING', title}) ──► Service Worker
       │
       ▼  (Service Worker)
In memory cache hit? ──YES──► Return cached result immediately
       │ NO
       ▼
Query OMDb API as 'movie'
       │
Response === 'False'? ──YES──► Retry as 'series'
       │ NO
       ▼
Return { imdbRating, imdbID, title, year, type }
       │
       ◄── Service Worker responds to Content Script
       │
imdbRating available? ──NO──► Skip (log: "rating unavailable")
       │ YES
       ▼
injectBadge()
  1. Create anchor div (position:absolute, covers card, pointer-events:none)
  2. Create .imdb-ott-badge (★ + rating number)
  3. Apply colour class: gold ≥8.0 / green 6.5–8 / amber <6.5
  4. Insert into DOM as first child of card's <a> element
       │
       ▼
★ 8.7 badge visible on thumbnail (top-right corner)
```

---

## Logic Deep-Dive

### 1. How Cards Are Detected (Netflix)

Netflix frequently renames its CSS classes, so targeting them breaks across UI updates. Instead we use **URL-based detection** — every Netflix title card wraps its artwork in an `<a>` tag with a stable URL pattern:

```
/watch/12345678    ← play link
/title/12345678    ← title detail page
```

These URLs are part of Netflix's routing contract and have been stable for years. Querying `a[href*="/watch/"]` will reliably find every title card regardless of which CSS classes Netflix uses internally.

### 2. How Titles Are Extracted

Netflix sets an `aria-label` on each title `<a>` element for accessibility:

```html
<a href="/watch/80115683" aria-label="Stranger Things">
```

The adapter reads this attribute and cleans it:

```
"Stranger Things: Season 4 - Netflix"
           ↓ cleanTitle()
"Stranger Things"
```

Cleaning rules (applied in order):
- Strip `: Season N`, `- Part N`, etc.
- Strip trailing descriptors (`Limited Series`, `Documentary`)
- Strip `- Netflix` suffix

### 3. Why the Service Worker Handles API Calls

Content scripts cannot call the OMDb API directly due to **CORS restrictions** — browsers block cross-origin requests from page context. The service worker runs in a privileged background context where `fetch()` to any URL is allowed.

The content script sends a Chrome message; the service worker fetches. This is the standard MV3 pattern for external API calls.

### 4. Caching Strategy

Every successful OMDb response is stored in an **in-memory Map** keyed by `"title|year"`:

- **Cache hit**: response returned immediately, **no API call made**
- **Cache lifetime**: as long as the service worker stays alive (~30s idle timeout, restarted on next request)
- **Purpose**: Netflix shows the same titles across many rows. Without caching, "Money Heist" appearing in 5 rows would trigger 5 API calls.

### 5. Why Badges Don't Break Netflix's Layout

Previous versions mutated Netflix's container styles (`overflow: hidden → visible`), which broke Netflix's hover expand animations. The current approach uses an isolated **anchor wrapper**:

```
card <a> (Netflix owns this, we don't touch it)
  └── .imdb-ott-anchor  ← our div: position:absolute, 100%×100%, pointer-events:none
        └── .imdb-ott-badge  ← the ★ rating text
```

The anchor covers the entire card but intercepts no clicks (`pointer-events: none`). Only Netflix's own elements receive mouse events.

### 6. Extensible Adapter Pattern

Each OTT platform is a subclass of `BaseAdapter`:

```
BaseAdapter
├── MutationObserver setup
├── scanExisting()
├── processCard()
├── fetchAndInject()
└── injectBadge()

NetflixAdapter extends BaseAdapter
├── getCardSelector()      → 'a[href*="/watch/"]'
├── extractTitleFromCard() → reads aria-label
└── getBadgeContainer()    → returns the <a> itself

PrimeAdapter extends BaseAdapter   ← future
HotstarAdapter extends BaseAdapter ← future
```

Adding a new platform = implement 3 methods + one entry in `manifest.json`.

---

## Adding a New Platform

```js
// content-scripts/prime.js
class PrimeAdapter extends BaseAdapter {
  constructor() { super('prime'); }
  isActive() { return location.hostname.includes('primevideo.com'); }
  getCardSelector() { return 'a[href*="/detail/"]'; }
  extractTitleFromCard(el) {
    const title = el.getAttribute('aria-label') || el.querySelector('img')?.alt;
    return title ? { title } : null;
  }
}
new PrimeAdapter().start();
```

Then in `manifest.json`, add under `content_scripts`:
```json
{
  "matches": ["*://*.primevideo.com/*"],
  "js": ["content-scripts/base-adapter.js", "content-scripts/prime.js"],
  "css": ["styles/badge.css"]
}
```

---

## Setup

1. Get a free OMDb API key at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (1,000 req/day)
2. Go to `chrome://extensions` → enable **Developer Mode**
3. Click **Load unpacked** → select this folder
4. Click the ★ extension icon → enter API key → **Save**
5. Browse Netflix — badges appear automatically

---

## Debugging

| Where | What you'll see |
|---|---|
| Netflix page console (`Cmd+Opt+J`) | Card detection, title extraction, badge injection logs |
| `chrome://extensions` → Service Worker | OMDb API calls, cache hits, HTTP errors |

Key log messages:

```
[IMDB OTT] scanExisting → found 18 cards (18 new) on netflix   ← cards found
[IMDB OTT] Processing card: "Money Heist"                       ← title extracted
[IMDB OTT] Badge injected: Money Heist → 8.3                   ← badge shown
[IMDB OTT SW] Cache HIT → "money heist|"                       ← no API call needed
[IMDB OTT] Could not extract title from card: ...               ← card skipped
[IMDB OTT] "Foo" not found on OMDb.                            ← rating not available
```
