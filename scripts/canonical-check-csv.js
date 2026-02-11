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
 * Canonical check CSV – use fetch (browser-like) to validate canonicals and add two columns.
 *
 * Reads a CSV with columns: Page, Canonical Issue Type, Explanation, Suggestion.
 * For each unique Page URL: fetches HTML with fetch() and browser-like headers,
 * extracts canonical link, checks if valid (same domain + 2xx). Writes CSV with
 * "Canonical URL" and "Canonical Valid" columns.
 *
 * Usage:
 *   node scripts/canonical-check-csv.js [input.csv [output.csv]]
 *
 * Default: input.csv = hdfc-canonical.csv, output = hdfc-canonical-with-validation.csv
 *
 * Requires Node 18+ (for fetch).
 */

const fs = require('fs');
const path = require('path');

const REQUEST_TIMEOUT_MS = 25000;
const HEAD_TIMEOUT_MS = 15000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1'
};

const CANONICAL_RE = /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/gi;
const CANONICAL_RE_ALT = /<link\s+href=["']([^"']+)["']\s+rel=["']canonical["']/gi;

function extractCanonical(html) {
  const candidates = [];
  let m;
  CANONICAL_RE.lastIndex = 0;
  while ((m = CANONICAL_RE.exec(html)) !== null) candidates.push(m[1].trim());
  CANONICAL_RE_ALT.lastIndex = 0;
  while ((m = CANONICAL_RE_ALT.exec(html)) !== null) candidates.push(m[1].trim());
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          i++;
          if (line[i] === '"') { field += '"'; i++; continue; }
          break;
        }
        field += line[i++];
      }
      out.push(field);
      if (line[i] === ',') i++;
      continue;
    }
    let field = '';
    while (i < line.length && line[i] !== ',') field += line[i++];
    out.push(field.trim());
    if (line[i] === ',') i++;
  }
  return out;
}

function escapeCsvField(s) {
  const str = String(s == null ? '' : s);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.length > 0);
  if (!lines.length) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(l => parseCsvLine(l));
  return { header, rows };
}

function serializeCsv(header, rows) {
  const out = [header.map(escapeCsvField).join(',')];
  for (const row of rows) {
    out.push(header.map((_, i) => escapeCsvField(row[i])).join(','));
  }
  return out.join('\n');
}

function getPageIndex(header) {
  const h = header.map(x => String(x).toLowerCase());
  const i = h.findIndex(x => x === 'page');
  if (i >= 0) return i;
  return h.findIndex(x => x.includes('page')) >= 0 ? h.findIndex(x => x.includes('page')) : 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal, headers: { ...BROWSER_HEADERS, ...options.headers } });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function fetchPage(url) {
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' });
    if (!res.ok) return { canonical: null, error: `HTTP ${res.status}` };
    const html = await res.text();
    const canonical = extractCanonical(html);
    return { canonical, error: null };
  } catch (e) {
    return { canonical: null, error: (e.message || String(e)).slice(0, 80) };
  }
}

async function checkCanonicalReachable(canonicalUrl) {
  try {
    const res = await fetchWithTimeout(canonicalUrl, { method: 'HEAD' }, HEAD_TIMEOUT_MS);
    if (res.ok) return true;
    if (res.status === 405) {
      const res2 = await fetchWithTimeout(canonicalUrl, { method: 'GET' }, HEAD_TIMEOUT_MS);
      return res2.ok;
    }
    return false;
  } catch (_) {
    try {
      const res = await fetchWithTimeout(canonicalUrl, { method: 'GET' }, HEAD_TIMEOUT_MS);
      return res.ok;
    } catch (_) {
      return false;
    }
  }
}

async function isCanonicalValid(pageUrl, canonicalUrl) {
  if (!canonicalUrl || !/^https?:\/\//i.test(canonicalUrl)) return false;
  try {
    const pageHost = new URL(pageUrl).hostname.toLowerCase();
    const canonHost = new URL(canonicalUrl).hostname.toLowerCase();
    if (pageHost !== canonHost) return false;
  } catch (_) {
    return false;
  }
  return await checkCanonicalReachable(canonicalUrl);
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || 'hdfc-canonical.csv');
  const outputPath = path.resolve(process.argv[3] || inputPath.replace(/(\.csv)?$/i, '-with-validation.csv'));

  if (!fs.existsSync(inputPath)) {
    console.error('Error: Input file not found:', inputPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const { header, rows } = parseCsv(raw);
  const pageCol = getPageIndex(header);
  const newHeader = [...header, 'Canonical URL', 'Canonical Valid'];

  const uniquePages = [...new Set(rows.map(r => (r[pageCol] || '').trim()).filter(Boolean))];
  const cache = {};

  for (const page of uniquePages) {
    process.stdout.write(`Fetching: ${page}\n`);
    const { canonical, error } = await fetchPage(page);
    if (error) {
      cache[page] = { canonical: null, valid: false };
      process.stdout.write(`  -> error: ${error}\n`);
      continue;
    }
    const valid = await isCanonicalValid(page, canonical);
    cache[page] = { canonical: canonical || '', valid };
    process.stdout.write(`  -> canonical: ${canonical || '(none)'}; valid: ${valid}\n`);
  }

  const newRows = rows.map(row => {
    const page = (row[pageCol] || '').trim();
    const { canonical = '', valid = false } = cache[page] || {};
    return [...row, canonical || '', valid ? 'Yes' : 'No'];
  });

  const outCsv = serializeCsv(newHeader, newRows);
  fs.writeFileSync(outputPath, outCsv, 'utf8');
  console.log('Wrote', newRows.length, 'rows to', outputPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
