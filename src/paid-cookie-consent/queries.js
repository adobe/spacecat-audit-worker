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
 * Generates the paid traffic analysis SQL query with consent and referrer parameters.
 * @param {Object} params - Template parameters
 * @param {string} params.siteId - Site ID
 * @param {string} params.tableName - Table name
 * @param {string} params.temporalCondition - Temporal condition
 * @param {string} params.dimensionColumns - Dimension columns
 * @param {string} params.groupBy - Group by clause
 * @param {string} params.dimensionColumnsPrefixed - Prefixed dimension columns
 * @param {string} params.pageTypeCase - Page type case statement
 * @param {number} params.pageViewThreshold - Minimum total pageviews for path to include
 * @returns {string} The SQL query string
 */
export function getPaidTrafficAnalysisTemplate({
  siteId,
  tableName,
  temporalCondition,
  trfTypeCondition,
  dimensionColumns,
  groupBy,
  dimensionColumnsPrefixed,
  pageTypeCase,
  pageViewThreshold,
}) {
  return `
WITH min_totals AS (
    SELECT
        path AS min_key,
        CAST(SUM(pageviews) AS BIGINT) AS total_pageviews
    FROM ${tableName}
    WHERE siteid = '${siteId}'
    AND (${temporalCondition})
    AND ${trfTypeCondition}
    GROUP BY path
    HAVING SUM(pageviews) >= ${pageViewThreshold}
),
raw AS (
    SELECT
        path,
        ${pageTypeCase},   
        trf_type,
        trf_channel,
        trf_platform,
        device,
        utm_source,
        utm_medium,
        utm_campaign,
        referrer,
        consent,
        notfound,
        pageviews,
        clicked,
        engaged,
        latest_scroll,
        CASE WHEN latest_scroll >= 10000 THEN 1 ELSE 0 END AS engaged_scroll,  
        lcp,
        cls,
        inp
    FROM ${tableName} m
    JOIN min_totals t ON m.path = t.min_key
    WHERE m.siteid = '${siteId}'
    AND (${temporalCondition})
    AND ${trfTypeCondition}
),
agg AS (
    SELECT
        ${dimensionColumns},
        COUNT(*)                          AS row_count,
        CAST(SUM(pageviews) AS BIGINT)   AS pageviews,
        CAST(SUM(clicked) AS BIGINT)     AS clicks,
        CAST(SUM(engaged) AS BIGINT)     AS engagements,
        CAST(SUM(engaged_scroll) AS BIGINT) AS engaged_scroll,
        approx_percentile(latest_scroll, 0.70) AS p70_scroll,
        approx_percentile(lcp, 0.70)     AS p70_lcp,
        approx_percentile(cls, 0.70)     AS p70_cls,
        approx_percentile(inp, 0.70)     AS p70_inp
    FROM raw
    GROUP BY ${groupBy}
),
grand_total AS (
    SELECT CAST(SUM(pageviews) AS BIGINT) AS total_pv FROM agg
)
SELECT
    ${dimensionColumnsPrefixed},
    a.pageviews,
    CAST(a.pageviews AS DOUBLE) / NULLIF(t.total_pv, 0)         AS pct_pageviews,
    CAST(a.clicks AS DOUBLE)      / NULLIF(a.row_count, 0)      AS click_rate,
    CAST(a.engagements AS DOUBLE) / NULLIF(a.row_count, 0)      AS engagement_rate,
    1 - CAST(a.engagements AS DOUBLE) / NULLIF(a.row_count, 0)  AS bounce_rate,
    CAST(a.engaged_scroll AS DOUBLE) / NULLIF(a.row_count, 0) AS engaged_scroll_rate,
    a.p70_scroll,
    a.p70_lcp,
    a.p70_cls,
    a.p70_inp
FROM agg a
CROSS JOIN grand_total t
ORDER BY a.pageviews DESC
`.trim();
}
