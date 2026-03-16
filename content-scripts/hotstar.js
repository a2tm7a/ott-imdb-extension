// ============================================================
// Hotstar Adapter – extends BaseAdapter for Disney+ Hotstar.
//
// Strategy: Hotstar's CSS class names can change, so we target
// cards by their <a> links (href contains /movies/, /shows/, or
// /sports/) and extract titles from aria-label or img alt attrs
// — both are stable across UI changes.
// ============================================================

class HotstarAdapter extends BaseAdapter {
  constructor() {
    super('hotstar');
  }

  isActive() {
    return location.hostname.includes('hotstar.com');
  }

  // Target anchor elements that link to content detail pages.
  getCardSelector() {
    return [
      'a[href*="/movies/"]',
      'a[href*="/shows/"]',
      'a[href*="/sports/"]',
      'a[href*="/episode/"]',
    ].join(', ');
  }

  // The badge container is the <a> element itself.
  getBadgeContainer(cardElement) {
    return cardElement;
  }

  extractTitleFromCard(cardElement) {
    const candidates = [
      cardElement.getAttribute('aria-label'),
      cardElement.querySelector('[aria-label]')?.getAttribute('aria-label'),
      cardElement.querySelector('img')?.getAttribute('alt'),
      cardElement.querySelector('p')?.textContent,
      cardElement.querySelector('span')?.textContent,
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
      .replace(/\s*[:\-–]\s*(season|part|volume|series|episode)\s*\d+.*/i, '')
      .replace(/\s*(limited series|miniseries|documentary|film|trailer|teaser)$/i, '')
      .replace(/\s*[-–]\s*hotstar\s*$/i, '')
      .replace(/\s*[-–]\s*disney\+?\s*$/i, '')
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

    const enabled = settings.enabledPlatforms?.hotstar !== false;
    const hasKey = !!settings.omdbApiKey;

    if (!enabled) {
      console.log('[IMDB OTT] Hotstar disabled by user settings.');
      return;
    }

    if (!hasKey) {
      console.warn('[IMDB OTT] No OMDb API key set. Open the extension popup to add one.');
      return;
    }

    console.log('[IMDB OTT] Hotstar adapter initialising…');

    const adapter = new HotstarAdapter();
    adapter.start();

    // Retry scan a few times — Hotstar renders cards progressively
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
      if (message.type === 'SETTINGS_UPDATED' && message.enabledPlatforms?.hotstar === false) {
        console.log('[IMDB OTT] Hotstar disabled via settings — stopping adapter and clearing badges.');
        adapter.stop();
        navObserver.disconnect();
        if (navRetryInterval) clearInterval(navRetryInterval);
      }
    });

    console.log('[IMDB OTT] Hotstar adapter ready.');
  } catch (err) {
    console.error('[IMDB OTT] Hotstar adapter failed to initialise:', err.message);
  }
})();
