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
    if (!this.isActive()) return;
    console.log(`[IMDB OTT] ${this.platformKey} adapter started`);
    this.scanExisting();
    this.observeDOM();
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  scanExisting() {
    const cards = document.querySelectorAll(this.getCardSelector());
    cards.forEach((card) => this.processCard(card));
  }

  observeDOM() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Check the node itself
          if (node.matches?.(this.getCardSelector())) {
            this.processCard(node);
          }
          // Check descendants
          node.querySelectorAll?.(this.getCardSelector()).forEach((card) =>
            this.processCard(card)
          );
        }
      }
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  processCard(cardElement) {
    if (this.processedCards.has(cardElement)) return;
    this.processedCards.add(cardElement);

    const titleInfo = this.extractTitleFromCard(cardElement);
    if (!titleInfo || !titleInfo.title) return;

    this.fetchAndInject(cardElement, titleInfo);
  }

  async fetchAndInject(cardElement, { title, year }) {
    try {
      const data = await this.fetchRating(title, year);
      if (!data || data.error || !data.imdbRating) return;
      this.injectBadge(cardElement, data);
    } catch (err) {
      console.warn(`[IMDB OTT] Failed for "${title}":`, err);
    }
  }

  fetchRating(title, year) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_RATING', title, year }, (response) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(response);
      });
    });
  }

  injectBadge(cardElement, data) {
    // Avoid double-injecting
    if (cardElement.querySelector('.imdb-ott-badge')) return;

    const container = this.getBadgeContainer(cardElement);
    if (!container) return;

    // Ensure the container can anchor absolutely-positioned children
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === 'static') {
      container.style.position = 'relative';
    }
    // Un-clip so the badge isn't hidden
    if (containerStyle.overflow === 'hidden') {
      container.style.overflow = 'visible';
    }

    const badge = document.createElement('div');
    badge.className = 'imdb-ott-badge';
    badge.setAttribute('data-imdb-id', data.imdbID || '');
    badge.title = `IMDB: ${data.imdbRating} – ${data.title} (${data.year})`;

    const rating = parseFloat(data.imdbRating);
    const colorClass =
      rating >= 8 ? 'imdb-ott-badge--great'
      : rating >= 6.5 ? 'imdb-ott-badge--good'
      : 'imdb-ott-badge--poor';

    badge.classList.add(colorClass);
    badge.innerHTML = `<span class="imdb-ott-badge__star">★</span><span class="imdb-ott-badge__rating">${data.imdbRating}</span>`;

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (data.imdbID) {
        window.open(`https://www.imdb.com/title/${data.imdbID}/`, '_blank');
      }
    });

    container.appendChild(badge);
    console.log(`[IMDB OTT] Badge injected: ${data.title} → ${data.imdbRating}`);
  }
}
