# IMDB Ratings for OTT — Chrome Extension

> **Stop watching bad movies.** Get IMDB ratings directly on Netflix thumbnails — before you click play.

---

## What It Does

Browsing Netflix and can't decide what to watch? This extension **automatically overlays IMDB ratings as badges on every title card** — no more opening new tabs, no more guessing, no more disappointing 90-minute commitments.

**Before → After:**

```
┌──────────────┐      ┌──────────────┐
│              │      │  ★ 8.7       │
│  [Thumbnail] │  →   │  [Thumbnail] │
│              │      │              │
│  Movie Title │      │  Movie Title │
└──────────────┘      └──────────────┘
```

Badges are color-coded at a glance:
- **Gold** ★ — IMDB ≥ 8.0 (watch this!)
- **Green** ★ — IMDB 6.5–8.0 (solid pick)
- **Amber** ★ — IMDB < 6.5 (proceed with caution)

---

## Features

- **Zero friction** — badges appear automatically as you scroll, no clicks needed
- **Non-invasive UI** — overlays are pointer-events:none, so Netflix hover/expand animations work perfectly
- **Smart caching** — each title is only looked up once per session; no redundant API calls
- **SPA-aware** — follows Netflix's client-side navigation, so browsing rows always stays fresh
- **Extensible** — built with an adapter pattern; adding Prime Video or Hotstar is ~20 lines of code

---

## Installation (2 minutes)

### Step 1 — Get a free OMDb API key
Go to [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) and register.
Free tier: **1,000 requests/day** — plenty for casual browsing.

### Step 2 — Load the extension in Chrome
1. Download or clone this repo
2. Open `chrome://extensions` in your browser
3. Toggle on **Developer Mode** (top-right)
4. Click **Load unpacked** → select the project folder

### Step 3 — Enter your API key
1. Click the ★ extension icon in your Chrome toolbar
2. Paste your OMDb API key and hit **Save**

### Step 4 — Browse Netflix
Open [netflix.com](https://netflix.com) and scroll. Ratings appear automatically on every title card.

---

## How It Works

The extension runs a `MutationObserver` that detects new title cards as Netflix loads them. It extracts titles from stable `aria-label` attributes (immune to Netflix's frequent CSS class renames), sends a lookup to a background service worker, which calls the OMDb API and caches results in memory. On a hit, a badge is injected directly into the card's DOM.

```
Scroll Netflix → Card detected → Title extracted → OMDb lookup (cached) → Badge injected
```

No page data is read or transmitted beyond title strings used for rating lookups.

---

## Architecture

The extension follows Chrome's MV3 architecture with three isolated contexts:

| Component | File(s) | Role |
|---|---|---|
| Content Script | `netflix.js`, `base-adapter.js` | DOM observation, title extraction, badge injection |
| Service Worker | `background/service-worker.js` | OMDb API calls, in-memory cache |
| Popup UI | `popup/` | API key input, per-platform toggle |
| Badge Styles | `styles/badge.css` | Injected CSS for the overlay |

---

## Adding a New Platform

The adapter pattern makes new platforms trivial to add:

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

Then register it in `manifest.json`. That's it.

---

## Debugging

| Where | What to look for |
|---|---|
| Netflix page console (`Cmd+Opt+J`) | Card detection, title extraction, badge injection |
| `chrome://extensions` → Service Worker | OMDb API calls, cache hits, errors |

Key log messages:
```
[IMDB OTT] scanExisting → found 18 cards on netflix
[IMDB OTT] Badge injected: Money Heist → 8.3
[IMDB OTT SW] Cache HIT → "money heist|"
[IMDB OTT] Could not extract title from card   ← card skipped (no aria-label)
```

---

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JS (zero dependencies)
- OMDb API (free tier)
- CSS injected via content scripts

---

## Contributing

Platform adapters, bug fixes, and UI improvements are welcome. Open an issue or PR.

---

## License

MIT
