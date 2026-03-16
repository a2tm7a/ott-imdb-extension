// ============================================================
// Netflix Adapter – extends BaseAdapter for Netflix's DOM.
//
// Strategy: Netflix's class names change constantly. Instead
// of targeting classes, we detect title cards by their <a>
// links (href contains /watch/ or /title/) and extract titles
// from aria-label attributes — both are stable across UI changes.
// ============================================================

class NetflixAdapter extends BaseAdapter {
  constructor() {
    super('netflix');
  }

  isActive() {
    return location.hostname.includes('netflix.com');
  }

  // Target the <a> link element inside each card.
  // Netflix always wraps each title in an anchor with /watch/ or /title/ href.
  getCardSelector() {
    return [
      'a[href*="/watch/"]',
      'a[href*="/title/"]',
    ].join(', ');
  }

  // The badge container is the <a> element itself (it already
  // has position:relative in Netflix's own CSS for its overlays).
  getBadgeContainer(cardElement) {
    return cardElement;
  }

  extractTitleFromCard(cardElement) {
    // Only process <a> elements that wrap an image (poster/thumbnail cards).
    // Info-section links inside the hover popup (e.g. the title text link) also
    // match our href selector but contain no <img>, so they would get a badge
    // injected into the info bar at the wrong position.
    if (!cardElement.querySelector('img')) return null;

    // Resolve aria-labelledby if present.
    const labelledById = cardElement.getAttribute('aria-labelledby');
    const labelledByText = labelledById
      ? document.getElementById(labelledById)?.textContent?.trim()
      : null;

    const candidates = [
      // Most reliable: aria-label on the <a> itself.
      cardElement.getAttribute('aria-label'),
      // aria-labelledby target.
      labelledByText,
      // HTML title attribute (sometimes used instead of aria-label).
      cardElement.getAttribute('title'),
      // Parent wrapper may carry aria-label on some card layouts.
      cardElement.parentElement?.getAttribute('aria-label'),
      // Inner element with aria-label (e.g. a nested visually-hidden span).
      cardElement.querySelector('[aria-label]')?.getAttribute('aria-label'),
      // Netflix renders a text title div in some layouts (even when visually
      // hidden) — class names contain "fallback-text" or "title".
      cardElement.querySelector('[class*="fallback-text"]')?.textContent?.trim(),
      // Image alt text.
      cardElement.querySelector('img')?.getAttribute('alt'),
    ];

    for (const candidate of candidates) {
      const title = candidate?.trim();
      if (title && title.length > 1 && title.length < 150) {
        const cleaned = this.cleanTitle(title);
        if (cleaned.length > 1) {
          return { title: cleaned };
        }
      }
    }

    return null;
  }

  cleanTitle(raw) {
    return raw
      // Separator + season keyword + number: "Show: Season 2", "Show - Series 1"
      .replace(/\s*[:\-–]\s*(season|part|volume|series|episode)\s*\d+.*/i, '')
      // Space-only separator (no colon/dash): "Breaking Bad Season 5",
      // "Brooklyn Nine-Nine Season 7", "Show S2E1"
      .replace(/\s+(season|series)\s+\d+.*/i, '')
      .replace(/\s+S\d{1,2}(E\d+|[\s:,]|$).*/i, '')
      // Year in parentheses: "Show (2013)"
      .replace(/\s*\(\d{4}\)\s*$/, '')
      // Trailing descriptors
      .replace(/\s*(limited series|miniseries|documentary|film)$/i, '')
      .replace(/\s*[-–]\s*Netflix\s*$/i, '')
      .trim();
  }
}

// ── Constants ──────────────────────────────────────────────

const INITIAL_SCAN_RETRIES = 5;
const INITIAL_SCAN_INTERVAL_MS = 2000;
const NAV_SCAN_RETRIES = 4;
const NAV_SCAN_INTERVAL_MS = 1500;
const NAV_SCAN_DELAY_MS = 1500;

// ── Bootstrap ──────────────────────────────────────────────

(async function () {
  try {
    const settings = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(['enabledPlatforms', 'omdbApiKey'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });

    const enabled = settings.enabledPlatforms?.netflix !== false;
    const hasKey = !!settings.omdbApiKey;

    if (!enabled) {
      console.log('[IMDB OTT] Netflix disabled by user settings.');
      return;
    }

    if (!hasKey) {
      console.warn('[IMDB OTT] No OMDb API key set. Open the extension popup to add one.');
      return;
    }

    console.log('[IMDB OTT] Netflix adapter initialising…');

    const adapter = new NetflixAdapter();
    adapter.start();

    // Retry scan a few times — Netflix renders cards progressively
    let retries = 0;
    const retryInterval = setInterval(() => {
      adapter.scanExisting();
      retries++;
      if (retries >= INITIAL_SCAN_RETRIES) clearInterval(retryInterval);
    }, INITIAL_SCAN_INTERVAL_MS);

    // SPA navigation — watch for URL changes
    let lastUrl = location.href;
    let navRetryInterval = null;
    const navObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[IMDB OTT] Page navigated to:', lastUrl);
        setTimeout(() => {
          adapter.processedCards = new WeakSet();
          adapter.scanExisting();

          let navRetries = 0;
          if (navRetryInterval) clearInterval(navRetryInterval);
          navRetryInterval = setInterval(() => {
            adapter.scanExisting();
            navRetries++;
            if (navRetries >= NAV_SCAN_RETRIES) {
              clearInterval(navRetryInterval);
              navRetryInterval = null;
            }
          }, NAV_SCAN_INTERVAL_MS);
        }, NAV_SCAN_DELAY_MS);
      }
    });

    navObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
    });

    // React to settings changes (e.g. platform toggled off from popup)
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'SETTINGS_UPDATED' && message.enabledPlatforms?.netflix === false) {
        console.log('[IMDB OTT] Netflix disabled via settings — stopping adapter and clearing badges.');
        adapter.stop();
        navObserver.disconnect();
        if (navRetryInterval) clearInterval(navRetryInterval);
      }
    });

    console.log('[IMDB OTT] Netflix adapter ready.');
  } catch (err) {
    console.error('[IMDB OTT] Netflix adapter failed to initialise:', err.message);
  }
})();
