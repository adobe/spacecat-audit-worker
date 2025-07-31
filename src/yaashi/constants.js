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

export const LLM_404_BLOCKED_AUDIT = 'llm-404-blocked';

export const API_BASE_URL = 'https://d1vm7168yg1w6d.cloudfront.net';
export const REFERER_URL = 'https://dev.d2ikwb7s634epv.amplifyapp.com/';
export const REQUEST_TIMEOUT = 30000; // 30 seconds

export const MYSTIQUE_MESSAGE_TYPE = 'detect:llm-404-blocked';

export const MIN_404_COUNT_THRESHOLD = 5;
export const MAX_URLS_LIMIT = 200;

export const REPORT_HANDLER_SQS_TYPE = 'llm-404-blocked-report';

// Suggestion types used across audits
export const SUGGESTION_TYPES = {
  REDIRECT_UPDATE: 'REDIRECT_UPDATE',
};
