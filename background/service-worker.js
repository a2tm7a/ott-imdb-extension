// ============================================================
// Service Worker – handles OMDb API calls on behalf of
// content scripts (avoids CORS) and caches results.
// ============================================================

const OMDB_BASE = 'https://www.omdbapi.com/';

// In-memory cache (lives as long as the service worker is alive)
const memCache = new Map();

// ── Helpers ────────────────────────────────────────────────

async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['omdbApiKey'], (result) => {
      resolve(result.omdbApiKey || null);
    });
  });
}

// ── Core fetch ─────────────────────────────────────────────

async function fetchRatingFromOMDb(title, year) {
  const apiKey = await getApiKey();
  if (!apiKey) return { error: 'NO_API_KEY' };

  const cacheKey = `${title.toLowerCase()}|${year || ''}`;
  if (memCache.has(cacheKey)) {
    return memCache.get(cacheKey);
  }

  const params = new URLSearchParams({ apikey: apiKey, t: title, type: 'movie' });
  if (year) params.set('y', year);

  let data = await queryOMDb(params);

  // If no movie match, try series
  if (!data || data.Response === 'False') {
    params.set('type', 'series');
    data = await queryOMDb(params);
  }

  if (!data || data.Response === 'False') {
    const result = { error: 'NOT_FOUND', title };
    memCache.set(cacheKey, result);
    return result;
  }

  const result = {
    imdbRating: data.imdbRating !== 'N/A' ? data.imdbRating : null,
    imdbID: data.imdbID,
    title: data.Title,
    year: data.Year,
    type: data.Type,
  };

  memCache.set(cacheKey, result);
  return result;
}

async function queryOMDb(params) {
  try {
    const resp = await fetch(`${OMDB_BASE}?${params.toString()}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.error('[IMDB OTT SW] fetch error:', e);
    return null;
  }
}

// ── Message listener ───────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_RATING') {
    fetchRatingFromOMDb(message.title, message.year)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.sync.set(message.settings, () => sendResponse({ ok: true }));
    return true;
  }
});
