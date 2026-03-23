// ============================================================
// Popup Script – loads/saves settings and wires up UI
// ============================================================

const $ = (id) => document.getElementById(id);

// ── Load saved settings ────────────────────────────────────

chrome.storage.sync.get(['omdbApiKey', 'enabledPlatforms'], (settings) => {
  if (settings.omdbApiKey) {
    $('api-key-input').value = settings.omdbApiKey;
    setApiStatus('✓ API key saved', 'ok');
  }

  const platforms = settings.enabledPlatforms || {};
  $('toggle-netflix').checked = platforms.netflix !== false; // default on
  $('toggle-prime').checked = platforms.prime !== false; // default on
  $('toggle-hotstar').checked = platforms.hotstar !== false; // default on
});

// ── Eye toggle for API key ─────────────────────────────────

$('toggle-key-visibility').addEventListener('click', () => {
  const input = $('api-key-input');
  input.type = input.type === 'password' ? 'text' : 'password';
});

// ── Save button ────────────────────────────────────────────

$('save-btn').addEventListener('click', async () => {
  const apiKey = $('api-key-input').value.trim();

  if (!apiKey) {
    setApiStatus('⚠ Please enter a valid API key', 'error');
    return;
  }

  // OMDb API keys are alphanumeric and at least 8 characters
  if (!/^[a-zA-Z0-9]{8,}$/.test(apiKey)) {
    setApiStatus('⚠ API key format is invalid', 'error');
    return;
  }

  setApiStatus('⌛ Verifying API key...', 'pending');
  $('save-btn').disabled = true;

  try {
    // Test the key with a simple search
    const testUrl = `https://www.omdbapi.com/?apikey=${apiKey}&t=Avengers`;
    const resp = await fetch(testUrl);
    const data = await resp.json();

    if (data.Response === 'False') {
      if (data.Error === 'Invalid API key!') {
        setApiStatus('❌ Invalid API key. Please check your email.', 'error');
        $('save-btn').disabled = false;
        return;
      }
      if (data.Error === 'Request limit reached!') {
        setApiStatus('⚠️ Rate limit reached! (Try again in 24 hours)', 'error');
        $('save-btn').disabled = false;
        return;
      }
      // Other errors (like "Movie not found") actually mean the key IS valid
    }
  } catch (err) {
    console.error('API verification failed:', err);
    // Continue anyway if it's a network error during verification
  }

  const enabledPlatforms = {
    netflix: $('toggle-netflix').checked,
    prime: $('toggle-prime').checked,
    hotstar: $('toggle-hotstar').checked,
  };

  const settings = { omdbApiKey: apiKey, enabledPlatforms };

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
    $('save-btn').disabled = false;
    if (chrome.runtime.lastError) {
      setApiStatus('⚠ Failed to save settings', 'error');
      return;
    }
    setApiStatus('✓ API key verified & saved', 'ok');
    showSaveConfirmation();

    // Notify active tabs to clear badges if a platform was disabled
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SETTINGS_UPDATED',
          enabledPlatforms,
        });
      }
    });
  });
});

// ── Helpers ────────────────────────────────────────────────

function setApiStatus(msg, type) {
  const el = $('api-status');
  el.textContent = msg;
  el.className = `popup__api-status popup__api-status--${type}`;
}

function showSaveConfirmation() {
  const el = $('save-status');
  el.textContent = 'Settings saved!';
  el.classList.add('popup__save-status--visible');
  setTimeout(() => el.classList.remove('popup__save-status--visible'), 2000);
}
