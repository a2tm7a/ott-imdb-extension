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

  const enabledPlatforms = {
    netflix: $('toggle-netflix').checked,
    prime: false,
    hotstar: false,
  };

  const settings = { omdbApiKey: apiKey, enabledPlatforms };

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, () => {
    if (chrome.runtime.lastError) {
      setApiStatus('⚠ Failed to save settings', 'error');
      return;
    }
    setApiStatus('✓ API key saved', 'ok');
    showSaveConfirmation();
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
