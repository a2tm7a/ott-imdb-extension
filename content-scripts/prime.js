// ============================================================
// Prime Video Adapter – extends BaseAdapter for Amazon Prime
// Video's DOM.
//
// Strategy: Prime Video's CSS class names are unstable. Instead
// we detect title cards by their <a> links (href contains
// /detail/) and extract titles from aria-label attributes and
// img alt text — both are stable across UI changes.
// ============================================================

class PrimeVideoAdapter extends BaseAdapter {
  constructor() {
    super('prime');
  }

  isActive() {
    return location.hostname.includes('primevideo.com') || location.hostname.includes('amazon.com');
  }

  // Target <a> elements that link to a title detail page.
  // Prime Video consistently uses /detail/<ASIN>/ URLs for all title cards.
  getCardSelector() {
    return [
      'a[href*="/detail/"]',
      'a[href*="/gp/video/detail/"]',
    ].join(', ');
  }

  // The badge container is the <a> element itself.
  getBadgeContainer(cardElement) {
    return cardElement;
  }

  extractTitleFromCard(cardElement) {
    // aria-label on the <a> is the most reliable signal.
    // Prime Video typically sets it to the title name.
    const candidates = [
      cardElement.getAttribute('aria-label'),
      cardElement.querySelector('[aria-label]')?.getAttribute('aria-label'),
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
      .replace(/\s*[:\-–]\s*(season|part|volume|series|episode)\s*\d+.*/i, '')
      .replace(/\s*(limited series|miniseries|documentary|film)$/i, '')
      .replace(/\s*[-–]\s*(amazon|prime\s*video)\s*$/i, '')
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

    const enabled = settings.enabledPlatforms?.prime !== false;
    const hasKey = !!settings.omdbApiKey;

    if (!enabled) {
      console.log('[IMDB OTT] Prime Video disabled by user settings.');
      return;
    }

    if (!hasKey) {
      console.warn('[IMDB OTT] No OMDb API key set. Open the extension popup to add one.');
      return;
    }

    console.log('[IMDB OTT] Prime Video adapter initialising…');

    const adapter = new PrimeVideoAdapter();
    adapter.start();

    // Retry scan a few times — Prime Video renders cards progressively
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
      if (message.type === 'SETTINGS_UPDATED' && message.enabledPlatforms?.prime === false) {
        console.log('[IMDB OTT] Prime Video disabled via settings — stopping adapter and clearing badges.');
        adapter.stop();
        navObserver.disconnect();
        if (navRetryInterval) clearInterval(navRetryInterval);
      }
    });

    console.log('[IMDB OTT] Prime Video adapter ready.');
  } catch (err) {
    console.error('[IMDB OTT] Prime Video adapter failed to initialise:', err.message);
  }
})();
