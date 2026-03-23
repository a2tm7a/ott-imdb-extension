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

  // Target the <a> link element inside each card AND the hero billboard container.
  // We explicitly exclude the navigation header to avoid "N/A" badges on menu items.
  getCardSelector() {
    return [
      'main a[href*="/watch/"]',
      'main a[href*="/title/"]',
      '.bd a[href*="/watch/"]', // fallback for some layouts
      '.bd a[href*="/title/"]',
      // Hero/billboard banner (the big featured title at top of home page)
      '[class*="billboard"]',
      '[class*="hero-tab-header"]',
    ].join(', ');
  }

  extractTitleFromCard(cardElement) {
    const isHero = this._isHeroElement(cardElement);

    // If this is a regular <a> link, check if it's already inside a billboard we are processing.
    // We check for many possible hero container classes to be safe.
    if (!isHero) {
      if (cardElement.closest('[class*="billboard"], [class*="hero"], [class*="billed-board"], [class*="Hero"]')) {
        return null;
      }
      // For regular <a> cards: only process those that wrap an image (poster/thumbnail cards).
      if (!cardElement.querySelector('img')) return null;
    } else {
      // If this is a hero element but it is nested INSIDE another hero element 
      // (e.g. .hero-tab-header nested inside .billboard-row), ignore the inner one 
      // so we don't double inject badges in the hero section.
      if (cardElement.parentElement && cardElement.parentElement.closest('[class*="billboard"], [class*="hero"], [class*="billed-board"], [class*="Hero"]')) {
        return null;
      }
    }

    // Resolve aria-labelledby if present.
    const labelledById = cardElement.getAttribute('aria-labelledby');
    const labelledByText = labelledById
      ? document.getElementById(labelledById)?.textContent?.trim()
      : null;

    const candidates = [
      // Most reliable: aria-label on the element itself.
      cardElement.getAttribute('aria-label'),
      // aria-labelledby target.
      labelledByText,
      // HTML title attribute (sometimes used instead of aria-label).
      cardElement.getAttribute('title'),
      // Parent wrapper may carry aria-label on some card layouts (e.g. <li> wrapping <a>).
      cardElement.parentElement?.getAttribute('aria-label'),
      cardElement.parentElement?.parentElement?.getAttribute('aria-label'),
      // Inner element with aria-label (e.g. a nested visually-hidden span).
      cardElement.querySelector('[aria-label]')?.getAttribute('aria-label'),
      // Netflix renders a text title div in some layouts (even when visually
      // hidden) — class names contain "fallback-text" or "title".
      cardElement.querySelector('[class*="fallback-text"]')?.textContent?.trim(),
      cardElement.querySelector('[class*="title-card-title"]')?.textContent?.trim(),
      cardElement.querySelector('[class*="logo-text"]')?.textContent?.trim(),
      // Hero billboard: title is often in an <img alt="Title"> logo or a heading.
      ...(isHero ? [
        cardElement.querySelector('img[alt]')?.getAttribute('alt'),
        cardElement.querySelector('h1, h2, h3')?.textContent?.trim(),
        // The play button aria-label on the hero often reads "Play {Title}"
        cardElement.querySelector('[aria-label*="Play"]')?.getAttribute('aria-label')?.replace(/^Play\s+/i, ''),
      ] : [
        // Image alt text (for regular thumbnail cards).
        cardElement.querySelector('img')?.getAttribute('alt'),
      ]),
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

  /** Returns true if the element is the hero/billboard banner rather than a thumbnail card. */
  _isHeroElement(el) {
    const cls = el.className || '';
    // Netflix uses billboard, hero-v2, hero-tab-header, etc.
    return /billboard|hero|billed-board/i.test(cls);
  }

  /**
   * For hero elements, inject the badge into a stable child container.
   * Prioritizes metadata and wrapper containers over text areas like synopsis.
   */
  getBadgeContainer(cardElement) {
    if (this._isHeroElement(cardElement)) {
      return (
        cardElement.querySelector('[class*="info-wrapper"]') ||
        cardElement.querySelector('[class*="info-container"]') ||
        cardElement.querySelector('[class*="meta-data-container"]') ||
        cardElement.querySelector('[class*="metadata"]') ||
        cardElement.querySelector('[class*="helper-container"]') ||
        cardElement
      );
    }
    return cardElement;
  }

  cleanTitle(raw) {
    return raw
      // Handle comma-separated metadata if present (e.g. "Virgin River, New Season")
      .replace(/,.*$/, '')
      // Separator + season keyword + number: "Show: Season 2", "Show - Series 1"
      .replace(/\s*[:\-–]\s*(season|part|volume|series|episode)\s*\d+.*/i, '')
      // Space-only separator (no colon/dash): "Breaking Bad Season 5",
      // "Brooklyn Nine-Nine Season 7", "Show S2E1"
      .replace(/\s+(season|series)\s+\d+.*/i, '')
      .replace(/\s+S\d{1,2}(E\d+|[\s:,]|$).*/i, '')
      // Year in parentheses: "Show (2013)"
      .replace(/\s*\(\d{4}\)\s*$/, '')
      // Trailing descriptors
      .replace(/\s*(limited series|miniseries|documentary|film|new season|new episodes?)$/i, '')
      .replace(/\s*[-–]\s*Netflix\s*$/i, '')
      // Clean up any trailing punctuation or whitespace left over
      .replace(/[:\-–,]+$/, '')
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
