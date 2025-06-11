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
import { getHourlyPartitionFilter, QUERY_LIMITS } from './query-helpers.js';

/**
 * Referrer Analysis Athena Queries
 * Analyzes referrer patterns in agentic traffic
 */

export const referrerAnalysisQueries = {
  /**
   * Hourly referrer analysis for agentic traffic
   */
  hourlyReferrers: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        url,
        request_user_agent,
        agentic_type,
        COALESCE(request_referer, 'direct') as referer,
        COUNT(*) as hits,
        CASE 
          WHEN request_referer LIKE '%chatgpt.com%' THEN 'chatgpt'
          WHEN request_referer LIKE '%perplexity.ai%' THEN 'perplexity'
          WHEN request_referer LIKE '%claude.ai%' THEN 'claude'
          WHEN request_referer LIKE '%bard.google.com%' OR request_referer LIKE '%gemini.google.com%' THEN 'gemini'
          WHEN request_referer LIKE '%google.com%' THEN 'google'
          WHEN request_referer LIKE '%bing.com%' THEN 'bing'
          WHEN request_referer IS NULL OR request_referer = '' THEN 'direct'
          ELSE 'other'
        END as referrer_type,
        host,
        geo_country
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY url, request_user_agent, agentic_type, request_referer, host, geo_country
      ORDER BY hits DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Referrer breakdown by agentic type
   */
  referrersByAgentType: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        CASE 
          WHEN request_referer LIKE '%chatgpt.com%' THEN 'chatgpt'
          WHEN request_referer LIKE '%perplexity.ai%' THEN 'perplexity'
          WHEN request_referer LIKE '%claude.ai%' THEN 'claude'
          WHEN request_referer LIKE '%bard.google.com%' OR request_referer LIKE '%gemini.google.com%' THEN 'gemini'
          WHEN request_referer LIKE '%google.com%' THEN 'google'
          WHEN request_referer LIKE '%bing.com%' THEN 'bing'
          WHEN request_referer IS NULL OR request_referer = '' THEN 'direct'
          ELSE 'other'
        END as referrer_category,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY agentic_type), 2) as percentage_of_agent_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY agentic_type, 
        CASE 
          WHEN request_referer LIKE '%chatgpt.com%' THEN 'chatgpt'
          WHEN request_referer LIKE '%perplexity.ai%' THEN 'perplexity'
          WHEN request_referer LIKE '%claude.ai%' THEN 'claude'
          WHEN request_referer LIKE '%bard.google.com%' OR request_referer LIKE '%gemini.google.com%' THEN 'gemini'
          WHEN request_referer LIKE '%google.com%' THEN 'google'
          WHEN request_referer LIKE '%bing.com%' THEN 'bing'
          WHEN request_referer IS NULL OR request_referer = '' THEN 'direct'
          ELSE 'other'
        END
      ORDER BY agentic_type, total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Top referrer domains for agentic traffic
   */
  topReferrerDomains: (hourToProcess, tableName = 'formatted_logs', limit = 50) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        CASE 
          WHEN request_referer IS NULL OR request_referer = '' THEN 'direct'
          ELSE REGEXP_EXTRACT(request_referer, 'https?://([^/]+)', 1)
        END as referrer_domain,
        COUNT(*) as total_requests,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        -- Breakdown by agentic type
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY 
        CASE 
          WHEN request_referer IS NULL OR request_referer = '' THEN 'direct'
          ELSE REGEXP_EXTRACT(request_referer, 'https?://([^/]+)', 1)
        END
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * AI platform self-referrals analysis
   */
  aiPlatformReferrals: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        CASE 
          WHEN agentic_type = 'chatgpt' AND request_referer LIKE '%chatgpt.com%' THEN 'Self-Referral'
          WHEN agentic_type = 'perplexity' AND request_referer LIKE '%perplexity.ai%' THEN 'Self-Referral'
          WHEN agentic_type = 'claude' AND request_referer LIKE '%claude.ai%' THEN 'Self-Referral'
          WHEN agentic_type = 'gemini' AND (request_referer LIKE '%bard.google.com%' OR request_referer LIKE '%gemini.google.com%') THEN 'Self-Referral'
          WHEN request_referer IS NULL OR request_referer = '' THEN 'Direct'
          ELSE 'External-Referral'
        END as referral_type,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY agentic_type), 2) as percentage_of_agent_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY agentic_type,
        CASE 
          WHEN agentic_type = 'chatgpt' AND request_referer LIKE '%chatgpt.com%' THEN 'Self-Referral'
          WHEN agentic_type = 'perplexity' AND request_referer LIKE '%perplexity.ai%' THEN 'Self-Referral'
          WHEN agentic_type = 'claude' AND request_referer LIKE '%claude.ai%' THEN 'Self-Referral'
          WHEN agentic_type = 'gemini' AND (request_referer LIKE '%bard.google.com%' OR request_referer LIKE '%gemini.google.com%') THEN 'Self-Referral'
          WHEN request_referer IS NULL OR request_referer = '' THEN 'Direct'
          ELSE 'External-Referral'
        END
      ORDER BY agentic_type, total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },
};
/* c8 ignore stop */
