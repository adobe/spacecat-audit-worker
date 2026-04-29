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

import { ESTIMATED_CPC } from './guidance-opportunity-mapper.js';

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
candidates AS (
    SELECT
        p.path,
        p.trf_channel,
        p.pageviews,
        p.row_count,
        p.bounces,
        CAST(p.bounces AS DOUBLE) / NULLIF(p.row_count, 0) AS bounce_rate,
        ss.channel_bounce_rate,
        ss.channel_bounces,
        CAST(p.pageviews AS DOUBLE) * CAST(p.bounces AS DOUBLE) / NULLIF(p.row_count, 0) AS projected_traffic_lost,
        CAST(p.pageviews AS DOUBLE) * CAST(p.bounces AS DOUBLE) / NULLIF(p.row_count, 0) * ${ESTIMATED_CPC} AS projected_traffic_value
    FROM mobile_paid p
    JOIN source_stats ss
      ON p.trf_channel = ss.trf_channel
    WHERE p.pageviews >= ${pageViewThreshold}
      AND p.bounces >= 25
      AND CAST(p.bounces AS DOUBLE) / NULLIF(p.row_count, 0) >= GREATEST(ss.channel_bounce_rate, 0.50)
),
deduped AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY path
            ORDER BY projected_traffic_lost DESC, pageviews DESC, bounces DESC
        ) AS path_rank
    FROM candidates
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
    projected_traffic_lost,
    projected_traffic_value
FROM deduped
WHERE path_rank = 1
ORDER BY projected_traffic_lost DESC
`.trim();
}
