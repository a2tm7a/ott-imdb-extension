// ============================================================
// BaseAdapter – abstract class for OTT platform adapters.
// Extend this for Netflix, Prime Video, Hotstar, etc.
// ============================================================

const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log(...args); };
const logDebug = (...args) => { if (DEBUG) console.debug(...args); };
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
    this.fetchAndInject(cardElement, titleInfo).finally(() => {
      // Clear pending state only if it hasn't been overwritten by another fast DOM recycling
      if (this.pendingTitles.get(cardElement) === titleInfo.title) {
         this.pendingTitles.delete(cardElement);
      }
    });
  }

  async fetchAndInject(cardElement, { title, year }) {
    try {
      const data = await this.fetchRating(title, year);
      
      // Since fetch is async, verify this card hasn't been recycled for ANOTHER movie meanwhile
      if (this.processedCards.get(cardElement) !== title) {
          logDebug(`[IMDB OTT] Card recycled: dropping rating for "${title}"`);
          return;
      }

      if (!data) {
        logWarn(`[IMDB OTT] No response from service worker for "${title}"`);
        return;
      }
      if (data.error === 'NO_API_KEY') {
        console.error('[IMDB OTT] API key missing — open the extension popup to set one.');
        return;
      }
      if (data.error === 'INVALID_API_KEY') {
        console.error('[IMDB OTT] API key is invalid or unauthorized — please check your API key in the extension popup.');
        return;
      }
      if (data.error === 'NOT_FOUND') {
        logDebug(`[IMDB OTT] "${title}" not found on OMDb.`);
        return;
      }
      if (!data.imdbRating) {
        logDebug(`[IMDB OTT] "${title}" found but rating is unavailable.`);
        return;
      }
      this.injectBadge(cardElement, data);
    } catch (err) {
      logWarn(`[IMDB OTT] fetchAndInject failed for "${title}":`, err.message);
    }
  }

  fetchRating(title, year) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_RATING', title, year }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(`[IMDB OTT] sendMessage error for "${title}":`, chrome.runtime.lastError.message);
          return reject(chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
  }

  injectBadge(cardElement, data) {
    // Avoid double-injecting
    if (cardElement.querySelector('.imdb-ott-badge')) return;

    const container = this.getBadgeContainer(cardElement);
    if (!container) {
      console.warn(`[IMDB OTT] No badge container found for card:`, cardElement.className);
      return;
    }

    const rating = parseFloat(data.imdbRating);
    const colorClass =
      rating >= RATING_GREAT ? 'imdb-ott-badge--great'
      : rating >= RATING_GOOD ? 'imdb-ott-badge--good'
      : 'imdb-ott-badge--poor';

    const badge = document.createElement('div');
    badge.className = `imdb-ott-badge ${colorClass}`;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', `IMDB rating: ${data.imdbRating}`);

    const star = document.createElement('span');
    star.className = 'imdb-ott-badge__star';
    star.textContent = '★';

    const ratingSpan = document.createElement('span');
    ratingSpan.className = 'imdb-ott-badge__rating';
    ratingSpan.textContent = data.imdbRating;

    badge.appendChild(star);
    badge.appendChild(ratingSpan);

    // Use class-based styling instead of inline styles to prevent CSP violations
    const anchor = document.createElement('div');
    anchor.className = 'imdb-ott-anchor';
    anchor.appendChild(badge);

    // Insert anchor as first child so it sits behind Netflix's own overlays
    // (TOP 10 badge etc.) which come later in the DOM.
    // Use getComputedStyle so we catch position set via CSS class, not just inline style.
    if (window.getComputedStyle(container).position === 'static') {
      container.classList.add('imdb-ott-container-relative');
    }
    container.insertBefore(anchor, container.firstChild);

    log(`[IMDB OTT] Badge injected: ${data.title} → ${data.imdbRating}`);
  }
}
