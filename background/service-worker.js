// ============================================================
// Service Worker – handles OMDb API calls on behalf of
// content scripts (avoids CORS) and caches results.
// ============================================================

const OMDB_BASE = 'https://www.omdbapi.com/';

// In-memory cache (lives as long as the service worker is alive)
const memCache = new Map();

console.log('[IMDB OTT SW] Service worker started.');

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
  if (!apiKey) {
    console.warn('[IMDB OTT SW] No API key configured. Set one via the extension popup.');
    return { error: 'NO_API_KEY' };
  }

  const cacheKey = `${title.toLowerCase()}|${year || ''}`;

  if (memCache.has(cacheKey)) {
    console.debug(`[IMDB OTT SW] Cache HIT → "${title}"`);
    return memCache.get(cacheKey);
  }

  console.log(`[IMDB OTT SW] Fetching rating for: "${title}"${year ? ` (${year})` : ''}`);

  const params = new URLSearchParams({ apikey: apiKey, t: title, type: 'movie' });
  if (year) params.set('y', year);

  let data = await queryOMDb(params);

  // If no movie match, try series
  if (!data || data.Response === 'False') {
    console.debug(`[IMDB OTT SW] No movie match for "${title}", retrying as series…`);
    params.set('type', 'series');
    data = await queryOMDb(params);
  }

  if (!data || data.Response === 'False') {
    console.warn(`[IMDB OTT SW] Not found on OMDb: "${title}"`);
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

  if (!result.imdbRating) {
    console.warn(`[IMDB OTT SW] Found "${data.Title}" but rating is N/A — skipping badge.`);
  } else {
    console.log(`[IMDB OTT SW] ✓ "${data.Title}" → ⭐ ${result.imdbRating} (${data.Type}, ${data.Year}) [${data.imdbID}]`);
  }

  memCache.set(cacheKey, result);
  console.debug(`[IMDB OTT SW] Cache size: ${memCache.size} entries`);
  return result;
}

async function queryOMDb(params) {
  const url = `${OMDB_BASE}?${params.toString()}`;
  console.debug(`[IMDB OTT SW] GET ${url.replace(/apikey=[^&]+/, 'apikey=***')}`);
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[IMDB OTT SW] OMDb HTTP error: ${resp.status} ${resp.statusText}`);
      return null;
    }
    const json = await resp.json();
    if (json.Error) {
      console.debug(`[IMDB OTT SW] OMDb response error: "${json.Error}"`);
    }
    return json;
  } catch (e) {
    console.error('[IMDB OTT SW] Network error reaching OMDb:', e.message);
    return null;
  }
}

// ── Message listener ───────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabInfo = sender.tab ? `tab ${sender.tab.id}` : 'unknown tab';

  if (message.type === 'FETCH_RATING') {
    console.debug(`[IMDB OTT SW] Message received: FETCH_RATING "${message.title}" from ${tabInfo}`);
    fetchRatingFromOMDb(message.title, message.year)
      .then(sendResponse)
      .catch((err) => {
        console.error(`[IMDB OTT SW] Unhandled error for "${message.title}":`, err);
        sendResponse({ error: err.message });
      });
    return true; // keep channel open for async response
  }

  if (message.type === 'SAVE_SETTINGS') {
    console.log('[IMDB OTT SW] Saving settings to chrome.storage.sync…', {
      hasApiKey: !!message.settings.omdbApiKey,
      platforms: message.settings.enabledPlatforms,
    });
    chrome.storage.sync.set(message.settings, () => {
      if (chrome.runtime.lastError) {
        console.error('[IMDB OTT SW] Failed to save settings:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      console.log('[IMDB OTT SW] Settings saved.');
      sendResponse({ ok: true });
    });
    return true;
  }

  console.warn('[IMDB OTT SW] Unknown message type:', message.type);
});
