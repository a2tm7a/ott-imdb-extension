// ============================================================
// Netflix Adapter – extends BaseAdapter for Netflix's DOM.
//
// Netflix's React SPA changes its DOM frequently. We use a
// broad set of selectors and multiple title-extraction methods
// so the adapter stays resilient across UI changes.
// ============================================================

class NetflixAdapter extends BaseAdapter {
  constructor() {
    super('netflix');
    this._retryTimer = null;
  }

  isActive() {
    return location.hostname.includes('netflix.com');
  }

  // Netflix renders thumbnail cards in rows; we target the
  // outermost focusable/interactive wrapper for each title.
  // These selectors cover browse, search, and billboard areas.
  getCardSelector() {
    return [
      // Current Netflix UI (2024–2025)
      '.title-card-container',
      '.slider-item',
      '.ptrack-content',
      // Older / alternate UI
      '.title-card',
      '.jawbone-title-card',
      '[data-uia="title-card"]',
      // Fallback: any list item inside a lolomo row
      '.lolomo .slick-slide',
      '.lolomo li',
      // Search results
      '.title-list-card',
    ].join(', ');
  }

  getBadgeContainer(cardElement) {
    // We need a container that has position:relative in our CSS
    // and is not clipped. The image element's parent is usually best.
    return (
      cardElement.querySelector('.boxart-container') ||
      cardElement.querySelector('.boxart-image-in-padded-container') ||
      cardElement.querySelector('.boxart-size-16x9') ||
      cardElement.querySelector('.fallback-text-container') ||
      cardElement.querySelector('img')?.closest('div') ||
      cardElement
    );
  }

  extractTitleFromCard(cardElement) {
    // Priority-ordered: aria-label > fallback-text > img alt > any visible text
    const candidates = [
      // Most reliable — Netflix sets aria-label on focusable elements
      cardElement.getAttribute('aria-label'),
      cardElement.querySelector('a[aria-label]')?.getAttribute('aria-label'),
      cardElement.querySelector('[aria-label]')?.getAttribute('aria-label'),
      // Visible text elements
      cardElement.querySelector('.fallback-text')?.textContent,
      cardElement.querySelector('.title-card-title-text')?.textContent,
      cardElement.querySelector('.title')?.textContent,
      // Image alt
      cardElement.querySelector('img[alt]')?.getAttribute('alt'),
    ];

    for (const candidate of candidates) {
      const title = candidate?.trim();
      if (title && title.length > 1 && title.length < 150) {
        const cleaned = this.cleanTitle(title);
        if (cleaned.length > 1) return { title: cleaned };
      }
    }

    return null;
  }

  cleanTitle(raw) {
    return raw
      // Remove "Season 2", "Part 3", etc.
      .replace(/\s*[:\-–]\s*(season|part|volume|series|episode)\s*\d+.*/i, '')
      // Remove trailing type descriptors
      .replace(/\s*(limited series|miniseries|documentary|film)$/i, '')
      // Netflix sometimes appends " - Netflix" to aria-labels
      .replace(/\s*[-–]\s*Netflix\s*$/i, '')
      .trim();
  }
}

// ── Bootstrap ──────────────────────────────────────────────

(async function () {
  // Wait for settings
  const settings = await new Promise((resolve) => {
    chrome.storage.sync.get(['enabledPlatforms', 'omdbApiKey'], resolve);
  });

  const enabled = settings.enabledPlatforms?.netflix !== false; // default: on
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

  // Retry scan a few times for slow-loading React renders
  // (document_idle fires before Netflix's app fully renders cards)
  let retries = 0;
  const retryInterval = setInterval(() => {
    adapter.scanExisting();
    retries++;
    if (retries >= 5) clearInterval(retryInterval);
  }, 2000); // scan every 2s for the first 10s

  // ── SPA navigation (pushState / replaceState) ─────────────
  // MutationObserver on document.documentElement (not document itself)
  // watches for URL changes triggered by React router.
  let lastUrl = location.href;
  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[IMDB OTT] Page navigated to:', lastUrl);
      // Reset and re-scan after React renders the new page's content
      setTimeout(() => {
        adapter.processedCards = new WeakSet(); // reset seen cards
        adapter.scanExisting();

        // Retry a few more times for the new page
        let navRetries = 0;
        const navRetryInterval = setInterval(() => {
          adapter.scanExisting();
          navRetries++;
          if (navRetries >= 4) clearInterval(navRetryInterval);
        }, 1500);
      }, 1500);
    }
  });

  navObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
  });

  console.log('[IMDB OTT] Netflix adapter ready.');
})();
