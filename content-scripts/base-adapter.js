// ============================================================
// BaseAdapter – abstract class for OTT platform adapters.
// Extend this for Netflix, Prime Video, Hotstar, etc.
// ============================================================

class BaseAdapter {
  constructor(platformKey) {
    this.platformKey = platformKey;
    this.observer = null;
    this.processedCards = new WeakSet();
    this.pendingTitles = new Map(); // element → { title, year }
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
      console.log(`[IMDB OTT] ${this.platformKey} adapter skipped (not active on this URL).`);
      return;
    }
    console.log(`[IMDB OTT] ${this.platformKey} adapter started on: ${location.href}`);
    this.scanExisting();
    this.observeDOM();
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      console.log(`[IMDB OTT] ${this.platformKey} MutationObserver disconnected.`);
    }
  }

  scanExisting() {
    const cards = document.querySelectorAll(this.getCardSelector());
    const unprocessed = [...cards].filter((c) => !this.processedCards.has(c)).length;
    if (unprocessed > 0) {
      console.log(`[IMDB OTT] scanExisting → found ${cards.length} cards (${unprocessed} new) on ${this.platformKey}`);
    }
    cards.forEach((card) => this.processCard(card));
  }

  observeDOM() {
    console.log(`[IMDB OTT] MutationObserver watching DOM for new ${this.platformKey} cards…`);
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Check the node itself
          if (node.matches?.(this.getCardSelector())) {
            console.debug(`[IMDB OTT] MutationObserver: matched node directly →`, node.className);
            this.processCard(node);
          }
          // Check descendants
          const descendants = node.querySelectorAll?.(this.getCardSelector()) || [];
          if (descendants.length) {
            console.debug(`[IMDB OTT] MutationObserver: found ${descendants.length} card(s) inside added node`);
          }
          descendants.forEach((card) => this.processCard(card));
        }
      }
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
    console.log(`[IMDB OTT] MutationObserver attached to document.body.`);
  }

  processCard(cardElement) {
    if (this.processedCards.has(cardElement)) return;
    this.processedCards.add(cardElement);

    const titleInfo = this.extractTitleFromCard(cardElement);
    if (!titleInfo || !titleInfo.title) {
      console.debug('[IMDB OTT] Could not extract title from card:', cardElement.className || cardElement.tagName);
      return;
    }

    console.debug(`[IMDB OTT] Processing card: "${titleInfo.title}"${titleInfo.year ? ` (${titleInfo.year})` : ''}`);
    this.fetchAndInject(cardElement, titleInfo);
  }

  async fetchAndInject(cardElement, { title, year }) {
    try {
      const data = await this.fetchRating(title, year);
      if (!data) {
        console.warn(`[IMDB OTT] No response from service worker for "${title}"`);
        return;
      }
      if (data.error === 'NO_API_KEY') {
        console.error('[IMDB OTT] API key missing — open the extension popup to set one.');
        return;
      }
      if (data.error === 'NOT_FOUND') {
        console.debug(`[IMDB OTT] "${title}" not found on OMDb.`);
        return;
      }
      if (!data.imdbRating) {
        console.debug(`[IMDB OTT] "${title}" found but rating is unavailable.`);
        return;
      }
      this.injectBadge(cardElement, data);
    } catch (err) {
      console.warn(`[IMDB OTT] fetchAndInject failed for "${title}":`, err.message);
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
      rating >= 8 ? 'imdb-ott-badge--great'
      : rating >= 6.5 ? 'imdb-ott-badge--good'
      : 'imdb-ott-badge--poor';

    const badge = document.createElement('div');
    badge.className = `imdb-ott-badge ${colorClass}`;
    badge.innerHTML = `<span class="imdb-ott-badge__star">★</span><span class="imdb-ott-badge__rating">${data.imdbRating}</span>`;

    // Wrap badge in a zero-size absolutely-positioned anchor so we never
    // mutate any inline styles on Netflix's own elements.
    const anchor = document.createElement('div');
    anchor.className = 'imdb-ott-anchor';
    anchor.style.cssText = [
      'position:absolute',
      'top:0', 'left:0', 'right:0', 'bottom:0',
      'width:100%', 'height:100%',
      'pointer-events:none',
      'z-index:99998',
      'overflow:visible',
    ].join(';');
    anchor.appendChild(badge);

    // Insert anchor as first child so it sits behind Netflix's own overlays
    // (TOP 10 badge etc.) which come later in the DOM.
    container.style.position = container.style.position || 'relative';
    container.insertBefore(anchor, container.firstChild);

    console.log(`[IMDB OTT] Badge injected: ${data.title} → ${data.imdbRating}`);
  }
}
