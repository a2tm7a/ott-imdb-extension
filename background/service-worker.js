// ============================================================
// Service Worker – handles OMDb API calls on behalf of
// content scripts (avoids CORS) and caches results.
// ============================================================

const OMDB_BASE = 'https://www.omdbapi.com/';
const DEBUG = false;
const MAX_CACHE_SIZE = 500;
const FETCH_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;

// In-memory cache (lives as long as the service worker is alive)
const memCache = new Map();

const log = (...args) => { if (DEBUG) console.log(...args); };
const logDebug = (...args) => { if (DEBUG) console.debug(...args); };
const logWarn = (...args) => { if (DEBUG) console.warn(...args); };

log('[IMDB OTT SW] Service worker started.');

// ── Helpers ────────────────────────────────────────────────

async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['omdbApiKey'], (result) => {
      resolve(result.omdbApiKey || null);
    });
  });
}

function setCacheEntry(key, value) {
  // Evict oldest entry when cache is full (FIFO)
  if (memCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = memCache.keys().next().value;
    memCache.delete(oldestKey);
    logDebug(`[IMDB OTT SW] Cache full — evicted oldest entry.`);
  }
  memCache.set(key, value);
}

// ── Core fetch ─────────────────────────────────────────────

async function fetchRatingFromOMDb(title, year) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    logWarn('[IMDB OTT SW] No API key configured. Set one via the extension popup.');
    return { error: 'NO_API_KEY' };
  }

  const cacheKey = `${title.toLowerCase()}|${year || ''}`;

  if (memCache.has(cacheKey)) {
    logDebug(`[IMDB OTT SW] Cache HIT → "${title}"`);
    return memCache.get(cacheKey);
  }

  log(`[IMDB OTT SW] Fetching rating for: "${title}"${year ? ` (${year})` : ''}`);

  const params = new URLSearchParams({ apikey: apiKey, t: title, type: 'movie' });
  if (year) params.set('y', year);

  let data = await queryOMDb(params);

  // If no movie match, try series
  if (!data || data.Response === 'False') {
    logDebug(`[IMDB OTT SW] No movie match for "${title}", retrying as series…`);
    params.set('type', 'series');
    data = await queryOMDb(params);
  }

  if (!data || data.Response === 'False') {
    logWarn(`[IMDB OTT SW] Not found on OMDb: "${title}"`);
    const result = { error: 'NOT_FOUND', title };
    setCacheEntry(cacheKey, result);
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
    logWarn(`[IMDB OTT SW] Found "${data.Title}" but rating is N/A — skipping badge.`);
  } else {
    log(`[IMDB OTT SW] ✓ "${data.Title}" → ⭐ ${result.imdbRating} (${data.Type}, ${data.Year}) [${data.imdbID}]`);
  }

  setCacheEntry(cacheKey, result);
  logDebug(`[IMDB OTT SW] Cache size: ${memCache.size} entries`);
  return result;
}

async function queryOMDb(params) {
  const url = `${OMDB_BASE}?${params.toString()}`;
  logDebug(`[IMDB OTT SW] GET ${url.replace(/apikey=[^&]+/, 'apikey=***')}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        console.error(`[IMDB OTT SW] OMDb HTTP error: ${resp.status} ${resp.statusText}`);
        return null;
      }
      const json = await resp.json();
      if (json.Error) {
        logDebug(`[IMDB OTT SW] OMDb response error: "${json.Error}"`);
      }
      return json;
    } catch (e) {
      clearTimeout(timeoutId);
      const isTimeout = e.name === 'AbortError';
      const label = isTimeout ? 'Timeout' : 'Network error';
      if (attempt < MAX_RETRIES) {
        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(`[IMDB OTT SW] ${label} on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        console.error(`[IMDB OTT SW] ${label} after ${MAX_RETRIES} attempts:`, e.message);
      }
    }
  }
  return null;
}

// ── Message listener ───────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabInfo = sender.tab ? `tab ${sender.tab.id}` : 'unknown tab';

  if (message.type === 'FETCH_RATING') {
    logDebug(`[IMDB OTT SW] Message received: FETCH_RATING "${message.title}" from ${tabInfo}`);
    fetchRatingFromOMDb(message.title, message.year)
      .then(sendResponse)
      .catch((err) => {
        console.error(`[IMDB OTT SW] Unhandled error for "${message.title}":`, err);
        sendResponse({ error: err.message });
      });
    return true; // keep channel open for async response
  }

  if (message.type === 'SAVE_SETTINGS') {
    log('[IMDB OTT SW] Saving settings to chrome.storage.sync…', {
      hasApiKey: !!message.settings.omdbApiKey,
      platforms: message.settings.enabledPlatforms,
    });
    chrome.storage.sync.set(message.settings, () => {
      if (chrome.runtime.lastError) {
        console.error('[IMDB OTT SW] Failed to save settings:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      log('[IMDB OTT SW] Settings saved.');
      sendResponse({ ok: true });
    });
    return true;
  }

  console.warn('[IMDB OTT SW] Unknown message type:', message.type);
});
