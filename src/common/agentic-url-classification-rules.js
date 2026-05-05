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

function normalizeRuleRows(rows = []) {
  return (rows || []).map((row, index) => ({
    name: row.name,
    regex: row.regex,
    sort_order: Number.isInteger(row.sort_order) ? row.sort_order : index,
  }));
}

/**
 * Reads agentic URL classification rules from Postgres through native
 * PostgREST table endpoints.
 */
export async function fetchAgenticUrlClassificationRules(site, context = {}) {
  const log = context?.log || console;
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;
  const siteId = site.getId();

  if (!postgrestClient?.from) {
    log.warn('fetchAgenticUrlClassificationRules: no PostgREST client available, skipping DB rule fetch');
    return null;
  }

  try {
    const [categoryResult, pageTypeResult] = await Promise.all([
      postgrestClient
        .from('agentic_url_category_rules')
        .select('name,regex,sort_order')
        .eq('site_id', siteId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      postgrestClient
        .from('agentic_url_page_type_rules')
        .select('name,regex,sort_order')
        .eq('site_id', siteId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ]);

    if (categoryResult.error) {
      throw categoryResult.error;
    }
    if (pageTypeResult.error) {
      throw pageTypeResult.error;
    }

    const topicPatterns = normalizeRuleRows(categoryResult.data);
    const pagePatterns = normalizeRuleRows(pageTypeResult.data);

    log.info(`fetchAgenticUrlClassificationRules: loaded ${pagePatterns.length} page patterns, ${topicPatterns.length} topic patterns for site ${siteId}`);

    return {
      pagePatterns,
      topicPatterns,
    };
  } catch (error) {
    log.error(`fetchAgenticUrlClassificationRules: failed to load rules for site ${siteId}: ${error.message}`);
    return {
      error: true,
      source: 'postgres',
    };
  }
}
