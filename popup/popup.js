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

$('save-btn').addEventListener('click', () => {
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

  const enabledPlatforms = {
    netflix: $('toggle-netflix').checked,
    prime: $('toggle-prime').checked,
    hotstar: $('toggle-hotstar').checked,
  };

  const settings = { omdbApiKey: apiKey, enabledPlatforms };

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
    if (chrome.runtime.lastError) {
      setApiStatus('⚠ Failed to save settings', 'error');
      return;
    }
    setApiStatus('✓ API key saved', 'ok');
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
