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

// Write-time-in-service category classification for referral URLs (LLMO-6257 P2).
// The JS analogue of the data-service SQL matcher (_safe_regex_match): rules are
// pre-sorted (sort_order ASC, name ASC) by fetchAgenticUrlClassificationRules, the
// first compilable rule whose regex matches wins, an uncompilable/unsafe regex is
// treated as no-match, and an unmatched URL gets no classification (null). The result
// is imported into referral_url_classifications through the projector single-writer
// FIFO. This module is shared by both producers (optel llmo-referral-traffic-daily +
// cdn cdn-logs-report).

// A regex source with an adjacent/nested unbounded quantifier — (a+)+, (a*)*, (.*)+,
// (\w+){2,} — can backtrack catastrophically (ReDoS). Node's RegExp has no execution
// timeout, so reject that shape BEFORE compiling and treat it as a no-match, exactly
// like an uncompilable regex. Conservative — a literal (a\+)+ is also skipped, which
// only drops a classification, never errors. Defense-in-depth for the JS classifier;
// the data-service side is bounded by statement_timeout.
const CATASTROPHIC_QUANTIFIER = /[*+}]\)[*+{]/;

/**
 * True when a regex source has an adjacent/nested unbounded quantifier — (a+)+, (a*)*,
 * (.*)+, (\w+){2,} — that can backtrack catastrophically (ReDoS). Shared so the rule
 * GENERATOR can reject the shape at write-time (nothing unsafe is ever stored, closing
 * the JS/SQL cross-engine parity gap at the source) and the classifier can skip it
 * defensively at match-time. Strips a leading (?i) first, mirroring compilation.
 * @param {string} regex the rule regex source
 * @returns {boolean}
 */
export function isCatastrophicQuantifier(regex) {
  return CATASTROPHIC_QUANTIFIER.test(String(regex).replace(/^\(\?i\)/, ''));
}

// (?i) is an inline modifier Postgres ~* honors; JS RegExp needs it stripped + /i.
// Mirrors compileAthenaRegex so JS classification matches the SQL/read-path behaviour.
// Returns null for an unsafe (catastrophic-backtracking) shape; throws for an
// otherwise-uncompilable pattern — the caller treats both as no-match.
function compileRuleRegex(regex) {
  if (isCatastrophicQuantifier(regex)) {
    return null;
  }
  return new RegExp(String(regex).replace(/^\(\?i\)/, ''), 'i');
}

// Canonical url_path form shared by every audit-worker referral producer (LLMO-6257
// P2, chunk 7). Each source writes url_path into BOTH its traffic export and its
// classification emit, and the referral read-RPC joins them on an exact
// ruc.url_path = referral_traffic_<source>.url_path match, so a single producer must
// use one form on both sides. Before this, optel emitted row.path raw (query kept)
// while cdn stripped only the query — so the same page fragmented into different rows
// across sources. Canonical form: host-stripped (a full URL collapses to its
// pathname), query- and fragment-stripped, duplicate slashes collapsed, exactly one
// leading slash, and no trailing slash except the root '/'. DRS (ga4/aa/cja) does not
// use this — it classifies in-DB against the same url_path it stored, so its join
// lines up by construction (spec §3).
export function canonicalizeUrlPath(path) {
  if (typeof path !== 'string' || path === '') {
    return '/';
  }
  let p = path;
  // A full URL -> pathname only (host-stripped); a bare path won't have a scheme.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      // not a parseable URL; fall through with the raw string
    }
  }
  // Drop fragment then query.
  [p] = p.split('#');
  [p] = p.split('?');
  // Collapse duplicate slashes and force exactly one leading slash.
  p = `/${p.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  // Strip a trailing slash, but never reduce the root below '/'.
  if (p.length > 1) {
    p = p.replace(/\/+$/, '');
  }
  return p;
}

/**
 * Pre-compiles a site's rules once. Regex compilation is O(rules); doing it here
 * (instead of inside the per-URL loop) keeps classification O(URLs + rules)
 * rather than O(URLs * rules). Each entry is {name, re} where re is a compiled
 * RegExp, or null for an unsafe/uncompilable pattern (treated as no-match, parity
 * with the SQL _safe_regex_match). Rule order is preserved (first match wins).
 * @param {Array<{name: string, regex: string}>} rules pre-sorted category rules
 * @returns {Array<{name: string, re: RegExp|null}>}
 */
function compileRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }
  const compiled = [];
  for (const rule of rules) {
    if (rule && typeof rule.regex === 'string' && rule.name) {
      let re = null;
      try {
        re = compileRuleRegex(rule.regex);
      } catch {
        re = null; // uncompilable regex -> no match (parity with _safe_regex_match)
      }
      compiled.push({ name: rule.name, re });
    }
  }
  return compiled;
}

/**
 * Resolves the category for a single URL path against already-compiled rules.
 * First match by rule order wins; null when nothing matches.
 * @returns {string|null}
 */
function matchCompiledRules(compiledRules, urlPath) {
  if (typeof urlPath !== 'string') {
    return null;
  }
  for (const { name, re } of compiledRules) {
    if (re && re.test(urlPath)) {
      return name;
    }
  }
  return null;
}

/**
 * Resolves the category for a single URL path against a site's active rules.
 * Compiles the rule regexes on every call; when classifying many URLs prefer
 * buildClassificationRows, which compiles once. Kept for single-URL callers/tests.
 * @param {Array<{name: string, regex: string}>} rules pre-sorted category rules
 * @param {string} urlPath the URL path to classify
 * @returns {string|null} the matching category name, or null when nothing matches
 */
export function classifyUrlPath(rules, urlPath) {
  if (!Array.isArray(rules) || typeof urlPath !== 'string') {
    return null;
  }
  return matchCompiledRules(compileRules(rules), urlPath);
}

/**
 * Builds the referral_url_classifications rows for a run: one row per distinct
 * (host, url_path) that matches a rule. Unmatched URLs get no row (category is
 * never empty). Category-only — mirrors the referral_url_classifications shape.
 * Rules are compiled once up front, then matched against every distinct URL.
 * @returns {Array<{host, url_path, category_name, updated_by}>}
 */
export function buildClassificationRows(rows, rules, updatedBy) {
  const seen = new Set();
  const classifications = [];
  const compiledRules = compileRules(rules);

  for (const row of rows) {
    const { host, url_path: urlPath } = row;
    const key = `${host}\n${urlPath}`;
    if (!seen.has(key)) {
      seen.add(key);
      const category = matchCompiledRules(compiledRules, urlPath);
      if (category) {
        classifications.push({
          host,
          url_path: urlPath,
          category_name: category,
          updated_by: updatedBy,
        });
      }
    }
  }

  return classifications;
}

// Category-only classification CSV (host,url_path,category_name,updated_by) — the
// single serializer shared by both producers (optel + cdn), imported into
// referral_url_classifications by the projector via wrpc_import_referral_url_classifications.
export const CLASSIFICATION_CSV_COLUMNS = ['host', 'url_path', 'category_name', 'updated_by'];

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const normalized = String(value);
  if (/["\r\n,]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function serializeClassificationCsv(rows) {
  const header = CLASSIFICATION_CSV_COLUMNS.join(',');
  const body = rows.map(
    (row) => CLASSIFICATION_CSV_COLUMNS.map((col) => escapeCsvValue(row[col])).join(','),
  );
  return [header, ...body].join('\r\n');
}
