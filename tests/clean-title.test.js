/**
 * Tests for the cleanTitle() methods on each platform adapter.
 *
 * cleanTitle() is a pure string-transformation function on each adapter class,
 * so no DOM or Chrome API setup is required — we just load the source files,
 * instantiate each adapter, and call cleanTitle directly.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Load sources ──────────────────────────────────────────────────────────────

function loadSrc(file) {
  const src = fs.readFileSync(path.resolve(__dirname, '../content-scripts', file), 'utf8');
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

// BaseAdapter must be loaded first (subclasses extend it).
loadSrc('base-adapter.js');
loadSrc('netflix.js');
loadSrc('prime.js');
loadSrc('hotstar.js');

// ── NetflixAdapter.cleanTitle ─────────────────────────────────────────────────

describe('NetflixAdapter.cleanTitle', () => {
  const adapter = new global.NetflixAdapter();

  const cases = [
    // [raw input, expected output, description]
    ['Stranger Things', 'Stranger Things', 'plain title unchanged'],
    ['Breaking Bad Season 5', 'Breaking Bad', 'strips " Season N"'],
    ['Ozark: Season 4', 'Ozark', 'strips ": Season N"'],
    ['The Crown - Series 3', 'The Crown', 'strips " - Series N"'],
    ['Black Mirror S3E1', 'Black Mirror', 'strips SxxExx'],
    ['Mindhunter (2017)', 'Mindhunter', 'strips trailing year in parens'],
    ['The Witcher: Season 2', 'The Witcher', 'strips season after colon'],
    ['Lupin - Netflix', 'Lupin', 'strips suffix'],
    ['Lupin – Netflix', 'Lupin', 'strips suffix'],
    ['Virgin River, New Season', 'Virgin River', 'strips metadata'],
    ['Marriage Story documentary', 'Marriage Story', 'strips word'],
    ['Making a Murderer limited series', 'Making a Murderer', 'strips word'],
  ];

  test.each(cases)('"%s" → "%s" (%s)', (raw, expected) => {
    expect(adapter.cleanTitle(raw)).toBe(expected);
  });
});

// ── PrimeVideoAdapter.cleanTitle ──────────────────────────────────────────────

describe('PrimeVideoAdapter.cleanTitle', () => {
  const adapter = new global.PrimeVideoAdapter();

  const cases = [
    ['The Boys', 'The Boys', 'plain title unchanged'],
    ['Jack Ryan - Season 2', 'Jack Ryan', 'strips "- Season N"'],
    ['The Grand Tour 3 Seasons', 'The Grand Tour', 'strips "N Seasons" count'],
    ['Reacher (2023)', 'Reacher', 'strips trailing year in parens'],
    ['Citadel - Amazon', 'Citadel', 'strips " - Amazon" suffix'],
    ['Rings of Power - Prime Video', 'Rings of Power', 'strips " - Prime Video" suffix'],
    ['Fallout - Prime', 'Fallout', 'strips " - Prime" suffix'],
    ['Carnival Row - New Season', 'Carnival Row -', 'strips new season'],
    ['Fleabag limited series', 'Fleabag', 'strips word'],
    ['Movie included with prime', 'Movie', 'strips word'],
  ];

  test.each(cases)('"%s" → "%s" (%s)', (raw, expected) => {
    expect(adapter.cleanTitle(raw)).toBe(expected);
  });
});

// ── HotstarAdapter.cleanTitle ─────────────────────────────────────────────────

describe('HotstarAdapter.cleanTitle', () => {
  const adapter = new global.HotstarAdapter();

  const cases = [
    ['MS Dhoni: The Untold Story', 'MS Dhoni: The Untold Story', 'unchanged'],
    ['Scam 1992: The Harshad Mehta Story', 'Scam 1992: The Harshad Mehta Story', 'unchanged'],
    ['Sacred Games, Crime, 2h 22m', 'Sacred Games', 'strips word'],
    ['Aarya: Season 3', 'Aarya', 'strips word'],
    ['Sweet Tooth - Hotstar', 'Sweet Tooth', 'strips word'],
    ['Loki – Disney+', 'Loki', 'strips word'],
    ['Avengers: Infinity War documentary', 'Avengers: Infinity War', 'strips word'],
    ['WandaVision limited series', 'WandaVision', 'strips word'],
    ['Tenet trailer', 'Tenet', 'strips word'],
  ];

  test.each(cases)('"%s" → "%s" (%s)', (raw, expected) => {
    expect(adapter.cleanTitle(raw)).toBe(expected);
  });
});
