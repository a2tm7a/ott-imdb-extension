/**
 * Tests for BaseAdapter — the abstract base class shared by all platform adapters.
 *
 * Because BaseAdapter is written as a plain ES5-style class (no ES modules), we
 * eval() the source file into the test process after shimming all globals it needs.
 * Concrete behaviour is exercised via a minimal TestAdapter subclass.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Load source ───────────────────────────────────────────────────────────────

const baseAdapterSrc = fs.readFileSync(
  path.resolve(__dirname, '../content-scripts/base-adapter.js'),
  'utf8',
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadBaseAdapter() {
  const fn = new Function(`${baseAdapterSrc}\nreturn BaseAdapter;`);
  global.BaseAdapter = fn();
}

/**
 * A minimal concrete adapter that satisfies BaseAdapter's abstract contract.
 * Each test suite rebuilds one from scratch (loadBaseAdapter is idempotent
 * because overwriting globalThis.BaseAdapter is harmless).
 */
function makeTestAdapter(overrides = {}) {
  loadBaseAdapter();

  class TestAdapter extends global.BaseAdapter {
    constructor() {
      super('test');
    }
    isActive() { return overrides.isActive ?? true; }
    getCardSelector() { return overrides.cardSelector ?? '.card'; }
    extractTitleFromCard(el) { return overrides.extract ? overrides.extract(el) : { title: el.dataset.title || '' }; }
  }

  return new TestAdapter();
}

// ── Badge colour classification ───────────────────────────────────────────────

afterEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('injectBadge — colour classes', () => {
  const cases = [
    { rating: '9.0', expectedClass: 'imdb-ott-badge--great', label: 'great (≥8.0)' },
    { rating: '8.0', expectedClass: 'imdb-ott-badge--great', label: 'great (exactly 8.0)' },
    { rating: '7.9', expectedClass: 'imdb-ott-badge--good',  label: 'good (≥6.5)' },
    { rating: '6.5', expectedClass: 'imdb-ott-badge--good',  label: 'good (exactly 6.5)' },
    { rating: '5.0', expectedClass: 'imdb-ott-badge--poor',  label: 'poor (<6.5)' },
    { rating: '1.0', expectedClass: 'imdb-ott-badge--poor',  label: 'poor (very low)' },
  ];

  test.each(cases)('rating $rating → $label', ({ rating, expectedClass }) => {
    const adapter = makeTestAdapter();
    const card = document.createElement('div');
    card.className = 'card';
    document.body.appendChild(card);

    adapter.injectBadge(card, { imdbRating: rating, title: 'Test Movie' });

    const badge = card.querySelector('.imdb-ott-badge');
    expect(badge).not.toBeNull();
    expect(badge.classList.contains(expectedClass)).toBe(true);
    expect(card.querySelector('.imdb-ott-badge__rating').textContent).toBe(rating);

    card.remove();
  });
});

// ── Fallback badge ────────────────────────────────────────────────────────────

describe('injectFallbackBadge', () => {
  test('injects a badge with "imdb-ott-badge--na" class', () => {
    const adapter = makeTestAdapter();
    const card = document.createElement('div');
    document.body.appendChild(card);

    adapter.injectFallbackBadge(card, '?', 'Title not found on IMDb');

    const badge = card.querySelector('.imdb-ott-badge');
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('imdb-ott-badge--na')).toBe(true);
    expect(card.querySelector('.imdb-ott-badge__rating').textContent).toBe('?');
    card.remove();
  });

  test('does not double-inject when a badge already exists', () => {
    const adapter = makeTestAdapter();
    const card = document.createElement('div');
    document.body.appendChild(card);

    adapter.injectFallbackBadge(card, '?', 'No rating yet');
    adapter.injectFallbackBadge(card, '?', 'No rating yet'); // second call

    expect(card.querySelectorAll('.imdb-ott-badge').length).toBe(1);
    card.remove();
  });
});

// ── _buildAndInsertBadge ──────────────────────────────────────────────────────

describe('_buildAndInsertBadge', () => {
  test('adds imdb-ott-container-relative when container is statically positioned', () => {
    const adapter = makeTestAdapter();
    const card = document.createElement('div');
    card.style.position = 'static';
    document.body.appendChild(card);

    adapter._buildAndInsertBadge(card, '7.5', 'imdb-ott-badge--good', 'IMDb rating: 7.5');

    expect(card.classList.contains('imdb-ott-container-relative')).toBe(true);
    card.remove();
  });

  test('badge is the FIRST child of the container', () => {
    const adapter = makeTestAdapter();
    const card = document.createElement('div');
    const existingChild = document.createElement('span');
    card.appendChild(existingChild);
    document.body.appendChild(card);

    adapter._buildAndInsertBadge(card, '8.5', 'imdb-ott-badge--great', 'IMDb rating: 8.5');

    expect(card.firstChild.classList.contains('imdb-ott-anchor')).toBe(true);
    card.remove();
  });

  test('does not double-inject if badge already present', () => {
    const adapter = makeTestAdapter();
    const card = document.createElement('div');
    document.body.appendChild(card);

    adapter._buildAndInsertBadge(card, '7.0', 'imdb-ott-badge--good', 'A');
    adapter._buildAndInsertBadge(card, '7.0', 'imdb-ott-badge--good', 'B');

    expect(card.querySelectorAll('.imdb-ott-badge').length).toBe(1);
    card.remove();
  });

  test('aria-label is set correctly', () => {
    const adapter = makeTestAdapter();
    const card = document.createElement('div');
    document.body.appendChild(card);

    adapter._buildAndInsertBadge(card, '6.8', 'imdb-ott-badge--good', 'IMDb rating: 6.8');

    const badge = card.querySelector('.imdb-ott-badge');
    expect(badge.getAttribute('aria-label')).toBe('IMDb rating: 6.8');
    card.remove();
  });
});

// ── clearAllBadges ────────────────────────────────────────────────────────────

describe('clearAllBadges', () => {
  test('removes all .imdb-ott-anchor elements from the document', () => {
    const adapter = makeTestAdapter();

    // Inject some badges
    [1, 2, 3].forEach(() => {
      const card = document.createElement('div');
      document.body.appendChild(card);
      adapter.injectBadge(card, { imdbRating: '7.0', title: 'X' });
    });

    expect(document.querySelectorAll('.imdb-ott-anchor').length).toBe(3);

    adapter.clearAllBadges();

    expect(document.querySelectorAll('.imdb-ott-anchor').length).toBe(0);
  });
});

// ── processCard deduplication ─────────────────────────────────────────────────

describe('processCard deduplication', () => {
  test('skips a card that has already been processed for the same title', () => {
    const extractSpy = jest.fn().mockReturnValue({ title: 'Inception' });
    const adapter = makeTestAdapter({ extract: extractSpy });

    // Stub out fetchAndInject so nothing async fires but returns a promise for .finally()
    adapter.fetchAndInject = jest.fn().mockResolvedValue();
    // Bypass isContextValid
    jest.spyOn(adapter, 'isContextValid').mockReturnValue(true);

    const card = document.createElement('div');
    
    // fetchAndInject is called in a setTimeout; use fake timers BEFORE calling processCard
    jest.useFakeTimers();
    
    adapter.processCard(card);

    // Mark it as processed (simulate that the first call already set state)
    // Second call should bail out early
    adapter.processCard(card);

    // extractTitleFromCard should be called twice (once per processCard call)
    expect(extractSpy).toHaveBeenCalledTimes(2);
    // but fetchAndInject should only be called ONCE (dedup prevents second)
    adapter.processCard(card); // third call — duplicate
    
    // Resolve all pending timeouts
    jest.runAllTimers();
    jest.useRealTimers();
    
    // fetchAndInject still only called once (first real call)
    expect(adapter.fetchAndInject).toHaveBeenCalledTimes(1);
  });
});

// ── fetchAndInject error paths ────────────────────────────────────────────────

describe('fetchAndInject error handling', () => {
  let adapter;

  beforeEach(() => {
    adapter = makeTestAdapter();
    jest.spyOn(adapter, 'fetchRating');
  });

  test('shows fallback badge on NO_API_KEY (silently — no badge)', async () => {
    adapter.fetchRating.mockResolvedValue({ error: 'NO_API_KEY' });
    const card = document.createElement('div');
    document.body.appendChild(card);
    adapter.processedCards.set(card, 'Test');

    await adapter.fetchAndInject(card, { title: 'Test' });

    // NO_API_KEY is a silent failure — no badge should be injected
    expect(card.querySelector('.imdb-ott-badge')).toBeNull();
    card.remove();
  });

  test('shows fallback badge on INVALID_API_KEY (silent — no badge)', async () => {
    adapter.fetchRating.mockResolvedValue({ error: 'INVALID_API_KEY' });
    const card = document.createElement('div');
    document.body.appendChild(card);
    adapter.processedCards.set(card, 'Test');

    await adapter.fetchAndInject(card, { title: 'Test' });

    expect(card.querySelector('.imdb-ott-badge')).toBeNull();
    card.remove();
  });

  test('injects FAQ fallback badge (?) on NOT_FOUND', async () => {
    adapter.fetchRating.mockResolvedValue({ error: 'NOT_FOUND' });
    const card = document.createElement('div');
    document.body.appendChild(card);
    adapter.processedCards.set(card, 'Test');

    await adapter.fetchAndInject(card, { title: 'Test' });

    const badge = card.querySelector('.imdb-ott-badge');
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('imdb-ott-badge--na')).toBe(true);
    expect(card.querySelector('.imdb-ott-badge__rating').textContent).toBe('?');
    card.remove();
  });

  test('injects "N/A" badge when rating is null (found but no rating)', async () => {
    adapter.fetchRating.mockResolvedValue({ imdbID: 'tt1234567', title: 'New Film', imdbRating: null });
    const card = document.createElement('div');
    document.body.appendChild(card);
    adapter.processedCards.set(card, 'New Film');

    await adapter.fetchAndInject(card, { title: 'New Film' });

    const ratingEl = card.querySelector('.imdb-ott-badge__rating');
    expect(ratingEl.textContent).toBe('N/A');
    card.remove();
  });

  test('injects "—" fallback on null response (no data)', async () => {
    adapter.fetchRating.mockResolvedValue(null);
    const card = document.createElement('div');
    document.body.appendChild(card);
    adapter.processedCards.set(card, 'Test');

    await adapter.fetchAndInject(card, { title: 'Test' });

    const ratingEl = card.querySelector('.imdb-ott-badge__rating');
    expect(ratingEl.textContent).toBe('—');
    card.remove();
  });

  test('injects "—" fallback when fetchRating rejects', async () => {
    adapter.fetchRating.mockRejectedValue(new Error('network timeout'));
    const card = document.createElement('div');
    document.body.appendChild(card);
    adapter.processedCards.set(card, 'Test');

    await adapter.fetchAndInject(card, { title: 'Test' });

    const ratingEl = card.querySelector('.imdb-ott-badge__rating');
    expect(ratingEl.textContent).toBe('—');
    card.remove();
  });

  test('drops stale card result when card was recycled mid-fetch', async () => {
    // First fetch returns a good rating
    adapter.fetchRating.mockResolvedValue({ imdbRating: '8.5', title: 'Old Movie' });
    const card = document.createElement('div');
    document.body.appendChild(card);

    // Simulate recycling: processed card was set to a different title
    adapter.processedCards.set(card, 'New Movie');

    // fetchAndInject was called for "Old Movie" but card now maps to "New Movie"
    await adapter.fetchAndInject(card, { title: 'Old Movie' });

    // No badge injected because card was recycled
    expect(card.querySelector('.imdb-ott-badge')).toBeNull();
    card.remove();
  });
});

// ── observeDOM ────────────────────────────────────────────────────────────────

describe('observeDOM', () => {
  test('re-processes a card when its descendant image is lazily loaded (e.g. Prime Video)', async () => {
    // 1. Simulate primevideo card structure
    const extractSpy = jest.fn().mockReturnValue({ title: 'Delayed Title' });
    const adapter = makeTestAdapter({ extract: extractSpy });
    
    // We mock getCardSelector to match our test container
    adapter.getCardSelector = () => '.tst-packshot';
    
    adapter.processCard = jest.fn();
    adapter.observeDOM();

    // 2. Add an empty link card
    const card = document.createElement('a');
    card.className = 'tst-packshot';
    card.href = '/detail/12345';
    document.body.appendChild(card); // Observer captures it, fires processCard(card)

    // Wait for initial mutation tick
    await Promise.resolve();
    expect(adapter.processCard).toHaveBeenCalledWith(card);
    adapter.processCard.mockClear();

    // 3. LAZY LOAD: Now append the thumbnail image inside it!
    const img = document.createElement('img');
    img.alt = 'Delayed Title';
    card.appendChild(img);

    // Wait for subsequent mutation tick
    await Promise.resolve();

    // 4. VERIFY: Specifically check that the MutationObserver saw the <img> appended, 
    // mapped it upwards using closest(), and successfully passed the parent <a class="tst-packshot"> 
    // back into processCard to be re-evaluated now that its image is present!
    expect(adapter.processCard).toHaveBeenCalledWith(card);
  });
});

// ── isContextValid ────────────────────────────────────────────────────────────

describe('isContextValid', () => {
  test('returns true when chrome.runtime.id is set', () => {
    const adapter = makeTestAdapter();
    // chrome.runtime.id is set in setup.js
    expect(adapter.isContextValid()).toBe(true);
  });

  test('returns false when chrome.runtime.id is missing', () => {
    const adapter = makeTestAdapter();
    const orig = global.chrome.runtime.id;
    global.chrome.runtime.id = undefined;
    expect(adapter.isContextValid()).toBe(false);
    global.chrome.runtime.id = orig;
  });
});
