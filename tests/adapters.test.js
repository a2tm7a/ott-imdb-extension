/**
 * Tests for platform-specific adapter DOM methods:
 *   - isActive()
 *   - getCardSelector()
 *   - extractTitleFromCard()
 *   - getBadgeContainer()
 *
 * We load the source files into the global scope (same pattern as other suites)
 * and create real DOM elements to test against.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function loadSrc(file) {
  let src = fs.readFileSync(path.resolve(__dirname, '../content-scripts', file), 'utf8');
  src = src.replace(/location\.hostname/g, '(global.mockLocation || location).hostname');
  src = src.replace(/location\.href/g, '(global.mockLocation || location).href');
  if (file === 'base-adapter.js') {
    global.BaseAdapter = new Function(`${src}\nreturn BaseAdapter;`)();
  } else if (file === 'netflix.js') {
    global.NetflixAdapter = new Function(`const BaseAdapter = global.BaseAdapter;\n${src}\nreturn NetflixAdapter;`)();
  } else if (file === 'prime.js') {
    global.PrimeVideoAdapter = new Function(`const BaseAdapter = global.BaseAdapter;\n${src}\nreturn PrimeVideoAdapter;`)();
  } else if (file === 'hotstar.js') {
    global.HotstarAdapter = new Function(`const BaseAdapter = global.BaseAdapter;\n${src}\nreturn HotstarAdapter;`)();
  }
}

loadSrc('base-adapter.js');
loadSrc('netflix.js');
loadSrc('prime.js');
loadSrc('hotstar.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function setLocation(hostname) {
  global.mockLocation = { hostname, href: `https://${hostname}/` };
}

// ─────────────────────────────────────────────────────────────────────────────
// NetflixAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe('NetflixAdapter.isActive()', () => {
  const adapter = new global.NetflixAdapter();

  test('returns true for netflix.com', () => {
    setLocation('www.netflix.com');
    expect(adapter.isActive()).toBe(true);
  });

  test('returns false for other hosts', () => {
    setLocation('www.primevideo.com');
    expect(adapter.isActive()).toBe(false);
  });
});

describe('NetflixAdapter.extractTitleFromCard()', () => {
  const adapter = new global.NetflixAdapter();

  test('returns title from aria-label attribute', () => {
    const el = document.createElement('a');
    el.setAttribute('aria-label', 'Stranger Things');
    el.setAttribute('href', '/watch/123');
    const img = document.createElement('img');
    el.appendChild(img);
    document.body.appendChild(el);

    const result = adapter.extractTitleFromCard(el);
    expect(result).toEqual({ title: 'Stranger Things' });
    el.remove();
  });

  test('strips season info from aria-label', () => {
    const el = document.createElement('a');
    el.setAttribute('aria-label', 'The Crown - Series 3');
    el.setAttribute('href', '/watch/456');
    const img = document.createElement('img');
    el.appendChild(img);
    document.body.appendChild(el);

    const result = adapter.extractTitleFromCard(el);
    expect(result.title).toBe('The Crown');
    el.remove();
  });

  test('returns null for card without an img (non-thumbnail link)', () => {
    const el = document.createElement('a');
    el.setAttribute('aria-label', 'Some Menu Item');
    el.setAttribute('href', '/watch/789');
    // No <img> child
    document.body.appendChild(el);

    const result = adapter.extractTitleFromCard(el);
    expect(result).toBeNull();
    el.remove();
  });

  test('falls back to img alt text when aria-label is absent', () => {
    const el = document.createElement('a');
    el.setAttribute('href', '/watch/999');
    const img = document.createElement('img');
    img.setAttribute('alt', 'Ozark');
    el.appendChild(img);
    document.body.appendChild(el);

    const result = adapter.extractTitleFromCard(el);
    expect(result.title).toBe('Ozark');
    el.remove();
  });

  test('returns null when inside a hero/billboard container', () => {
    const billboard = document.createElement('div');
    billboard.className = 'billboard-container';
    const link = document.createElement('a');
    link.setAttribute('href', '/watch/111');
    link.setAttribute('aria-label', 'Money Heist');
    const img = document.createElement('img');
    link.appendChild(img);
    billboard.appendChild(link);
    document.body.appendChild(billboard);

    const result = adapter.extractTitleFromCard(link);
    expect(result).toBeNull();
    billboard.remove();
  });
});

describe('NetflixAdapter.getBadgeContainer()', () => {
  const adapter = new global.NetflixAdapter();

  test('returns card element itself for regular cards', () => {
    const card = document.createElement('a');
    card.setAttribute('href', '/watch/1');
    expect(adapter.getBadgeContainer(card)).toBe(card);
  });

  test('returns info-wrapper for hero billboard elements', () => {
    const hero = document.createElement('div');
    hero.className = 'billboard-wrapper';
    const infoWrapper = document.createElement('div');
    infoWrapper.className = 'info-wrapper--hero';
    hero.appendChild(infoWrapper);
    document.body.appendChild(hero);

    const container = adapter.getBadgeContainer(hero);
    expect(container).toBe(infoWrapper);
    hero.remove();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PrimeVideoAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe('PrimeVideoAdapter.isActive()', () => {
  const adapter = new global.PrimeVideoAdapter();

  test('returns true for primevideo.com', () => {
    setLocation('www.primevideo.com');
    expect(adapter.isActive()).toBe(true);
  });

  test('returns true for amazon.com', () => {
    setLocation('www.amazon.com');
    expect(adapter.isActive()).toBe(true);
  });

  test('returns false for netflix.com', () => {
    setLocation('www.netflix.com');
    expect(adapter.isActive()).toBe(false);
  });
});

describe('PrimeVideoAdapter.extractTitleFromCard()', () => {
  const adapter = new global.PrimeVideoAdapter();

  test('extracts title from "More details for X" aria-label', () => {
    const el = document.createElement('a');
    el.setAttribute('href', '/detail/B0');
    el.setAttribute('aria-label', 'More details for The Boys');
    const img = document.createElement('img');
    el.appendChild(img);
    document.body.appendChild(el);

    const result = adapter.extractTitleFromCard(el);
    expect(result.title).toBe('The Boys');
    el.remove();
  });

  test('returns null for Play button links', () => {
    const el = document.createElement('a');
    el.setAttribute('href', '/detail/B0/play');
    el.setAttribute('aria-label', 'Play The Boys');
    const img = document.createElement('img');
    el.appendChild(img);

    const result = adapter.extractTitleFromCard(el);
    expect(result).toBeNull();
  });

  test('falls back to img alt text', () => {
    const el = document.createElement('a');
    el.setAttribute('href', '/detail/B1');
    const img = document.createElement('img');
    img.setAttribute('alt', 'Reacher');
    el.appendChild(img);
    document.body.appendChild(el);

    const result = adapter.extractTitleFromCard(el);
    expect(result.title).toBe('Reacher');
    el.remove();
  });
});

describe('PrimeVideoAdapter.getBadgeContainer()', () => {
  const adapter = new global.PrimeVideoAdapter();

  test('returns img parent when img is present', () => {
    const card = document.createElement('a');
    const imgWrapper = document.createElement('div');
    const img = document.createElement('img');
    imgWrapper.appendChild(img);
    card.appendChild(imgWrapper);
    document.body.appendChild(card);

    expect(adapter.getBadgeContainer(card)).toBe(imgWrapper);
    card.remove();
  });

  test('returns card itself when no img is present', () => {
    const card = document.createElement('a');
    document.body.appendChild(card);

    expect(adapter.getBadgeContainer(card)).toBe(card);
    card.remove();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HotstarAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe('HotstarAdapter.isActive()', () => {
  const adapter = new global.HotstarAdapter();

  test('returns true for hotstar.com', () => {
    setLocation('www.hotstar.com');
    expect(adapter.isActive()).toBe(true);
  });

  test('returns false for netflix.com', () => {
    setLocation('www.netflix.com');
    expect(adapter.isActive()).toBe(false);
  });
});

describe('HotstarAdapter.extractTitleFromCard()', () => {
  const adapter = new global.HotstarAdapter();

  test('extracts title from img alt attribute', () => {
    const article = document.createElement('article');
    const img = document.createElement('img');
    img.setAttribute('alt', 'Sacred Games');
    article.appendChild(img);
    document.body.appendChild(article);

    const result = adapter.extractTitleFromCard(article);
    expect(result.title).toBe('Sacred Games');
    article.remove();
  });

  test('returns null for hs-image element that is inside an article (deferred to article scan)', () => {
    const article = document.createElement('article');
    const container = document.createElement('div');
    container.setAttribute('data-testid', 'hs-image');
    article.appendChild(container);
    document.body.appendChild(article);

    const result = adapter.extractTitleFromCard(container);
    expect(result).toBeNull();
    article.remove();
  });

  test('falls back to h2 text content', () => {
    const article = document.createElement('article');
    const h2 = document.createElement('h2');
    h2.textContent = 'Mirzapur';
    article.appendChild(h2);
    document.body.appendChild(article);

    const result = adapter.extractTitleFromCard(article);
    expect(result.title).toBe('Mirzapur');
    article.remove();
  });
});

describe('HotstarAdapter.getBadgeContainer()', () => {
  const adapter = new global.HotstarAdapter();

  test('returns hs-image container for ARTICLE elements', () => {
    const article = document.createElement('article');
    const imgContainer = document.createElement('div');
    imgContainer.setAttribute('data-testid', 'hs-image');
    article.appendChild(imgContainer);
    document.body.appendChild(article);

    expect(adapter.getBadgeContainer(article)).toBe(imgContainer);
    article.remove();
  });

  test('returns the element itself if not an ARTICLE', () => {
    const div = document.createElement('div');
    div.setAttribute('data-testid', 'hs-image');
    document.body.appendChild(div);

    expect(adapter.getBadgeContainer(div)).toBe(div);
    div.remove();
  });
});
