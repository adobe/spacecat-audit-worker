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

// ===== BUSINESS LOGIC CONSTANTS =====

export const SUPPORTED_PROVIDERS = ['chatgpt', 'perplexity'];

export const AUDIT_TYPES = {
  WEEKLY: 'cdn-report-weekly',
  CUSTOM: 'custom',
};

export const MESSAGE_TYPES = {
  CUSTOM_DATE_RANGE: 'runCustomDateRange',
};

export const REPORTS_PATH = 'reports';

// ===== DATABASE & AWS CONSTANTS =====

export const TABLE_NAMES = {
  COUNTRY: 'aggregated_logs_analysis_type_reqcountbycountry',
  USER_AGENT: 'aggregated_logs_analysis_type_reqcountbyuseragent',
  URL_STATUS: 'aggregated_logs_analysis_type_reqcountbyurlstatus',
  URL_USER_AGENT_STATUS: 'aggregated_logs_analysis_type_reqcountbyurluseragentstatus',
};

export const COLUMN_MAPPINGS = {
  COUNTRY: 'request_count',
  USER_AGENT: 'count',
  URL_STATUS: 'count',
  URL_USER_AGENT_STATUS: 'count',
};

export const TABLE_PREFIX = 'aggregated_logs_';
export const CRAWLER_PREFIX = 'cdn-logs-crawler-';
export const CDN_LOGS_PREFIX = 'cdn-logs-';

export const DATABASE_CONFIG = {
  DESCRIPTION: 'CDN Logs Report database for aggregated data analysis',
};

export const CRAWLER_CONFIG = {
  DESCRIPTION: 'Crawler for CDN logs aggregated data - discovers schema and partitions automatically',
  ROLE_PREFIX: 'arn:aws:iam::',
  ROLE_SUFFIX: ':role/service-role/AWSGlueServiceRole-cdn-aggregation',
  SCHEMA_CHANGE_POLICY: {
    UpdateBehavior: 'UPDATE_IN_DATABASE',
    DeleteBehavior: 'LOG',
  },
  RECRAWL_POLICY: {
    RecrawlBehavior: 'CRAWL_EVERYTHING',
  },
  CONFIG_VERSION: 1.0,
};

// ===== HTTP & STATUS CONSTANTS =====

export const STATUS_CODES = {
  OK: ['200', 200],
  NOT_FOUND: ['404', 404],
  SERVER_ERROR: ['503', 503],
};

// ===== EXCEL & UI CONSTANTS =====

export const SHEET_COLORS = {
  DEFAULT: 'FFE6E6FA',
  ERROR: 'FFFFE6E6',
  SUCCESS: 'FFE6F6E6',
};

export const EXCEL_CONFIG = {
  DEFAULT_COLUMN_WIDTH: 15,
  NUMBER_FORMAT: '#,##0',
  FONT: {
    bold: true,
    size: 11,
    color: { argb: 'FF000000' },
  },
  CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// ===== DATE & TIME CONSTANTS =====

export const TIME_CONSTANTS = {
  MILLISECONDS_PER_DAY: 86400000,
  DAYS_PER_WEEK: 7,
  ISO_SUNDAY: 0,
  ISO_MONDAY: 1,
};

// ===== VALIDATION & REGEX CONSTANTS =====

export const REGEX_PATTERNS = {
  URL_SANITIZATION: /[^a-zA-Z0-9]/g,
  BUCKET_SANITIZATION: /[._]/g,
};

// ===== ERROR MESSAGES =====

export const ERROR_MESSAGES = {
  // General
  NO_ANALYSIS_TYPES: 'No analysis types found in database',
  MISSING_DATE_RANGE: 'Custom date range requires startDate and endDate in message',

  // Date validation
  DATE_FORMAT_ERROR: 'Invalid date format. Use ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)',
  DATE_INPUT_REQUIRED: 'Date input is required',
  START_BEFORE_END: 'Start date must be before end date',

  // Period validation
  UNSUPPORTED_PERIOD_TYPE: 'Unsupported period type. Use \'weeks\' or \'days\'.',

  // Sheet validation
  UNKNOWN_SHEET_TYPE: 'Unknown sheet type',
};

// ===== MESSAGE CONSTANTS =====

export const LOG_MESSAGES = {
  PROVIDER_REPORTS: 'Generated provider-specific reports',
};

// ===== PAGE TYPE PATTERNS =====

export const DEFAULT_PATTERNS = [
  {
    name: 'Product Detail Page',
    pattern: '.*/product/.*|.*/p/.*|.*/item/.*',
  },
  {
    name: 'Product Listing Page',
    pattern: '.*/products.*|.*/category.*|.*/shop.*',
  },
  {
    name: 'Blog Posts',
    pattern: '.*/blog/.*|.*/article/.*|.*/news/.*',
  },
  {
    name: 'Robots',
    pattern: '.*/robots\\.txt$',
  },
  {
    name: 'Sitemap',
    pattern: '.*/sitemap.*\\.xml$',
  },
];

export const DOMAIN_SPECIFIC_PATTERNS = {
  bulk_com: [
    {
      name: 'Homepage',
      pattern: '.*/[a-z]{2}/$',
    },
    {
      name: 'Product Detail Page',
      pattern: '.*/products/.*',
    },
    {
      name: 'The Core Blog',
      pattern: '.*/the-core/.*',
    },
    {
      name: 'Sitemap',
      pattern: '.*sitemap.*',
    },
    {
      name: 'Robots',
      pattern: '.*robots.*',
    },
    {
      name: 'Product Listing Page',
      pattern: '.*/.*',
    },
    ...DEFAULT_PATTERNS,
  ],
};

export const FALLBACK_CASE_STATEMENT = `
  CASE 
    WHEN url LIKE '%robots.txt%' THEN 'Robots'
    WHEN url LIKE '%sitemap%' THEN 'Sitemap'
    ELSE 'Uncategorized'
  END`;

/* c8 ignore end */
