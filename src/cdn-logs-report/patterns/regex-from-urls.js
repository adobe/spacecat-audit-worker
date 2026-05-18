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

// Generate a CDN-log-tolerant regex for a category given the URLs that belong
// to it.
//
// HARD CONTRACT: the regex MUST match every URL the caller provides. We try
// strategies in order of generalisability (best regex for unseen URLs first)
// and validate at each step. If a strategy fails to match all inputs we fall
// through to the next. The last strategy is a literal alternation of the input
// paths, which always matches but does not generalise.

const PAGE_EXT_RE = /\.(?:html?|aspx?|php|jsp|do|action|xml)$/i;
const MIN_TOKEN_LEN = 3;
const STOP_TOKENS = new Set([
  'html', 'htm', 'aspx', 'php', 'jsp', 'xml', 'pdf',
  'www', 'index', 'page', 'pages',
]);
const END_BOUNDARY = '(/|$|\\?|#|\\.)';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  return p.replace(/^\//, '').split('/').filter(Boolean).map((s) => s.replace(PAGE_EXT_RE, ''));
}

function tokensOf(p) {
  const out = new Set();
  p.toLowerCase().split(/[/\-_.]+/).forEach((t) => {
    if (t.length >= MIN_TOKEN_LEN && !/^\d+$/.test(t) && !STOP_TOKENS.has(t)) {
      out.add(t);
    }
  });
  return out;
}

// Compile a regex string (strips our (?i) prefix and applies the 'i' flag).
function compile(re) {
  return new RegExp(re.replace(/^\(\?i\)/, ''), 'i');
}

// Does this regex match every one of the supplied paths?
function matchesAll(re, paths) {
  const c = compile(re);
  return paths.every((p) => c.test(p));
}

// ────────────────── strategies ──────────────────

// 1. Common path prefix shared by all URLs (most precise, generalises well).
function tryCommonPrefix(paths) {
  const segLists = paths.map(pathSegments);
  if (segLists.some((s) => s.length === 0)) {
    return null;
  }
  const minLen = Math.min(...segLists.map((s) => s.length));
  const prefix = [];
  for (let i = 0; i < minLen; i += 1) {
    const head = segLists[0][i];
    if (segLists.every((s) => s[i] === head)) {
      prefix.push(head);
    } else {
      break;
    }
  }
  if (!prefix.length) {
    return null;
  }
  return {
    regex: `(?i)(^|/)${prefix.map(escapeRe).join('/')}${END_BOUNDARY}`,
    method: 'prefix',
    evidence: prefix,
  };
}

// 2. A single token that appears in EVERY URL. Generalises best of the
// token-based strategies — one keyword covers all members.
function tryUniversalToken(paths) {
  const tokenSets = paths.map(tokensOf);
  if (!tokenSets.length || tokenSets.some((s) => s.size === 0)) {
    return null;
  }
  // Intersect all token sets.
  const first = [...tokenSets[0]];
  const common = first.filter((t) => tokenSets.every((s) => s.has(t)));
  if (!common.length) {
    return null;
  }
  const tokens = common.sort();
  const alt = tokens.map(escapeRe).join('|');
  return {
    regex: `(?i)(^|/|-)(${alt})(-|/|$|\\?|#|\\.)`,
    method: 'universal-token',
    evidence: tokens,
  };
}

// 3. Disjoint-token cover. Greedy set cover: at each step pick the token that
// covers the most uncovered URLs, until every URL is covered. Lets us produce
// `(women|damen|ladies)` for multi-locale or synonym cases where no single
// token spans all URLs but a small alternation does.
function tryDisjointCover(paths) {
  const tokenSets = paths.map(tokensOf);
  if (tokenSets.some((s) => s.size === 0)) {
    return null;
  }
  // tokenIndex: token → set of path indices that contain it
  const tokenIndex = new Map();
  tokenSets.forEach((set, idx) => {
    set.forEach((t) => {
      if (!tokenIndex.has(t)) {
        tokenIndex.set(t, new Set());
      }
      tokenIndex.get(t).add(idx);
    });
  });

  const uncovered = new Set(paths.map((_, i) => i));
  const chosen = [];
  while (uncovered.size > 0) {
    // Pick token that covers the most uncovered indices; tie-break by token name.
    let best = null;
    let bestCount = 0;
    for (const [t, indices] of tokenIndex) {
      const hit = [...indices].filter((i) => uncovered.has(i)).length;
      if (hit > bestCount || (hit === bestCount && best && t < best)) {
        best = t;
        bestCount = hit;
      }
    }
    if (!best || bestCount === 0) {
      return null; // can't cover everything with tokens
    }
    chosen.push(best);
    tokenIndex.get(best).forEach((i) => uncovered.delete(i));
    tokenIndex.delete(best);
  }
  if (!chosen.length || chosen.length > 6) {
    return null;
  }
  // If we needed one token per URL, this is effectively a literal listing
  // dressed up as tokens — flag it as non-generalising so the caller / UI
  // can show the customer it won't catch new URLs.
  const generalises = chosen.length < paths.length;
  const alt = chosen.map(escapeRe).join('|');
  return {
    regex: `(?i)(^|/|-)(${alt})(-|/|$|\\?|#|\\.)`,
    method: 'disjoint-tokens',
    evidence: chosen,
    generalises,
  };
}

// 4. Literal alternation of the input paths — always matches, never
// generalises. Used as a last resort so the contract "regex matches all
// input URLs" is never violated.
function literalAlternation(paths) {
  const alt = [...new Set(paths)]
    .map((p) => escapeRe(p.replace(/^\//, '')))
    .join('|');
  return {
    regex: `(?i)(^|/)(${alt})${END_BOUNDARY}`,
    method: 'literal',
    evidence: paths,
  };
}

/**
 * Generate a regex that matches every URL in `urls`, plus a "generalisation
 * grade" telling the caller how confident we are about matching future URLs.
 *
 * Strategies, most-to-least general:
 *   prefix          → all URLs share a common path prefix
 *   universal-token → at least one keyword appears in every URL slug
 *   disjoint-tokens → a small alternation (≤6 tokens) covers all URLs
 *   literal         → escaped alternation of the exact paths (never generalises)
 *
 * @param {string} name
 * @param {string[]} urls
 * @returns {{ regex: string, method: string, evidence: string[], generalises: boolean }}
 */
export function regexFromUrls(name, urls) {
  const paths = (urls || []).map(pathOnly).filter(Boolean);

  if (!paths.length) {
    // No URLs given — produce a placeholder from the name. This branch is
    // only reached when the caller violates expectations; we still return
    // something valid rather than throwing.
    const slug = (name || 'unknown')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return {
      regex: `(?i)(^|/|-)${escapeRe(slug)}${END_BOUNDARY.replace('(', '(-|')}`,
      method: 'name-fallback',
      evidence: [slug],
      generalises: false,
    };
  }

  const strategies = [tryCommonPrefix, tryUniversalToken, tryDisjointCover];
  for (const strat of strategies) {
    const result = strat(paths);
    if (result && matchesAll(result.regex, paths)) {
      // Each strategy declares its own generalisation flag where relevant;
      // default to true unless it set false.
      return { generalises: true, ...result };
    }
  }

  // Final fallback: literal alternation. Always matches, never generalises.
  const literal = literalAlternation(paths);
  return { ...literal, generalises: false };
}

export const internals = {
  tryCommonPrefix, tryUniversalToken, tryDisjointCover, literalAlternation, tokensOf, compile,
};
/* c8 ignore end */
