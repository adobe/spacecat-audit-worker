#!/usr/bin/env node
/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Validates sitemap REDIRECT_UPDATE suggestions from an opportunity JSON file.
 *
 * Reads JSON with opportunity + suggestions, filters for status=NEW and type=REDIRECT_UPDATE,
 * fetches each pageUrl (following redirects), then compares the final URL to urlsSuggested.
 * Outputs a CSV: sitemap, url, suggestion_type, final_redirect_url, status_code, suggested_url, match.
 * suggestion_type: "redirect" or "404". For 404 suggestions, match is Yes if fetch returned 404, else No.
 *
 * Usage:
 *   node scripts/validate-sitemap-suggestions.js [input.json [output.csv]]
 *
 * Default: input = opp-hdfc.bank.in-sitemap-12_02_2026.json, output = sitemap-suggestions-validation.csv
 *
 * Requires Node 18+ (fetch). Uses a short delay between requests.
 */

import fs from 'fs';
import path from 'path';

const REQUEST_TIMEOUT_MS = 25000;
const DELAY_BETWEEN_REQUESTS_MS = 500;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function escapeCsvField(s) {
  const str = String(s == null ? '' : s);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** Normalize URL for comparison: lowercase, strip trailing slash, no fragment. */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

/** For redirect suggestions: does final URL equal suggested URL? For 404 suggestions: did we get 404? */
function getMatch(suggestionStatusCode, fetchedStatusCode, finalUrl, urlsSuggested) {
  if (suggestionStatusCode === 404) {
    return fetchedStatusCode === 404 ? 'Yes' : 'No';
  }
  if (!urlsSuggested) return 'N/A';
  return normalizeUrl(finalUrl) === normalizeUrl(urlsSuggested) ? 'Yes' : 'No';
}

function getSuggestionType(statusCode) {
  if (statusCode === 404) return '404';
  if (statusCode >= 300 && statusCode < 400) return 'redirect';
  return statusCode != null ? 'redirect' : '';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { ...BROWSER_HEADERS, ...options.headers },
      signal: ctrl.signal,
      ...options
    });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/** Fetch pageUrl and return the final URL after redirects. */
async function getFinalRedirectUrl(pageUrl) {
  try {
    const res = await fetchWithTimeout(pageUrl);
    return { finalUrl: res.url, statusCode: res.status, error: null };
  } catch (e) {
    return { finalUrl: '', statusCode: null, error: (e.message || String(e)).slice(0, 120) };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const defaultInput = path.join(path.dirname(new URL(import.meta.url).pathname), 'opp-hdfc.bank.in-sitemap-12_02_2026.json');
  const inputPath = path.resolve(process.argv[2] || defaultInput);
  const defaultOutput = path.join(path.dirname(inputPath), 'sitemap-suggestions-validation.csv');
  const outputPath = path.resolve(process.argv[3] || defaultOutput);

  if (!fs.existsSync(inputPath)) {
    console.error('Error: Input file not found:', inputPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Error: Invalid JSON in', inputPath, e.message);
    process.exit(1);
  }

  const suggestions = (data.suggestions || [])
    .filter(s => s.status === 'NEW' && s.type === 'REDIRECT_UPDATE');

  if (!suggestions.length) {
    console.log('No NEW REDIRECT_UPDATE suggestions found.');
    fs.writeFileSync(outputPath, 'sitemap,url,suggestion_type,final_redirect_url,status_code,suggested_url,match\n', 'utf8');
    console.log('Wrote empty CSV to', outputPath);
    return;
  }

  const header = ['sitemap', 'url', 'suggestion_type', 'final_redirect_url', 'status_code', 'suggested_url', 'match'];
  const rows = [];

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    const d = s.data || {};
    const sitemapUrl = d.sitemapUrl || '';
    const pageUrl = d.pageUrl || '';
    const urlsSuggested = d.urlsSuggested ?? '';
    const suggestionStatusCode = d.statusCode;
    const suggestionType = getSuggestionType(suggestionStatusCode);

    process.stdout.write(`[${i + 1}/${suggestions.length}] ${pageUrl}\n`);

    const { finalUrl, statusCode: fetchedStatusCode, error } = await getFinalRedirectUrl(pageUrl);
    const match = getMatch(suggestionStatusCode, fetchedStatusCode, finalUrl, urlsSuggested);

    if (error) process.stdout.write(`  -> error: ${error}\n`);
    else process.stdout.write(`  -> ${suggestionType} | ${fetchedStatusCode} final: ${finalUrl} | match: ${match}\n`);

    rows.push([
      sitemapUrl,
      pageUrl,
      suggestionType,
      error ? `(error: ${error})` : finalUrl,
      fetchedStatusCode != null ? String(fetchedStatusCode) : '',
      urlsSuggested,
      match
    ]);

    if (i < suggestions.length - 1) await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const csvLines = [header.map(escapeCsvField).join(',')];
  for (const row of rows) {
    csvLines.push(row.map(escapeCsvField).join(','));
  }
  fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf8');
  console.log('Wrote', rows.length, 'rows to', outputPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
