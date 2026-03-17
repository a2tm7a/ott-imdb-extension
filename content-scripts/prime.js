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

  // Only match <a href="/detail/…"> links that contain a thumbnail <img>.
  // This excludes Play buttons, Watch buttons, and other detail-page links
  // that don't have a poster image inside them.
  getCardSelector() {
    return [
      'a[href*="/detail/"]:has(img)',
      'a[href*="/gp/video/detail/"]:has(img)',
    ].join(', ');
  }

  // Place the badge on the <img>'s direct parent so it sits squarely
  // on the poster thumbnail rather than on a wide card wrapper.
  getBadgeContainer(cardElement) {
    const img = cardElement.querySelector('img');
    if (img && img.parentElement) {
      return img.parentElement;
    }
    return cardElement;
  }

  extractTitleFromCard(cardElement) {
    // Reject pure Play / Watch buttons — they share the same /detail/ href
    // but their aria-label is something like "Play Dating & New York" or
    // "Watch now". We only want the thumbnail card links.
    const selfLabel = (cardElement.getAttribute('aria-label') || '').toLowerCase();
    if (/^\s*(play|watch|resume|continue)\b/i.test(selfLabel)) {
      return null;
    }

    // aria-label on the <a> is the most reliable signal.
    // Prime Video typically sets it to the title name.
    const img = cardElement.querySelector('img');
    const candidates = [
      cardElement.getAttribute('aria-label'),
      cardElement.querySelector('[aria-label]')?.getAttribute('aria-label'),
      img?.getAttribute('alt'),
      img?.getAttribute('title'),
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
          adapter.processedCards = new WeakMap();
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
