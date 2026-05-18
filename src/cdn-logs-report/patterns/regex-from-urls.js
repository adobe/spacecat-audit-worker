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

/* c8 ignore start */

// Build a CDN-log-tolerant regex from a set of URLs. The returned regex
// matches every input URL; strategies are most-to-least general; the literal
// fallback always matches but does not generalise.

const PAGE_EXT_RE = /\.(?:html?|aspx?|php|jsp|do|action|xml)$/i;
const STOP_TOKENS = new Set([
  'html', 'htm', 'aspx', 'php', 'jsp', 'xml', 'pdf',
  'www', 'index', 'page', 'pages',
]);
const MIN_TOKEN_LEN = 3;
const END = '(/|$|\\?|#|\\.)';
const TOKEN_END = '(-|/|$|\\?|#|\\.)';
const MAX_TOKENS_IN_COVER = 6;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compile = (re) => new RegExp(re.replace(/^\(\?i\)/, ''), 'i');
const matchesAll = (re, paths) => paths.every((p) => compile(re).test(p));

function pathOnly(u) {
  try {
    return new URL(u).pathname.replace(/\/+$/, '');
  } catch {
    return String(u || '').split(/[?#]/)[0].replace(/\/+$/, '');
  }
}

function pathSegments(p) {
  if (!p || p === '/') {
    return [];
  }
  return p.replace(/^\//, '').split('/').filter(Boolean)
    .map((s) => s.replace(PAGE_EXT_RE, ''));
}

function tokensOf(p) {
  const out = new Set();
  for (const t of p.toLowerCase().split(/[/\-_.]+/)) {
    if (t.length >= MIN_TOKEN_LEN && !/^\d+$/.test(t) && !STOP_TOKENS.has(t)) {
      out.add(t);
    }
  }
  return out;
}

function commonPrefix(paths) {
  const lists = paths.map(pathSegments);
  if (lists.some((s) => s.length === 0)) {
    return [];
  }
  const min = Math.min(...lists.map((s) => s.length));
  const out = [];
  for (let i = 0; i < min; i += 1) {
    const head = lists[0][i];
    if (!lists.every((s) => s[i] === head)) {
      break;
    }
    out.push(head);
  }
  return out;
}

function universalTokens(paths) {
  const sets = paths.map(tokensOf);
  if (!sets.length || sets.some((s) => s.size === 0)) {
    return [];
  }
  return [...sets[0]].filter((t) => sets.every((s) => s.has(t))).sort();
}

// Greedy set-cover: smallest set of tokens whose union covers all URLs.
function disjointCover(paths) {
  const sets = paths.map(tokensOf);
  if (sets.some((s) => s.size === 0)) {
    return [];
  }

  const tokenToIdx = new Map();
  sets.forEach((s, i) => s.forEach((t) => {
    if (!tokenToIdx.has(t)) {
      tokenToIdx.set(t, new Set());
    }
    tokenToIdx.get(t).add(i);
  }));

  const uncovered = new Set(paths.map((_, i) => i));
  const chosen = [];
  while (uncovered.size > 0) {
    let bestTok = null;
    let bestHit = 0;
    for (const [t, idxs] of tokenToIdx) {
      const hit = [...idxs].filter((i) => uncovered.has(i)).length;
      if (hit > bestHit || (hit === bestHit && bestTok && t < bestTok)) {
        bestTok = t;
        bestHit = hit;
      }
    }
    if (!bestTok || bestHit === 0) {
      return [];
    }
    chosen.push(bestTok);
    tokenToIdx.get(bestTok).forEach((i) => uncovered.delete(i));
    tokenToIdx.delete(bestTok);
  }
  return chosen.length > MAX_TOKENS_IN_COVER ? [] : chosen;
}

function tryRegex(method, evidence, paths, regex, generalises = true) {
  if (!matchesAll(regex, paths)) {
    return null;
  }
  return {
    regex, method, evidence, generalises,
  };
}

function literalFallback(paths) {
  const alt = [...new Set(paths)].map((p) => escapeRe(p.replace(/^\//, ''))).join('|');
  return {
    regex: `(?i)(^|/)(${alt})${END}`,
    method: 'literal',
    evidence: paths,
    generalises: false,
  };
}

/**
 * Generate a regex that matches every URL in `urls`.
 * Returns `{ regex, method, evidence, generalises }`.
 */
export function regexFromUrls(name, urls) {
  const paths = (urls || []).map(pathOnly).filter(Boolean);

  if (!paths.length) {
    const slug = (name || 'unknown')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return {
      regex: `(?i)(^|/|-)${escapeRe(slug)}${TOKEN_END}`,
      method: 'name-fallback',
      evidence: [slug],
      generalises: false,
    };
  }

  const prefix = commonPrefix(paths);
  if (prefix.length) {
    const r = tryRegex(
      'prefix',
      prefix,
      paths,
      `(?i)(^|/)${prefix.map(escapeRe).join('/')}${END}`,
    );
    if (r) {
      return r;
    }
  }

  const uni = universalTokens(paths);
  if (uni.length) {
    const r = tryRegex(
      'universal-token',
      uni,
      paths,
      `(?i)(^|/|-)(${uni.map(escapeRe).join('|')})${TOKEN_END}`,
    );
    if (r) {
      return r;
    }
  }

  const cover = disjointCover(paths);
  if (cover.length) {
    const r = tryRegex(
      'disjoint-tokens',
      cover,
      paths,
      `(?i)(^|/|-)(${cover.map(escapeRe).join('|')})${TOKEN_END}`,
      cover.length < paths.length,
    );
    if (r) {
      return r;
    }
  }

  return literalFallback(paths);
}

export const internals = {
  commonPrefix, universalTokens, disjointCover, literalFallback, tokensOf,
};
/* c8 ignore end */
