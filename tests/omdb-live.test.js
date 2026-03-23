/**
 * Live Integration Test for OMDb API
 * 
 * This test hits the actual OMDb API over the network.
 * It is skipped by default unless the OMDB_API_KEY environment variable is provided.
 * 
 * To run this test and verify your real API key works:
 * OMDB_API_KEY=your_actual_key_here npm test
 */

'use strict';

const https = require('https');

function fetchOMDb(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

describe('OMDb Live API Integration', () => {
  const apiKey = process.env.OMDB_API_KEY;

  // We use test.skip if no API key is provided in the environment so 
  // the normal test suite doesn't fail on machines without the key.
  const testName = `successfully fetches a rating with OMDB_API_KEY (Current value: ${apiKey ? `'${apiKey}'` : 'Not Set'})`;
  const conditionalTest = apiKey ? test : test.skip;

  conditionalTest(testName, async () => {
    // 1. Fetch "Inception" (2010), IMDb ID tt1375666
    const url = `https://www.omdbapi.com/?apikey=${apiKey}&t=Inception&y=2010&type=movie`;
    
    // Using native https request
    const response = await fetchOMDb(url);
    
    // 2. Validate HTTP status
    expect(response.status).toBe(200);
    
    const data = response.data;
    
    // 3. Validate OMDB Response format
    if (data.Response === 'False') {
      throw new Error(`OMDb API returned an error: ${data.Error} (Is your API key valid?)`);
    }

    expect(data.Response).toBe('True');
    expect(data.Title).toBe('Inception');
    expect(data.imdbID).toBe('tt1375666');
    
    // 4. Validate we got a valid rating back (e.g. "8.8")
    expect(data.imdbRating).toBeDefined();
    expect(data.imdbRating).not.toBe('N/A');
    expect(parseFloat(data.imdbRating)).toBeGreaterThan(8.0);
  });

  test('returns "Invalid API key!" for an intentionally bad API key', async () => {
    const bogusKey = '1234abcd_invalid';
    const url = `https://www.omdbapi.com/?apikey=${bogusKey}&t=Inception`;
    
    const response = await fetchOMDb(url);
    
    // OMDb returns a 401 Unauthorized for invalid keys
    expect(response.status).toBe(401);
    
    const data = response.data;
    expect(data.Response).toBe('False');
    expect(data.Error).toBe('Invalid API key!');
  });
});
