// ============================================================
// Prime Video Adapter – extends BaseAdapter for Amazon Prime
// Video's DOM.
//
// Strategy (multi-layer title extraction):
//  1. "Featured Originals" cards expose titles via aria-label on <a> → extracted directly.
//  2. "More details for X" buttons carry the title in their aria-label → parsed out.
//  3. Standard carousel cards (class detailLink-*) have NO aria-label and often
//     NO img alt. The title lives in React's internal component props (not rendered
//     to DOM text). We read it from the __reactFiber$ property React attaches to
//     every DOM node — zero events, zero re-renders.
//  4. Deep string search: if specific prop keys fail, we recursively scan all string
//     values in the fiber tree for plausible movie titles.
//  5. URL slug extraction: as a last resort, we parse readable slugs from the href.
// ============================================================

class PrimeVideoAdapter extends BaseAdapter {
  constructor() {
    super('prime');
  }

  isActive() {
    return location.hostname.includes('primevideo.com') || location.hostname.includes('amazon.com');
  }

  getCardSelector() {
    return [
      'a[href*="/detail"]',
      'a[href*="/dp/"]',
      'a[href*="/gp/video/detail"]'
    ].join(', ');
  }

  getBadgeContainer(cardElement) {
    // Instead of attaching to the outermost <a> link (where Prime might clip it via overflow: hidden),
    // we drill down right to the image wrapper so the absolute coordinates lay directly on top of the poster!
    const img = cardElement.querySelector('img');
    if (img && img.parentElement) {
      if (img.parentElement.tagName.toLowerCase() === 'picture') {
        return img.parentElement.parentElement;
      }
      return img.parentElement;
    }
    return cardElement;
  }

  // ── Override processCard: static DOM first, then React fiber read ─────────

  processCard(cardElement) {
    // Fast path: synchronous DOM extraction (Featured Originals / aria-label cards)
    const quickTitle = this._extractStaticTitle(cardElement);
    if (quickTitle) {
      console.log(`[IMDB OTT][CARD] Skip fiber: static extraction succeeded for ${cardElement.href} → "${quickTitle.title}"`);
      super.processCard(cardElement);
      return;
    }

    // Skip if already processed
    if (this.processedCards.has(cardElement)) {
      return;
    }

    // Read title from React's internal fiber tree — no events, no re-renders
    const fiberTitle = this._extractFromReactFiber(cardElement);

    if (fiberTitle) {
      console.log('[IMDB OTT][FIBER]', cardElement.href?.split('?')[0], '→', fiberTitle);
      cardElement.dataset.imdbTitle = fiberTitle;
      super.processCard(cardElement);
      return;
    }

    // Last resort: try to extract a readable title from the URL slug
    const slugTitle = this._extractTitleFromHref(cardElement.href);
    if (slugTitle) {
      console.log('[IMDB OTT][SLUG]', cardElement.href?.split('?')[0], '→', slugTitle);
      cardElement.dataset.imdbTitle = slugTitle;
      super.processCard(cardElement);
      return;
    }

    console.log('[IMDB OTT] Could not extract title (DOM + fiber + slug) for:', cardElement.href);
  }

  // ── Override badge insertion to ensure it renders ON TOP of images ────────

  _buildAndInsertBadge(cardElement, ratingText, colorClass, ariaLabel) {
    const container = this.getBadgeContainer(cardElement);
    if (!container) return;

    // Duplication check: Prime Video often has multiple links for the same hero movie
    // (logo, title, info button). We only want ONE badge per visual item slide or carousel LI.
    const itemContainer = cardElement.closest('li, [class*="hero-wrapper"], [class*="hero-container"], [class*="HeroSlide"], [class*="slide"]');
    if (itemContainer && itemContainer !== cardElement && (itemContainer.querySelector('.imdb-ott-badge') || itemContainer.querySelector('.imdb-ott-anchor'))) {
      console.log(`[IMDB OTT] Skip: item container already has a badge.`);
      return;
    }

    const badge = document.createElement('div');
    badge.className = `imdb-ott-badge ${colorClass}`;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', ariaLabel);

    const star = document.createElement('span');
    star.className = 'imdb-ott-badge__star';
    star.textContent = '★';

    const ratingSpan = document.createElement('span');
    ratingSpan.className = 'imdb-ott-badge__rating';
    ratingSpan.textContent = ratingText;

    badge.appendChild(star);
    badge.appendChild(ratingSpan);

    const anchor = document.createElement('div');
    anchor.className = 'imdb-ott-anchor';
    
    // We add robust inline CSS to guarantee it isn't clipped or hidden by Amazon's UI overlays
    anchor.style.position = 'absolute';
    anchor.style.zIndex = '99999';
    anchor.style.top = '10px';
    anchor.style.right = '10px';
    
    anchor.appendChild(badge);

    if (window.getComputedStyle(container).position === 'static') {
      container.classList.add('imdb-ott-container-relative');
    }

    // Force it onto the UI layer that bypasses image overflow constraints
    container.appendChild(anchor);
  }

  // ── extractTitleFromCard: called by super.processCard ─────────────────────

  extractTitleFromCard(cardElement) {
    // Fiber-scraped title stored in dataset by processCard override above
    if (cardElement.dataset && cardElement.dataset.imdbTitle) {
      const t = cardElement.dataset.imdbTitle.trim();
      delete cardElement.dataset.imdbTitle;
      if (t.length > 1) return { title: this.cleanTitle(t) };
    }
    return this._extractStaticTitle(cardElement);
  }

  // ── Static DOM extraction ─────────────────────────────────────────────────

  _extractStaticTitle(cardElement) {
    const rawLabel = cardElement.getAttribute('aria-label') || '';

    // "More details for X" buttons (the ⓘ icon) carry the title — extract it!
    const moreDetailsMatch = rawLabel.match(/more details for\s+(.+)/i);
    if (moreDetailsMatch) {
      const title = this.cleanTitle(moreDetailsMatch[1].trim());
      if (title.length > 1) {
        console.log(`[IMDB OTT][STATIC] Found title "${title}" from more-details-for pattern`);
        return { title };
      }
    }

    // Exclude noisy button labels (Play, Watch, Episodes, etc.)
    if (/\b(play|watch|resume|continue|more info|info|details|episodes?)\b/i.test(rawLabel)) {
      return null;
    }

    const img = cardElement.querySelector('img');

    const labelledById = cardElement.getAttribute('aria-labelledby');
    const labelledByText = labelledById
      ? document.getElementById(labelledById)?.textContent?.trim()
      : null;

    // ONLY rely on attributes, NOT textContent, to avoid reading our own injected badge
    const candidates = [
      { source: 'raw-aria-label', val: rawLabel },
      { source: 'title-attr', val: cardElement.getAttribute('title') },
      { source: 'child-aria-label', val: cardElement.querySelector('[aria-label]:not(.imdb-ott-badge)')?.getAttribute('aria-label') },
      { source: 'aria-labelledby', val: labelledByText },
      { source: 'img-alt', val: img?.getAttribute('alt') },
      { source: 'img-title', val: img?.getAttribute('title') }
    ];

    // Also check the parent <li> for a child with aria-label containing the title
    // (e.g. "More details for Reacher" on a sibling button within the same <li>)
    const parentLi = cardElement.closest('li');
    if (parentLi) {
      const siblingLabel = parentLi.querySelector('[aria-label]:not(.imdb-ott-badge)');
      if (siblingLabel && siblingLabel !== cardElement) {
        const sibVal = siblingLabel.getAttribute('aria-label') || '';
        const sibMatch = sibVal.match(/more details for\s+(.+)/i);
        if (sibMatch) {
          candidates.push({ source: 'sibling-more-details', val: sibMatch[1] });
        } else if (sibVal.length > 1 && sibVal.length < 150) {
          candidates.push({ source: 'sibling-aria-label', val: sibVal });
        }
      }
    }

    for (const c of candidates) {
      const title = c.val?.trim();
      if (title && title.length > 1 && title.length < 150) {
        const cleaned = this.cleanTitle(title);
        if (cleaned.length > 1 && !PrimeVideoAdapter._NOISE_RE.test(cleaned)) {
          console.log(`[IMDB OTT][STATIC] Found title "${cleaned}" from ${c.source}`);
          return { title: cleaned };
        }
      }
    }

    return null;
  }

  // ── React fiber reading ───────────────────────────────────────────────────

  /**
   * Reads the title from React's internal fiber tree.
   * React attaches __reactFiber$<hash> to every DOM element it renders.
   * Each fiber holds component props including data not rendered to DOM text.
   */
  _extractFromReactFiber(startElement) {
    const getFiber = (el) => {
      const key = Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
      return key ? el[key] : null;
    };

    // Strategy: try multiple starting points to find the title.
    // Prime Video's component tree is deeply nested — the item data may live
    // several levels above the <a> tag (on the <li>, on a wrapper div, etc.).
    const startPoints = [startElement];

    // Add the <img> inside the card (its fiber may carry artwork/title props)
    const img = startElement.querySelector('img');
    if (img) startPoints.push(img);

    // Add the parent <li> — carousel items often have item data in their fiber
    const parentLi = startElement.closest('li');
    if (parentLi) startPoints.push(parentLi);

    for (const startEl of startPoints) {
      let el = startEl;
      // Walk up to 10 DOM parent levels from each starting point
      for (let depth = 0; depth < 10 && el; depth++) {
        const fiber = getFiber(el);
        if (fiber) {
          const title = this._walkFiberForTitle(fiber);
          if (title) return title;
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  _walkFiberForTitle(startFiber) {
    let fiber = startFiber;

    // Pass 1: walk up the fiber return chain looking for explicit title props
    for (let depth = 0; depth < 30 && fiber; depth++) {
      const title = this._extractTitleFromFiberProps(fiber.memoizedProps)
                 || this._extractTitleFromFiberProps(fiber.pendingProps);
      if (title) return title;
      fiber = fiber.return;
    }

    // Pass 2: deep string search — recursively scan all props for plausible title strings.
    // This is the first-principles fallback: instead of guessing key names, find ALL
    // strings and pick the best candidate.
    fiber = startFiber;
    for (let depth = 0; depth < 20 && fiber; depth++) {
      const candidate = this._deepSearchForTitle(fiber.memoizedProps);
      if (candidate) {
        console.log(`[IMDB OTT][FIBER-DEEP] Found title "${candidate}" at fiber depth ${depth}`);
        return candidate;
      }
      fiber = fiber.return;
    }

    return null;
  }

  _extractTitleFromFiberProps(props) {
    if (!props || typeof props !== 'object') return null;

    // Flat string props — broad set covering various Prime Video component patterns
    const directKeys = [
      'title', 'aria-label', 'ariaLabel', 'label', 'text', 'name',
      'heading', 'displayTitle', 'titleText', 'primaryText', 'titleName',
      'catalogTitle', 'headerText', 'alt', 'accessibilityLabel'
    ];
    for (const key of directKeys) {
      const val = props[key];
      if (typeof val === 'string' && val.length > 1 && val.length < 120 &&
          !PrimeVideoAdapter._NOISE_RE.test(val.trim())) {
        return val.trim();
      }
    }

    // Nested data objects — cover Prime Video's catalogue structures
    const objectKeys = [
      'item', 'card', 'data', 'entity', 'content', 'titleCard', 'metadata',
      'catalogMetadata', 'artwork', 'show', 'program', 'video', 'titleData',
      'detail', 'hero', 'editorial', 'product', 'action'
    ];
    for (const key of objectKeys) {
      const obj = props[key];
      if (obj && typeof obj === 'object' && !obj.$$typeof) {
        // Check direct title-like keys
        for (const tKey of ['title', 'name', 'displayTitle', 'label', 'titleText', 'heading', 'primaryText', 'text']) {
          const nestedTitle = obj[tKey];
          if (typeof nestedTitle === 'string' && nestedTitle.length > 1 && nestedTitle.length < 120 &&
              !PrimeVideoAdapter._NOISE_RE.test(nestedTitle.trim())) {
            return nestedTitle.trim();
          }
        }
        // One more level: obj.item.title, obj.catalog.name, etc.
        for (const subKey of Object.keys(obj)) {
          const sub = obj[subKey];
          if (sub && typeof sub === 'object' && !sub.$$typeof && typeof sub.title === 'string' &&
              sub.title.length > 1 && sub.title.length < 120 &&
              !PrimeVideoAdapter._NOISE_RE.test(sub.title.trim())) {
            return sub.title.trim();
          }
        }
      }
    }

    return null;
  }

  /**
   * Deep-search a props object for strings that look like movie/show titles.
   * Returns the best candidate (shortest plausible title string) or null.
   */
  _deepSearchForTitle(props, maxDepth = 5, currentDepth = 0, seen = null) {
    if (!props || typeof props !== 'object' || currentDepth > maxDepth) return null;
    if (!seen) seen = new Set();
    if (seen.has(props)) return null;
    seen.add(props);

    // Skip React internal structures
    if (props.$$typeof || props._owner || props.updater) return null;

    let bestCandidate = null;

    for (const key of Object.keys(props)) {
      // Skip React internals and DOM children to avoid reading our own injected badges
      if (key.startsWith('__react') || key === 'children' || key === 'parent' ||
          key === 'sibling' || key === 'return' || key === 'stateNode' ||
          key === 'ref' || key === 'key' || key === '_owner' || key === '_store' ||
          key === 'style' || key === 'className' || key === 'dangerouslySetInnerHTML') continue;

      try {
        const val = props[key];

        if (typeof val === 'string' && val.length > 2 && val.length < 100) {
          const cleaned = val.trim();
          // Must not be a URL, color, CSS value, or noise label
          if (cleaned.length > 2 &&
              !PrimeVideoAdapter._NOISE_RE.test(cleaned) &&
              !/^(https?:|data:|#[0-9a-f]|rgb|var\(|\d+px|\d+%$|\d+\.?\d*$)/i.test(cleaned) &&
              !/^[a-z0-9_-]+$/i.test(cleaned) && // skip identifiers like "detailLink-abc"
              !/^\s*\{/.test(cleaned) &&            // skip JSON
              /[A-Z]/.test(cleaned))               // must contain at least one uppercase letter (title-like)
          {
            // Prefer keys that look title-ish, otherwise take shortest plausible string
            const isTitleKey = /title|name|heading|label|text|alt/i.test(key);
            if (isTitleKey) return cleaned; // immediate win
            if (!bestCandidate || cleaned.length < bestCandidate.length) {
              bestCandidate = cleaned;
            }
          }
        } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const nested = this._deepSearchForTitle(val, maxDepth, currentDepth + 1, seen);
          if (nested) {
            // A title-key match from deeper returns immediately
            if (!bestCandidate || nested.length < bestCandidate.length) {
              bestCandidate = nested;
            }
          }
        }
      } catch (e) {
        // Ignore getter cross-origin exceptions
      }
    }
    return bestCandidate;
  }

  // ── URL slug extraction (last resort) ──────────────────────────────────────

  /**
   * Attempt to extract a readable title from the URL path.
   * Most Prime Video URLs use opaque IDs (e.g. 0OP5NE1GYFYZ6...), but some
   * older/regional URLs include readable slugs like /detail/The-Boys/...
   */
  _extractTitleFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      const segments = url.pathname.split('/').filter(Boolean);

      for (const seg of segments) {
        // Skip common path segments and opaque Amazon IDs
        if (/^(detail|dp|gp|video|ref|storefront|offers|season|episode)$/i.test(seg)) continue;
        if (/^[A-Z0-9]{10,}$/i.test(seg)) continue; // opaque ID
        if (/^ref=/.test(seg)) continue;

        // If it contains hyphens or underscores and letters, it might be a slug
        if (/[a-zA-Z].*[-_].*[a-zA-Z]/.test(seg) && seg.length > 3 && seg.length < 80) {
          const title = seg
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
            .trim();
          const cleaned = this.cleanTitle(title);
          if (cleaned.length > 2 && !PrimeVideoAdapter._NOISE_RE.test(cleaned)) {
            return cleaned;
          }
        }
      }
    } catch (e) {
      // Invalid URL — ignore
    }
    return null;
  }

  // ── Noise / utility ───────────────────────────────────────────────────────

  static get _NOISE_RE() {
    return /^(new\s+(?:movie|series|season|episode|se|ep)|top\s+10|4k|hdr|uhd|dolby|prime\s*video?|included\s+with|see\s+more|play|watch|resume|continue|more\s+info|episodes?|\d+\s*(?:season|episode)s?|season\s*\d+|s\d+\s*e\d+|\d{1,2}:\d{2}|\d+%|free\s+with\s+ads?|ad-free|new)$/i;
  }

  cleanTitle(raw) {
    return raw
      .replace(/\s*[:\-–]\s*(season|part|volume|series|episode)\s*\d+.*/i, '')
      .replace(/\s+\d+\s+(season|seasons|episode|episodes).*/i, '')
      .replace(/\s*(new season|included with prime|included with your prime membership)$/i, '')
      .replace(/\s*(limited series|miniseries|documentary|film)$/i, '')
      .replace(/\x20\(?\d{4}\)?$/i, '')
      .replace(/\s*[-–]\s*(amazon|prime\s*video|prime)\s*$/i, '')
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

    let retries = 0;
    const retryInterval = setInterval(() => {
      adapter.scanExisting();
      retries++;
      if (retries >= INITIAL_SCAN_RETRIES) clearInterval(retryInterval);
    }, INITIAL_SCAN_INTERVAL_MS);

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
