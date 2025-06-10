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
export const referrerAnalysisQueries = {
  hourlyReferrers: (hourToProcess, tableName = 'raw_logs') => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        url,
        request_user_agent,
        COALESCE(referer, 'direct') as referer,
        COUNT(*) as hits,
        SUM(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                      request_user_agent LIKE '%Perplexity%' OR 
                      request_user_agent LIKE '%Claude%' THEN 1 ELSE 0 END) as agentic_hits,
        CASE 
          WHEN referer LIKE '%chatgpt.com%' THEN 'chatgpt'
          WHEN referer LIKE '%perplexity.ai%' THEN 'perplexity'
          WHEN referer LIKE '%claude.ai%' THEN 'claude'
          WHEN referer LIKE '%google.com%' THEN 'google'
          WHEN referer LIKE '%bing.com%' THEN 'bing'
          WHEN referer IS NULL OR referer = '' THEN 'direct'
          ELSE 'other'
        END as referrer_type,
        host,
        geo_country
      FROM cdn_logs.${tableName} 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
      GROUP BY url, request_user_agent, referer, host, geo_country
      ORDER BY hits DESC
    `;
  },
};
/* c8 ignore stop */
