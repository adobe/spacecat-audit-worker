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
// The JS analogue of the data-service SQL matcher (wrpc_classify_referral_urls /
// _safe_regex_match): rules are pre-sorted (sort_order ASC, name ASC) by
// fetchAgenticUrlClassificationRules, the first compilable rule whose regex matches
// wins, an uncompilable regex is treated as no-match, and an unmatched URL gets no
// classification (null). The result is imported into referral_url_classifications
// through the projector single-writer FIFO.

// (?i) is an inline modifier Postgres ~* honors; JS RegExp needs it stripped + /i.
// Mirrors compileAthenaRegex so JS classification matches the SQL/read-path behaviour.
function compileRuleRegex(regex) {
  return new RegExp(String(regex).replace(/^\(\?i\)/, ''), 'i');
}

/**
 * Resolves the category for a single URL path against a site's active rules.
 * @param {Array<{name: string, regex: string}>} rules pre-sorted category rules
 * @param {string} urlPath the URL path to classify
 * @returns {string|null} the matching category name, or null when nothing matches
 */
export function classifyUrlPath(rules, urlPath) {
  if (!Array.isArray(rules) || typeof urlPath !== 'string') {
    return null;
  }
  for (const rule of rules) {
    if (rule && typeof rule.regex === 'string' && rule.name) {
      let compiled = null;
      try {
        compiled = compileRuleRegex(rule.regex);
      } catch {
        compiled = null; // uncompilable regex -> no match (parity with _safe_regex_match)
      }
      if (compiled && compiled.test(urlPath)) {
        return rule.name;
      }
    }
  }
  return null;
}

/**
 * Builds the referral_url_classifications rows for a run: one row per distinct
 * (host, url_path) that matches a rule. Unmatched URLs get no row (category is
 * never empty). Category-only — mirrors the referral_url_classifications shape.
 * @returns {Array<{host, url_path, category_name, updated_by}>}
 */
export function buildClassificationRows(rows, rules, updatedBy) {
  const seen = new Set();
  const classifications = [];

  for (const row of rows) {
    const { host, url_path: urlPath } = row;
    const key = `${host}\n${urlPath}`;
    if (!seen.has(key)) {
      seen.add(key);
      const category = classifyUrlPath(rules, urlPath);
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
