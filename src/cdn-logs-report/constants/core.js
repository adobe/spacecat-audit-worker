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

export const SUPPORTED_PROVIDERS = ['chatgpt', 'perplexity'];

export const AUDIT_TYPES = {
  WEEKLY: 'cdn-report-weekly',
  CUSTOM: 'custom',
};

export const MESSAGE_TYPES = {
  CUSTOM_DATE_RANGE: 'runCustomDateRange',
};

export const SHAREPOINT_URL = 'https://adobe.sharepoint.com/:x:/r/sites/HelixProjects/Shared%20Documents/sites/elmo-ui-data';

export const CDN_LOGS_PREFIX = 'cdn-logs-';

export const REGEX_PATTERNS = {
  URL_SANITIZATION: /[^a-zA-Z0-9]/g,
  BUCKET_SANITIZATION: /[._]/g,
};

export const ERROR_MESSAGES = {
  MISSING_DATE_RANGE: 'Custom date range requires startDate and endDate in message',
  DATE_FORMAT_ERROR: 'Invalid date format. Use ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)',
  DATE_INPUT_REQUIRED: 'Date input is required',
  START_BEFORE_END: 'Start date must be before end date',
  UNSUPPORTED_PERIOD_TYPE: 'Unsupported period type. Use \'weeks\' or \'days\'.',
  UNKNOWN_SHEET_TYPE: 'Unknown sheet type',
};

export const STATUS_CODES = {
  OK: ['200', 200],
  NOT_FOUND: ['404', 404],
  SERVER_ERROR: ['503', 503],
};
