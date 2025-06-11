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
import { getHourlyPartitionFilter } from './query-helpers.js';

/**
 * Geographic Analysis Athena Queries
 * Analysis of hits by country for agentic traffic only
 */

export const geographicAnalysisQueries = {
  /**
   * Hourly geographic analysis for agentic traffic
   */
  hourlyHitsByCountry: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        geo_country as country_code,
        COUNT(*) as request_count,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT agentic_type) as unique_platforms,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        -- Platform breakdown by country
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests,
        -- Status code breakdown by country
        COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as status_2xx,
        COUNT(CASE WHEN response_status BETWEEN 300 AND 399 THEN 1 END) as status_3xx,
        COUNT(CASE WHEN response_status = 401 THEN 1 END) as status_401,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as status_403,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as status_404,
        COUNT(CASE WHEN response_status BETWEEN 500 AND 599 THEN 1 END) as status_5xx,
        -- Success rate by country
        ROUND(COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) * 100.0 / COUNT(*), 2) as success_rate_percent,
        -- Percentage of total traffic
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_total_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND geo_country IS NOT NULL
      GROUP BY geo_country
      ORDER BY request_count DESC
    `;
  },

  /**
   * Top countries by agentic traffic volume
   */
  topCountriesByTraffic: (hourToProcess, tableName = 'formatted_logs', limit = 50) => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        geo_country as country_code,
        COUNT(*) as total_requests,
        COUNT(DISTINCT agentic_type) as unique_platforms,
        -- Dominant platform in this country
        (SELECT agentic_type 
         FROM cdn_logs.${tableName} sub 
         WHERE sub.geo_country = main.geo_country 
         ${whereClause.replace('WHERE', 'AND')}
         AND sub.agentic_type IS NOT NULL
         GROUP BY agentic_type 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as dominant_platform,
        -- Platform distribution
        ROUND(COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) * 100.0 / COUNT(*), 2) as chatgpt_percentage,
        ROUND(COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) * 100.0 / COUNT(*), 2) as perplexity_percentage,
        ROUND(COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) * 100.0 / COUNT(*), 2) as claude_percentage,
        ROUND(COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) * 100.0 / COUNT(*), 2) as gemini_percentage
      FROM cdn_logs.${tableName} main
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND geo_country IS NOT NULL
      GROUP BY geo_country
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * European countries analysis (specific to requirement)
   */
  europeanCountriesAnalysis: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        geo_country as country_code,
        COUNT(*) as request_count,
        -- Platform breakdown
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests,
        -- Success metrics
        COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as successful_requests,
        ROUND(COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) * 100.0 / COUNT(*), 2) as success_rate_percent,
        -- Error breakdown
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND geo_country IN ('GB', 'IE', 'FR', 'DE', 'IT', 'ES', 'NL', 'DK', 'SE', 'PL', 'EU')
      GROUP BY geo_country
      ORDER BY 
        CASE geo_country
          WHEN 'GB' THEN 1
          WHEN 'EU' THEN 2
          WHEN 'IT' THEN 3
          WHEN 'FR' THEN 4
          WHEN 'ES' THEN 5
          WHEN 'IE' THEN 6
          WHEN 'DE' THEN 7
          WHEN 'NL' THEN 8
          WHEN 'DK' THEN 9
          WHEN 'SE' THEN 10
          WHEN 'PL' THEN 11
          ELSE 12
        END
    `;
  },

  /**
   * Country-Platform analysis
   */
  countryPlatformBreakdown: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        geo_country as country_code,
        agentic_type as platform,
        COUNT(*) as request_count,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        -- Status breakdown for this country-platform combination
        COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as successful_requests,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        -- Success rate
        ROUND(COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) * 100.0 / COUNT(*), 2) as success_rate_percent,
        -- Share of traffic within this country
        ROUND(COUNT(*) * 100.0 / 
              SUM(COUNT(*)) OVER (PARTITION BY geo_country), 2) as percentage_within_country
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND geo_country IS NOT NULL
      GROUP BY geo_country, agentic_type
      ORDER BY geo_country, request_count DESC
    `;
  },

  /**
   * Geographic error analysis
   */
  geographicErrorAnalysis: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        geo_country as country_code,
        COUNT(*) as total_requests,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status >= 500 THEN 1 END) as server_error_requests,
        -- Error rate by country
        ROUND(COUNT(CASE WHEN response_status >= 400 THEN 1 END) * 100.0 / COUNT(*), 2) as error_rate_percent,
        -- Platform with most errors in this country
        (SELECT agentic_type 
         FROM cdn_logs.${tableName} sub 
         WHERE sub.geo_country = main.geo_country 
         ${whereClause.replace('WHERE', 'AND')}
         AND sub.agentic_type IS NOT NULL
         AND sub.response_status >= 400
         GROUP BY agentic_type 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as platform_with_most_errors
      FROM cdn_logs.${tableName} main
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND geo_country IS NOT NULL
      GROUP BY geo_country
      HAVING COUNT(CASE WHEN response_status >= 400 THEN 1 END) > 0
      ORDER BY error_requests DESC
    `;
  },
};
/* c8 ignore stop */
