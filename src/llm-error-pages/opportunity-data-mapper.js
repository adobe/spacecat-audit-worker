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

import { DATA_SOURCES } from '../common/constants.js';

export const ERROR_CATEGORY_TYPE = {
  404: 'Not Found Errors',
  403: 'Forbidden Errors',
  '5xx': 'Server Errors',
};

export const SUGGESTION_TEMPLATES = {
  FORBIDDEN: 'Review access permissions for {url} - {userAgent} crawler is blocked',
  SERVER_ERROR: 'Fix server error for {url} - returning {statusCode} to {userAgent} crawler',
};

export function buildOpportunityDataForErrorType(errorType, aggregatedData) {
  const totalErrors = aggregatedData.reduce((sum, item) => sum + item.totalRequests, 0);
  const uniqueUrls = [...new Set(aggregatedData.map((item) => item.url))].length;
  const uniqueUserAgents = [...new Set(aggregatedData.map((item) => item.userAgent))].length;

  return {
    runbook: '', // TBD
    origin: 'AUTOMATION',
    title: `LLM ${ERROR_CATEGORY_TYPE[errorType]}`,
    description: `URLs returning ${errorType} errors to LLM crawlers`,
    guidance: {
      steps: [
        'Review the list of URLs with errors reported by LLM crawlers',
        'Identify and fix broken links, server issues, or access restrictions',
        'Test the fixes by monitoring LLM crawler access',
        'Verify error resolution in subsequent audit runs',
      ],
    },
    tags: ['seo', 'llm', 'errors', 'crawlers', 'isElmo'],
    data: {
      errorType,
      totalErrors,
      uniqueUrls,
      uniqueUserAgents,
      dataSources: [DATA_SOURCES.CDN_LOGS],
    },
  };
}

export function populateSuggestion(template, url, statusCode, userAgent) {
  return template
    .replace('{url}', url)
    .replace('{statusCode}', statusCode)
    .replace('{userAgent}', userAgent);
}
