# IMDB Ratings for OTT – Chrome Extension

A Chrome extension (Manifest V3) that auto-detects movies and TV shows on OTT streaming platforms and overlays their **IMDB ratings as sleek badges** directly on the thumbnails.

## ✨ Features

- ⭐ Real-time IMDB ratings overlaid on Netflix thumbnails
- 🎨 Color-coded badges: **Gold ≥ 8.0**, **Green 6.5–8**, **Amber < 6.5**
- 🔗 Click any badge to open the IMDB title page
- 🔄 Works with Netflix's SPA navigation (React-based)
- ⚡ Session caching — no duplicate API calls
- 🧩 Extensible adapter architecture (Prime Video, Hotstar ready)

## 🚀 Setup

### 1. Get a Free OMDb API Key
Sign up at **https://www.omdbapi.com/apikey.aspx** (free tier: 1,000 req/day).

### 2. Load the Extension in Chrome

1. Open **chrome://extensions**
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder: `OTT IMDB integration/`

### 3. Add Your API Key

1. Click the extension icon in the Chrome toolbar
2. Paste your OMDb API key
3. Click **Save Settings**

### 4. Browse Netflix!

Navigate to [netflix.com](https://www.netflix.com) — ratings will appear on thumbnails within a second or two of hover/scroll.

---

## 📁 Project Structure

```
OTT IMDB integration/
├── manifest.json                  # Manifest V3 config
├── background/
│   └── service-worker.js          # OMDb API calls + caching
├── content-scripts/
│   ├── base-adapter.js            # Abstract OTT adapter (MutationObserver + badge injection)
│   └── netflix.js                 # Netflix-specific DOM scraping
├── popup/
│   ├── popup.html                 # Extension popup UI
│   ├── popup.css                  # Premium dark-mode styles
│   └── popup.js                   # Settings load/save logic
├── styles/
│   └── badge.css                  # Injected badge overlay styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🔌 Adding a New Platform

1. Create a new file `content-scripts/prime.js` (or hotstar, etc.)
2. Extend `BaseAdapter`:

```js
class PrimeAdapter extends BaseAdapter {
  constructor() { super('prime'); }
  isActive() { return location.hostname.includes('primevideo.com'); }
  getCardSelector() { return '.a-section.aok-relative'; }
  extractTitleFromCard(card) {
    const title = card.querySelector('[aria-label]')?.getAttribute('aria-label');
    return title ? { title } : null;
  }
}
const adapter = new PrimeAdapter();
adapter.start();
```

3. Add it to `manifest.json` under `content_scripts`

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Extension API | Chrome Manifest V3 |
| Ratings source | [OMDb API](https://www.omdbapi.com/) |
| DOM observation | MutationObserver |
| Storage | `chrome.storage.sync` + `chrome.storage.session` |
| Styling | Vanilla CSS, Inter font, glassmorphism |

---

## ⚠️ Notes

- OMDb free tier: **1,000 requests/day**. Session caching keeps this well within limits.
- Netflix's DOM changes frequently — if badges stop appearing, check `content-scripts/netflix.js` selectors.
- This extension does **not** collect or transmit any personal data.
