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

/**
 * JS application of agentic URL classification rules.
 *
 * This is the in-process twin of the Athena SQL emitted by
 * `src/cdn-logs-report/utils/query-builder.js`
 * (`buildTopicExtractionSQL` / `generatePageTypeClassification`). Audits that
 * classify URLs in JavaScript — rather than via an Athena `CASE` expression —
 * use this module so that the topic/category assigned to a URL matches what the
 * agentic CDN-logs report would assign for the same site. The authoritative
 * check that the two stay in lockstep is the mechanical "SQL twin parity" block
 * in `test/common/agentic-url-classification.test.js`, which parses the actual
 * emitted SQL and asserts it agrees with this module over a probe set.
 *
 * The rules are produced by `fetchAgenticUrlClassificationRules`
 * (`src/common/agentic-url-classification-rules.js`):
 *   - `topicPatterns` ← `agentic_url_category_rules`  → topic
 *   - `pagePatterns`  ← `agentic_url_page_type_rules`  → category (page type)
 *
 * NOTE: the agentic SQL applies these regexes against the full `url` column.
 * Callers here typically only have a URL path, so matches are evaluated against
 * the path. Patterns that depend on host/scheme will not match.
 *
 * DIALECT DIVERGENCE (JS vs Trino):
 * The stored regex source is authored for Trino/Athena, whose regex engine is
 * RE2J (Java / re2 syntax). This module compiles the same source with V8's
 * Irregexp engine (ECMAScript `RegExp`). The two dialects are NOT identical.
 * Constructs that are valid in Trino but throw or behave differently in JS
 * include:
 *   - POSIX character classes, e.g. `[[:alpha:]]`, `[[:digit:]]`
 *   - possessive quantifiers, e.g. `a++`, `\d*+`
 *   - mid-pattern / scoped inline flags, e.g. `(?s)`, `(?m)`, `(?i:...)`
 * Patterns using these either throw at `new RegExp(...)` (→ dropped, see
 * `toRegExp`) or compile to a different match set than Trino. A dropped rule is
 * silently skipped here while it still matches in the SQL report, so the JS
 * label can drift from the report label for that URL. `createClassifier`
 * surfaces the *count* of dropped/rejected patterns via an aggregated
 * `log.warn` so the divergence is observable. Only a leading `(?i)` is
 * normalised to the JS `i` flag; all other inline flags are left to throw.
 */

/**
 * Hard cap on the URL length we ever feed to a regex.
 *
 * IMPORTANT — what this does and does NOT bound. Capping the input length only
 * bounds runtime for regexes whose backtracking cost grows *polynomially* with
 * input size (e.g. `(a+)b` scanned over a long string). It does NOT bound the
 * *exponential* blow-up shapes (nested/overlapping unbounded quantifiers such as
 * `(a+)+`, `(a|a)+`): for those, cost explodes with the number of repetitions in
 * a SHORT input and is effectively input-length-independent — a ~30-char string
 * can already hang. Exponential shapes must therefore be rejected at compile
 * time by `REDOS_HEURISTICS`; this cap is only the polynomial-case backstop.
 */
const MAX_URL_LENGTH = 2048;

/** Reject regex sources longer than this (ReDoS magnitude guard). */
const MAX_PATTERN_LENGTH = 1000;

/**
 * Compile-time screen for catastrophic-backtracking regex shapes.
 *
 * These are the exponential-blow-up shapes that `MAX_URL_LENGTH` canNOT mitigate
 * (see the note there), so they must be refused before `new RegExp`. The screen
 * rejects:
 *   1. a group whose body contains an unbounded quantifier, itself repeated —
 *      `(a+)+`, `(a*)*`, `(.*)*`, `(a+)*`, and the bounded-repeat variant
 *      `(.*a){20}`;
 *   2. an alternation-overlap group that is repeated — `(a|a)+`, `(a|aa)+`,
 *      `(foo|foo)*` — where the alternatives can match the same input;
 *   3. a doubly-nested quantified group where the OUTER group is repeated, in
 *      BOTH of its catastrophic forms:
 *        a. the inner group is itself quantified — `(([a-z])+)+` (quantifier
 *           sits AFTER the inner `)`);
 *        b. the inner group merely CONTAINS an unbounded quantifier —
 *           `((a+))+`, `((a*))*`, `(([a-z]+))+` (quantifier sits INSIDE the
 *           inner group, before its `)`). The two need separate heuristics
 *           because `[^()]` stops at the first `)`, so the form-(a) screen does
 *           not see the form-(b) inner `+`/`*`.
 *   4. a bounded-range `{m,n}` group that is itself repeated by an outer
 *      `+`/`*`/`{` — `(a{1,3})+`, `(a{1,2})*`, `([a-z]{1,2})+`, `(\w{1,2})+`.
 *      The inner `{m,n}` makes each repetition match a VARIABLE span, so the
 *      outer repeat backtracks exponentially over how that span is partitioned
 *      — a SHORT input already hangs, so the `MAX_URL_LENGTH` cap cannot bound
 *      it. Forms (1)–(3) miss this because the inner quantifier is `{m,n}`, not
 *      a bare `+`/`*`.
 *
 * This is a COARSE, KNOWN-INCOMPLETE and intentionally OVER-BROAD screen, NOT a
 * decision procedure:
 *   - INCOMPLETE: it does not parse the regex grammar, so it misses shapes it
 *     does not pattern-match (nesting deeper than one level, overlap split
 *     across constructs, backreference-driven blow-up). A pattern passing this
 *     screen is NOT proven safe. There is also no per-match wall-clock timeout:
 *     a JS `RegExp` runs synchronously and cannot be interrupted in-process
 *     without offloading to a worker thread or a linear-time engine (RE2) — a
 *     new dependency that is deliberately NOT taken here. So a catastrophic
 *     shape that slips this screen hangs the whole invocation; the screen is
 *     the only line of defence and is sized to over-reject rather than miss.
 *   - OVER-BROAD: shape (2)/(3)/(4) match on surface syntax, so a benign repeated
 *     group that merely *contains* a `|`, a nested group, or a `{m,n}` range can
 *     be rejected even when it is safe — e.g. shape (4) also rejects a
 *     FIXED-width repeated group like `(a{2})+`, which is linear, not just the
 *     variable-span `(a{1,3})+`. Rejected rules are skipped (and counted),
 *     trading a little recall on exotic-but-safe rules for refusing the
 *     dangerous ones. Single bounded groups like `([^/]+)` and a standalone
 *     range like `([a-z]{2,4})` (no outer repeat) are NOT flagged.
 *
 * Note the trailing class is `[+*{]` (not just `[+*]`) so a `{n,m}` repeat of a
 * dangerous group — e.g. `(.*a){20}` — is caught as well as `+`/`*`.
 */
const REDOS_HEURISTICS = [
  /\([^)]*[+*][^)]*\)[+*{]/,
  /\([^)]*\|[^)]*\)[+*{]/,
  /\([^()]*\([^()]*\)[+*][^()]*\)[+*{]/,
  /\([^()]*\([^()]*[+*][^()]*\)[^()]*\)[+*{]/,
  /\([^()]*\{[^}]*\}[^()]*\)[+*{]/,
];

/**
 * Compiles a stored rule regex into a `RegExp`, honouring a leading `(?i)`
 * inline flag (Trino/Athena style) by converting it to the JS `i` flag.
 *
 * Returns `null` (a "failure") for patterns that:
 *   - are not strings (guards `new RegExp(undefined)` compiling to `/undefined/`
 *     and matching the literal text `undefined`);
 *   - exceed `MAX_PATTERN_LENGTH`, or trip one of `REDOS_HEURISTICS` (a coarse,
 *     incomplete, over-broad catastrophic-backtracking screen — see its note;
 *     it refuses known dangerous shapes but does NOT prove the rest safe);
 *   - fail to compile under V8/Irregexp (e.g. Trino-only syntax — see the
 *     dialect-divergence note at the top of the file).
 * Returning `null` lets a single bad rule be skipped instead of breaking
 * classification of an entire site; callers count these to report drift.
 *
 * @param {string} pattern - stored POSIX/Trino regex source
 * @returns {RegExp|null}
 */
function toRegExp(pattern) {
  // `new RegExp(undefined)` yields `/undefined/`; reject non-strings outright.
  if (typeof pattern !== 'string') {
    return null;
  }

  let flags = '';
  let src = pattern;
  if (src.startsWith('(?i)')) {
    flags = 'i';
    src = src.slice(4);
  }

  // ReDoS guard: reject oversized sources, and refuse known catastrophic shapes
  // up front (exponential shapes that the input cap cannot bound). This is a
  // coarse, incomplete screen — see REDOS_HEURISTICS — not a safety proof.
  // The rule source is authored for RE2J (Trino/Athena), whose grammar has no
  // backreferences or lookaround — the features most associated with
  // catastrophic backtracking — so legitimately-authored rules cannot express
  // the worst exponential shapes. This guard therefore mainly defends against a
  // corrupted or hostile rules table, not against normal authored input.
  if (src.length > MAX_PATTERN_LENGTH || REDOS_HEURISTICS.some((re) => re.test(src))) {
    return null;
  }

  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

/** Caps an input to `MAX_URL_LENGTH` characters (ReDoS magnitude guard). */
function capUrlPath(urlPath) {
  return String(urlPath).slice(0, MAX_URL_LENGTH);
}

/**
 * Sorts rule rows by numeric `sort_order` ascending, mirroring the SQL
 * `ORDER BY sort_order` used when the rules are fetched. Rows without an
 * integer `sort_order` keep their relative array order (stable sort), so an
 * already-ordered or order-less list is left untouched.
 *
 * @param {Array<object>} patterns
 * @returns {Array<object>}
 */
function sortByOrder(patterns) {
  return patterns
    .map((pattern, index) => ({ pattern, index }))
    .sort((a, b) => {
      const ao = Number.isInteger(a.pattern?.sort_order)
        ? a.pattern.sort_order
        : a.index;
      const bo = Number.isInteger(b.pattern?.sort_order)
        ? b.pattern.sort_order
        : b.index;
      return ao - bo || a.index - b.index;
    })
    .map(({ pattern }) => pattern);
}

/**
 * Compiles a list of rule rows once into `{ name, re }` entries, dropping rows
 * whose regex fails to compile or is rejected by the guards. Reports the number
 * of dropped rows via `failures` so the caller can surface drift.
 *
 * For topic rules, `splitNamed` separates named (`CASE`) from unnamed
 * (`REGEXP_EXTRACT`) entries. Page rules pass `splitNamed = false`: every page
 * rule is treated as a named `CASE` arm even when its name is empty — see the
 * empty-name note on `classifyPageType`.
 *
 * @param {Array<{name?: string, regex: string, sort_order?: number}>} patterns
 * @param {boolean} splitNamed
 * @returns {{named: Array, extract: Array, failures: number}}
 */
function compilePatterns(patterns, splitNamed) {
  const named = [];
  const extract = [];
  let failures = 0;

  for (const pattern of sortByOrder(patterns)) {
    const re = toRegExp(pattern.regex);
    if (!re) {
      failures += 1;
    } else if (splitNamed && !pattern.name) {
      extract.push({ re });
    } else {
      named.push({ re, name: pattern.name });
    }
  }

  return { named, extract, failures };
}

/**
 * Applies compiled topic patterns. Mirrors `buildTopicExtractionSQL`:
 *   1. Named patterns act as a `CASE` — first matching rule wins, in order.
 *   2. Unnamed patterns act as `REGEXP_EXTRACT(url, rx, 1)` inside a `COALESCE`
 *      — first non-empty capture group 1 wins, in order.
 *   3. Falls back to `'Other'`.
 *
 * @param {string} cappedPath
 * @param {{named: Array, extract: Array}} compiled
 * @returns {string}
 */
function applyTopic(cappedPath, { named, extract }) {
  for (const { re, name } of named) {
    if (re.test(cappedPath)) {
      return name;
    }
  }

  for (const { re } of extract) {
    const match = re.exec(cappedPath);
    if (match && match[1]) {
      return match[1];
    }
  }

  return 'Other';
}

/**
 * Applies compiled page-type patterns. Mirrors `generatePageTypeClassification`:
 * a `CASE` over the rules where the first matching rule wins, falling back to
 * `'Other'`.
 *
 * @param {string} cappedPath
 * @param {{named: Array}} compiled
 * @returns {string}
 */
function applyPageType(cappedPath, { named }) {
  for (const { re, name } of named) {
    if (re.test(cappedPath)) {
      return name ?? '';
    }
  }

  return 'Other';
}

/**
 * Classifies a URL path into a topic, mirroring `buildTopicExtractionSQL`.
 * See `applyTopic` for the matching semantics.
 *
 * @param {string} urlPath
 * @param {Array<{name?: string, regex: string}>} [topicPatterns=[]]
 * @returns {string}
 */
export function classifyTopic(urlPath, topicPatterns = []) {
  const compiled = compilePatterns(topicPatterns, true);
  return applyTopic(capUrlPath(urlPath), compiled);
}

/**
 * Classifies a URL path into a page-type category, mirroring
 * `generatePageTypeClassification`.
 *
 * EMPTY-NAME HANDLING — KNOWN DIVERGENCE from the SQL twin. The SQL builder
 * emits a `WHEN <rx> THEN '<name>'` arm for *every* page rule, interpolating the
 * name via `sqlEscape(pattern.name)`. For a missing/empty name that means:
 *   - `name === undefined` → `sqlEscape(undefined)` is `String(undefined)` →
 *     the SQL emits the literal string `'undefined'`;
 *   - `name === null` → likewise the literal string `'null'`;
 *   - `name === ''` → the empty string `''`.
 * This JS twin deliberately does NOT reproduce the `'undefined'`/`'null'`
 * literals: a matching page rule with a missing name returns `''` (`name ?? ''`)
 * rather than the string `"undefined"`/`"null"`, because surfacing those literal
 * tokens as a category label is a bug, not a value we want to match. So for a
 * matched rule whose name is `undefined` or `null` the JS label is `''` while
 * the SQL report label is `'undefined'`/`'null'` — an intentional divergence.
 * (An explicitly empty `''` name agrees in both.) Only when no rule matches do
 * both fall back to `'Other'`.
 *
 * @param {string} urlPath
 * @param {Array<{name?: string, regex: string}>} [pagePatterns=[]]
 * @returns {string}
 */
export function classifyPageType(urlPath, pagePatterns = []) {
  const compiled = compilePatterns(pagePatterns, false);
  return applyPageType(capUrlPath(urlPath), compiled);
}

/**
 * Whether a fetched rule set is usable for classification. Used as the
 * "rules present" gate: when no rules exist (or the fetch errored), callers
 * skip enrichment rather than tagging every row as `'Other'`.
 *
 * @param {object|null} rules - result of `fetchAgenticUrlClassificationRules`
 * @returns {boolean}
 */
export function hasClassificationRules(rules) {
  return Boolean(
    rules
    && !rules.error
    && ((rules.topicPatterns && rules.topicPatterns.length > 0)
      || (rules.pagePatterns && rules.pagePatterns.length > 0)),
  );
}

/**
 * Builds a reusable classifier that compiles all patterns ONCE and applies the
 * ReDoS guards up front. Returns `null` when the rule set is not usable (see
 * `hasClassificationRules`), so callers can use the return value as their
 * "rules present" gate.
 *
 * When one or more patterns are dropped (failed to compile or rejected by a
 * guard) and a `log` is supplied, a single aggregated `log.warn` is emitted at
 * construction time — see the dialect-divergence note at the top of the file.
 *
 * @param {{topicPatterns?: Array, pagePatterns?: Array}} rules
 * @param {{log?: object}} [options]
 * @returns {{classify: (urlPath: string) => {topic: string, category: string}}|null}
 */
export function createClassifier(rules, { log } = {}) {
  if (!hasClassificationRules(rules)) {
    return null;
  }

  const topicCompiled = compilePatterns(rules.topicPatterns ?? [], true);
  const pageCompiled = compilePatterns(rules.pagePatterns ?? [], false);
  const failures = topicCompiled.failures + pageCompiled.failures;

  if (failures > 0 && log?.warn) {
    log.warn(`agentic-url-classification: ${failures} rule pattern(s) skipped (failed to compile or rejected)`);
  }

  return {
    classify(urlPath) {
      const cappedPath = capUrlPath(urlPath);
      // Output key names are intentionally the inverse of the source-rule
      // names (see module header): `topic` carries the agentic *category*
      // rules (agentic_url_category_rules) and `category` carries the agentic
      // *page-type* rules (agentic_url_page_type_rules). Kept for backward
      // compatibility with existing report columns — renaming would break
      // downstream consumers, so the legacy convention is preserved here.
      return {
        topic: applyTopic(cappedPath, topicCompiled),
        category: applyPageType(cappedPath, pageCompiled),
      };
    },
  };
}
