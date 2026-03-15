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
    // aria-label on the <a> is the most reliable signal.
    // Netflix sets it to the show/movie title.
    const candidates = [
      cardElement.getAttribute('aria-label'),
      cardElement.querySelector('[aria-label]')?.getAttribute('aria-label'),
      cardElement.querySelector('img')?.getAttribute('alt'),
      cardElement.querySelector('img')?.getAttribute('src')?.match(/\/([^/]+)\.(jpg|webp)/)?.[1]?.replace(/-/g, ' '),
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
      .replace(/\s*[-–]\s*Netflix\s*$/i, '')
      .trim();
  }
}

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
      if (retries >= 5) clearInterval(retryInterval);
    }, 2000);

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
            if (navRetries >= 4) {
              clearInterval(navRetryInterval);
              navRetryInterval = null;
            }
          }, 1500);
        }, 1500);
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
