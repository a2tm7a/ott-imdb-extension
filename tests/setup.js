// ─── Global Chrome API mocks ──────────────────────────────────────────────────
// jsdom does not ship with chrome.* globals, so we define lightweight stubs
// that are sufficient for the extension's content-script & service-worker code.

global.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: (path) => `chrome-extension://test-extension-id/${path}`,
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    lastError: null,
  },
  storage: {
    sync: {
      get: jest.fn((_keys, cb) => cb({})),
      set: jest.fn((_data, cb) => cb && cb()),
    },
    local: {
      get: jest.fn((_keys, cb) => cb({})),
      set: jest.fn((_data, cb) => cb && cb()),
    },
  },
};

// Expose Node.ELEMENT_NODE (jsdom sets this on window, but content scripts
// compare against the bare `Node` global).
global.Node = global.Node || { ELEMENT_NODE: 1 };

// Silence console outputs during tests to avoid cluttering the terminal
// with expected error logs from intentional failure tests.
global.console = {
  ...global.console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
