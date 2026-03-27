# IMDB Ratings for OTT — Chrome Extension

> **Stop watching bad movies.** Get IMDb ratings directly on thumbnails for Netflix, Prime Video, and Hotstar — before you click play.

---

## 🎬 What It Does

Browsing streaming platforms and can't decide what to watch? This extension **automatically overlays IMDb ratings as color-coded badges** on every title card. No more opening new tabs, no more guessing, and no more disappointing 90-minute commitments.

Badges are color-coded for instant decision making:

| Tier | Rating | Color |
|------|--------|-------|
| 💎 **Great** | ≥ 8.0 | 🟢 Green |
| ✅ **Good** | 6.5 – 7.9 | 🔵 Blue |
| ⚠️ **Poor** | < 6.5 | 🔴 Red |

---

## 🌟 IMDb Badge Legend

The extension uses color-coded badges to help you make decisions in milliseconds:

### Success States (Ratings Found)
| Badge Style | Score | Quality Tier |
|:---:|:---:|:---|
| **★ 8.0+** | 🟢 | **Must Watch** — High-rated "Great" content. |
| **★ 6.5–7.9** | 🔵 | **Solid Pick** — "Good" and reliable entertainment. |
| **★ < 6.5** | 🔴 | **Proceed with Caution** — Lower-rated or niche content. |

### Fallback States (Gray/Muted)
When a numerical rating isn't available, these symbols explain why:
| Icon | Status | Meaning |
|:---:|:---|:---|
| **★ ?** | **Unknown** | The title could not be identified on IMDb (Search failed). |
| **★ N/A** | **Data Missing** | Metadata found, but no rating exists yet (Upcoming/Obscure). |
| **★ —** | **Error** | A technical connection failure or network timeout occurred. |
---

## ✨ Key Features

- **Multi-Platform Support** — Full coverage for **Netflix**, **Amazon Prime Video**, and **Disney+ Hotstar**.
- **SPA-Optimized** — Advanced `MutationObserver` logic handles infinite scrolling and lazy-loaded content (essential for modern React-based streaming apps).
- **Intelligent Quota Monitoring** — Automatically detects when you hit your OMDb 1,000 requests/day limit and notifies you in the console/popup.
- **Non-Invasive UI** — Custom-engineered badge placement that doesn't interfere with platform-native hover effects or expand animations.
- **Smart Caching** — Every title is cached in memory per session to ensure zero redundant API calls and lightning-fast scrolling.
- **Adaptive Injector** — Handles complex DOM structures like `<picture>` tags and nested hero banners without breaking site layouts.

---

## 🛠️ Tech Stack

- **Extension**: Chrome Manifest V3 (MV3)
- **Logic**: Vanilla JavaScript (Zero dependencies)
- **API**: OMDb API (Open Movie Database)
- **Styling**: BEM-architected CSS with isolation to prevent site style leakage.
- **Testing**: Jest + JSDOM with 90+ comprehensive test cases.

---

## 🚀 Quick Setup (2 minutes)

### 1. Get a free OMDb API key
Register at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx).
*The free tier provides **1,000 requests per day**, which resets every 24 hours.*

### 2. Load the Extension
1. Download or clone this repository.
2. Open `chrome://extensions` in your browser.
3. Enable **Developer Mode** (toggle in the top-right).
4. Click **Load unpacked** and select the project folder.

### 3. Configure
1. Click the ★ icon in your Chrome toolbar.
2. Paste your API key and click **Save Settings**.
3. (Optional) Toggle specific platforms on or off.

---

## 🧬 Architecture: The Adapter Pattern

The project is built on a highly modular **Adapter Pattern**, making it trivial to add support for new streaming sites in under 20 lines of code.

| Component | Responsibility |
|---|---|
| `BaseAdapter` | Core lifecycle, DOM observation, caching, and badge injection logic. |
| `PlatformAdapters` | Site-specific logic (selectors, title extraction, custom badge placement). |
| `Service Worker` | Handles secure API communication and handles OMDb rate limits. |
| `Popup` | Secure storage of API keys and per-platform configuration. |

---

## 🔬 Reliability & Testing

The extension includes a robust test suite to ensure stability across frequent streaming site updates.

- **Unit Tests**: Full coverage for every platform adapter's extraction logic.
- **Edge Cases**: Handled fallback badges for missing ratings, upcoming titles (e.g., 2026 releases), and title cleaning.
- **Integration Tests**: Live network verification script to validate OMDb API keys.
- **CI Ready**: Run `npm test` to verify the entire 94-test pipeline.

---

## 💡 Troubleshooting

| Issue | Cause | Status Symbol |
|---|---|:---:|
| **Title Unknown** | OMDb search failed for that exact name | **★ ?** |
| **Rating Missing** | Found title but no rating score exists yet | **★ N/A** |
| **Network Error** | Connection failed or technical timeout | **★ —** |
| **No badges appear** | API Key missing or Invalid | (Silent) |
| **Rate limit reach** | 1,000 daily request limit reached | (Silent) |

---

## 📜 License

[MIT](LICENSE) — Created with ❤️ for movie buffs everywhere.
