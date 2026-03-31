/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

const MIN_WORD_LEN = 3;

/** @param {string} url */
export function normalizeForScore(url) {
  const s = (url || '').trim();
  if (!s) return ['', ''];
  try {
    const href = s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;
    const u = new URL(href);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return [host, path];
  } catch {
    return ['', ''];
  }
}

/** @param {string} path */
export function pathSegmentsForScore(path) {
  return path.split('/').filter(Boolean);
}

/**
 * Score a suggested replacement URL against a broken target URL.
 * Uses domain match, path overlap, section and slug heuristics.
 *
 * @param {string} brokenUrl
 * @param {string} suggestedUrl
 * @returns {{ score: number, reason: string }}
 *   score 0 = irrelevant (should be filtered out)
 *   score (0…1] = relevant, higher is better
 */
export function scoreSuggestion(brokenUrl, suggestedUrl) {
  if (!(brokenUrl || '').trim() || !(suggestedUrl || '').trim()) {
    return { score: 0, reason: 'skipped' };
  }

  const [bHost, bPath] = normalizeForScore(brokenUrl);
  const [sHost, sPath] = normalizeForScore(suggestedUrl);

  if (bHost !== sHost) {
    return { score: 0, reason: `wrong domain: ${sHost} ≠ ${bHost}` };
  }

  if (sPath === '' || sPath === '/') {
    return { score: 0, reason: 'homepage fallback' };
  }

  const bSegs = pathSegmentsForScore(bPath);
  const sSegs = pathSegmentsForScore(sPath);

  if (bPath === sPath) {
    return { score: 1.0, reason: 'exact path match' };
  }

  const bSlug = bPath.replace(/[-_]/g, '');
  const sSlug = sPath.replace(/[-_]/g, '');
  if (bSlug === sSlug) {
    return { score: 0.95, reason: 'slug correction' };
  }

  const bWords = new Set(bPath.split(/[-_/]/).filter((w) => w.length >= MIN_WORD_LEN));
  const sWords = new Set(sPath.split(/[-_/]/).filter((w) => w.length >= MIN_WORD_LEN));
  const overlap = [...bWords].filter((w) => sWords.has(w));
  const union = new Set([...bWords, ...sWords]);
  const overlapRatio = overlap.length / Math.max(union.size, 1);

  let prefixCommon = 0;
  const len = Math.min(bSegs.length, sSegs.length);
  for (let i = 0; i < len; i += 1) {
    if (bSegs[i] === sSegs[i]) prefixCommon += 1;
    else break;
  }

  const totalCommon = bSegs.filter((seg) => sSegs.includes(seg)).length;
  const sameSection = Boolean(bSegs.length && sSegs.length && bSegs[0] === sSegs[0]);

  const pct = (r) => `${Math.round(r * 100)}%`;

  if (prefixCommon >= 2 && overlapRatio >= 0.4) {
    return {
      score: 0.7 + overlapRatio * 0.25,
      reason: `strong path match (${prefixCommon} prefix segments, ${pct(overlapRatio)} keyword overlap)`,
    };
  }

  if (totalCommon >= 2 && overlapRatio >= 0.35) {
    return {
      score: 0.6 + overlapRatio * 0.25,
      reason: `structural match (${totalCommon} shared segments, ${pct(overlapRatio)} keyword overlap)`,
    };
  }

  if (sameSection && overlapRatio >= 0.25) {
    return {
      score: 0.4 + overlapRatio * 0.2,
      reason: `same section /${bSegs[0]}/, ${pct(overlapRatio)} keyword overlap`,
    };
  }

  if (overlapRatio >= 0.3) {
    return {
      score: 0.3 + overlapRatio * 0.2,
      reason: `keyword overlap ${pct(overlapRatio)}: ${[...overlap].sort().join(', ')}`,
    };
  }

  if (sameSection && overlap.length > 0) {
    return {
      score: 0.2 + (overlap.length / Math.max(union.size, 1)) * 0.15,
      reason: `same section /${bSegs[0]}/, weak overlap: ${[...overlap].sort().join(', ')}`,
    };
  }

  return { score: 0, reason: 'unrelated' };
}
