// ============================================================
// BaseAdapter – abstract class for OTT platform adapters.
// Extend this for Netflix, Prime Video, Hotstar, etc.
// ============================================================

const DEBUG = true;
const log = (...args) => { if (DEBUG) console.log(...args); };
const logDebug = (...args) => { if (DEBUG) console.log(...args); };
const logWarn = (...args) => { if (DEBUG) console.warn(...args); };

const RATING_GREAT = 8.0;
const RATING_GOOD = 6.5;

class BaseAdapter {
  constructor(platformKey) {
    this.platformKey = platformKey;
    this.observer = null;
    this.processedCards = new WeakMap(); // cardElement → processed title
    this.pendingTitles = new WeakMap(); // cardElement → pending title
  }

  // ── To be implemented by subclasses ──────────────────────

  /**
   * Returns true if the current page is this platform's browse/home page.
   */
  isActive() {
    throw new Error('isActive() must be implemented');
  }

  /**
   * Returns a CSS selector that matches individual title card elements.
   */
  getCardSelector() {
    throw new Error('getCardSelector() must be implemented');
  }

  /**
   * Given a card element, extract { title, year } (year is optional).
   * Return null if the title cannot be determined.
   */
  extractTitleFromCard(cardElement) {
    throw new Error('extractTitleFromCard() must be implemented');
  }

  /**
   * Returns the inner element inside a card where the badge should be appended.
   * Defaults to the card itself.
   */
  getBadgeContainer(cardElement) {
    return cardElement;
  }

  // ── Core orchestration ───────────────────────────────────

  start() {
    if (!this.isActive()) {
      log(`[IMDB OTT] ${this.platformKey} adapter skipped (not active on this URL).`);
      return;
    }
    log(`[IMDB OTT] ${this.platformKey} adapter started on: ${location.href}`);
    this.scanExisting();
    this.observeDOM();
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      log(`[IMDB OTT] ${this.platformKey} MutationObserver disconnected.`);
    }
    this.clearAllBadges();
  }

  clearAllBadges() {
    document.querySelectorAll('.imdb-ott-anchor').forEach((el) => el.remove());
    log(`[IMDB OTT] ${this.platformKey} badges cleared.`);
  }

  scanExisting() {
    const cards = document.querySelectorAll(this.getCardSelector());
    let unprocessed = 0;
    cards.forEach((c) => {
        if (!this.processedCards.has(c)) unprocessed++;
    });
    if (unprocessed > 0) {
      log(`[IMDB OTT] scanExisting → found ${cards.length} cards (${unprocessed} new) on ${this.platformKey}`);
    }
    cards.forEach((card) => this.processCard(card));
  }

  observeDOM() {
    log(`[IMDB OTT] MutationObserver watching DOM for new ${this.platformKey} cards…`);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Check the node itself
          if (node.matches?.(this.getCardSelector())) {
            logDebug(`[IMDB OTT] MutationObserver: matched node directly →`, node.className);
            this.processCard(node);
          }

          // In React/SPAs (like Prime Video), a card <a> might be added empty,
          // and the <img> or Title span is appended later. If this node was added
          // INSIDE an existing card, we re-process the parent card.
          const parentCard = node.closest?.(this.getCardSelector());
          if (parentCard && parentCard !== node) {
            this.processCard(parentCard);
          }
          // Check descendants
          const descendants = node.querySelectorAll?.(this.getCardSelector()) || [];
          if (descendants.length) {
            logDebug(`[IMDB OTT] MutationObserver: found ${descendants.length} card(s) inside added node`);
          }
          descendants.forEach((card) => this.processCard(card));
        }
      }
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
    log(`[IMDB OTT] MutationObserver attached to document.body.`);
  }

  /** Returns false if the extension context has been invalidated (e.g. extension updated/reloaded). */
  isContextValid() {
    return !!(chrome.runtime?.id && chrome.runtime?.getURL);
  }

  processCard(cardElement) {
    const titleInfo = this.extractTitleFromCard(cardElement);
    if (!titleInfo || !titleInfo.title) {
      logDebug('[IMDB OTT] Could not extract title from card:', cardElement.className || cardElement.tagName);
      return; // retry on next scan
    }

    const previousTitle = this.processedCards.get(cardElement);
    if (previousTitle === titleInfo.title) {
      // DOM node was already processed for this exact title
      return;
    }

    // If there's an ongoing fetch for this same title on this element, ignore.
    if (this.pendingTitles.get(cardElement) === titleInfo.title) {
      return;
    }

    // This is a new title for this node (node recycling) or first time seeing it.
    this.processedCards.set(cardElement, titleInfo.title);
    this.pendingTitles.set(cardElement, titleInfo.title);

    // If there's an old badge from a previous recycled movie, rip it out.
    const oldAnchor = cardElement.querySelector('.imdb-ott-anchor');
    if (oldAnchor) oldAnchor.remove();

    logDebug(`[IMDB OTT] Processing card: "${titleInfo.title}"${titleInfo.year ? ` (${titleInfo.year})` : ''}`);

    // Throttle: Add a small randomized delay (0-300ms) so we don't spam 50+ messages
    // to the service worker in a single frame during the initial page scan.
    const delay = Math.floor(Math.random() * 300);
    setTimeout(() => {
      if (!this.isContextValid()) return;

      this.fetchAndInject(cardElement, titleInfo).finally(() => {
        // Clear pending state only if it hasn't been overwritten by another fast DOM recycling
        if (this.pendingTitles.get(cardElement) === titleInfo.title) {
          this.pendingTitles.delete(cardElement);
        }
      });
    }, delay);
  }

  async fetchAndInject(cardElement, { title, year }) {
    try {
      const data = await this.fetchRating(title, year);

      // Since fetch is async, verify this card hasn't been recycled for ANOTHER movie meanwhile
      if (this.processedCards.get(cardElement) !== title) {
        logDebug(`[IMDB OTT] Card recycled: dropping rating for "${title}"`);
        return;
      }

      // Silent failures — affect every card, so don't pollute UI with badges
      if (!data) {
        logWarn(`[IMDB OTT] No response from service worker for "${title}"`);
        this.injectFallbackBadge(cardElement, '—', 'Could not reach the rating service');
        return;
      }
      if (data.error === 'NO_API_KEY') {
        console.error('[IMDB OTT] API key missing — open the extension popup to set one.');
        return; // silent — affects every card
      }
      if (data.error === 'INVALID_API_KEY') {
        console.error('[IMDB OTT] API key is invalid or unauthorized — please check your API key in the extension popup.');
        return; // silent — affects every card
      }
      if (data.error === 'LIMIT_REACHED') {
        console.error('[IMDB OTT] OMDb 1,000 requests/day limit reached! Ratings will return in 24 hours.');
        return; // silent — affects every card
      }

      // Per-title failures — show a badge so the user knows we tried
      if (data.error === 'NOT_FOUND') {
        logDebug(`[IMDB OTT] "${title}" not found on OMDb.`);
        this.injectFallbackBadge(cardElement, '?', `The title "${title}" was not found on IMDb`);
        return;
      }
      if (!data.imdbRating) {
        logDebug(`[IMDB OTT] "${title}" found but rating is unavailable.`);
        this.injectFallbackBadge(cardElement, 'N/A', `A rating for "${title}" is not yet available on IMDb`);
        return;
      }

      this.injectBadge(cardElement, data);
    } catch (err) {
      logWarn(`[IMDB OTT] fetchAndInject failed for "${title}":`, err.message);
      this.injectFallbackBadge(cardElement, '—', 'Rating fetch failed');
    }
  }

  fetchRating(title, year) {
    if (!this.isContextValid()) {
      return Promise.reject(new Error('Extension context invalidated'));
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_RATING', title, year }, (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message;
          // Only log as debug/warn to avoid console noise for transient/orphaned issues
          if (errMsg.includes('context invalidated')) {
            logDebug(`[IMDB OTT] Extension context invalidated while fetching "${title}".`);
          } else {
            logWarn(`[IMDB OTT] ${errMsg} for "${title}"`);
          }
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
  }

  /**
   * Builds and inserts a badge element into the card.
   * @param {Element} cardElement
   * @param {string}  ratingText  - display text, e.g. "7.5", "N/A", "?", "—"
   * @param {string}  colorClass  - BEM modifier, e.g. 'imdb-ott-badge--great'
   * @param {string}  ariaLabel   - accessible description
   */
  _buildAndInsertBadge(cardElement, ratingText, colorClass, ariaLabel) {
    // Avoid double-injecting
    if (cardElement.querySelector('.imdb-ott-badge')) return;

    const container = this.getBadgeContainer(cardElement);
    if (!container) {
      console.warn(`[IMDB OTT] No badge container found for card:`, cardElement.className);
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
    anchor.appendChild(badge);

    // Insert anchor as first child so it sits behind platform overlays
    // (e.g. Netflix TOP 10 badge) which come later in the DOM.
    if (window.getComputedStyle(container).position === 'static') {
      container.classList.add('imdb-ott-container-relative');
    }
    container.insertBefore(anchor, container.firstChild);
  }

  /** Inject a badge for a title that has a known IMDb rating. */
  injectBadge(cardElement, data) {
    const rating = parseFloat(data.imdbRating);
    const colorClass =
      rating >= RATING_GREAT ? 'imdb-ott-badge--great'
      : rating >= RATING_GOOD ? 'imdb-ott-badge--good'
      : 'imdb-ott-badge--poor';

    this._buildAndInsertBadge(
      cardElement,
      data.imdbRating,
      colorClass,
      `IMDb rating: ${data.imdbRating}`,
    );
    log(`[IMDB OTT] Badge injected: ${data.title} → ${data.imdbRating}`);
  }

  /**
   * Inject a muted fallback badge when no rating is available.
   * @param {Element} cardElement
   * @param {string}  label   - short display text shown in the badge, e.g. "N/A", "?", "—"
   * @param {string}  tooltip - description surfaced via aria-label / browser tooltip
   */
  injectFallbackBadge(cardElement, label, tooltip) {
    // Don't double-inject a fallback on top of an existing successful badge
    if (cardElement.querySelector('.imdb-ott-badge')) return;
    logDebug(`[IMDB OTT] Fallback badge "${label}": ${tooltip}`);
    this._buildAndInsertBadge(
      cardElement,
      label,
      'imdb-ott-badge--na',
      `IMDb: ${tooltip}`,
    );
  }
}
