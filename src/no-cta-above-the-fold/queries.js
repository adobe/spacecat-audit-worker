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
 * @param {Object} params - Template parameters
 * @param {string} params.siteId - Site ID
 * @param {string} params.tableName - Table name
 * @param {string} params.temporalCondition - Temporal condition
 * @param {number} params.pageViewThreshold - Minimum total pageviews for path to include
 * @returns {string} The SQL query string
 */
export function getNoCTAAboveTheFoldAnalysisQuery({
  siteId,
  tableName,
  temporalCondition,
  pageViewThreshold,
}) {
  return `
WITH mobile_paid AS (
    SELECT
        path,
        trf_channel,
        CAST(SUM(pageviews) AS BIGINT) AS pageviews,
        COUNT(*) AS row_count,
        SUM(CASE WHEN engaged = 0 THEN 1 ELSE 0 END) AS bounces,
        CAST(SUM(engaged) AS BIGINT) AS engagements
    FROM ${tableName}
    WHERE siteid = '${siteId}'
      AND (${temporalCondition})
      AND trf_type = 'paid'
      AND device = 'mobile'
      AND trf_channel IN ('search', 'social', 'display')
    GROUP BY path, trf_channel
),
source_stats AS (
    SELECT
        trf_channel,
        CAST(SUM(pageviews) AS BIGINT) AS channel_pageviews,
        SUM(row_count) AS channel_row_count,
        CAST(SUM(bounces) AS BIGINT) AS channel_bounces,
        CAST(SUM(bounces) AS DOUBLE) / NULLIF(SUM(row_count), 0) AS channel_bounce_rate
    FROM mobile_paid
    GROUP BY trf_channel
),
highest_pageviews AS (
    SELECT
        path,
        trf_channel,
        pageviews,
        row_count,
        bounces,
        CAST(bounces AS DOUBLE) / NULLIF(row_count, 0) AS bounce_rate
    FROM mobile_paid
    WHERE pageviews >= ${pageViewThreshold}
),
top_bounces AS (
    SELECT
        h.path,
        h.trf_channel,
        h.pageviews,
        h.row_count,
        h.bounce_rate,
        ss.channel_bounce_rate,
        h.bounces,
        ss.channel_bounces,
        CAST(h.bounces AS DOUBLE) / NULLIF(ss.channel_bounces, 0) AS bounce_share,
        CAST(h.bounces AS DOUBLE) / NULLIF(ss.channel_bounces, 0) * 100 AS bounce_share_pct
    FROM highest_pageviews h
    JOIN source_stats ss USING (trf_channel)
    WHERE h.bounce_rate >= ss.channel_bounce_rate
      AND CAST(h.bounces AS DOUBLE) / NULLIF(ss.channel_bounces, 0) >= 0.10
),
deduped AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY path
            ORDER BY bounce_share DESC, pageviews DESC
        ) AS path_rank
    FROM top_bounces
)
SELECT
    path,
    trf_channel,
    pageviews,
    row_count,
    bounce_rate,
    channel_bounce_rate,
    bounces,
    channel_bounces,
    bounce_share_pct,
    CAST(pageviews AS DOUBLE) * bounce_rate AS projected_traffic_lost
FROM deduped
WHERE path_rank = 1
ORDER BY bounce_share_pct DESC
`.trim();
}
