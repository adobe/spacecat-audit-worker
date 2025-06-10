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
/**
 * S3 Configuration for CDN Analysis
 * Manages customer-specific raw logs and environment-specific analysis buckets
 */

// Default analysis bucket configurations by environment
const DEFAULT_ANALYSIS_CONFIG = {
  dev: {
    analysisBucket: 'elmo-cdn-logs-analysis',
  },
  prod: {
    analysisBucket: 'spacecat-cdn-logs-analysis',
  },
};

/**
 * Extract customer domain from site or context
 */
function extractCustomerDomain(site) {
  // Try to get from site first
  if (site && typeof site.getBaseURL === 'function') {
    const baseURL = site.getBaseURL();
    const customer = new URL(baseURL).host.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return customer;
  }

  // Default fallback
  return 'default_customer';
}

/**
 * Get raw logs bucket based on environment and customer domain
 */
function getRawLogsBucket(environment, customerDomain) {
  if (environment === 'dev') {
    // Dev environment keeps the existing bucket structure
    return 'elmo-fastly-wknd-site-cdn-logs';
  }

  // Prod environment uses customer-specific buckets
  // Convert customer domain to bucket-friendly format
  // e.g., adobe.com -> adobe-com, bulk.com -> bulk-com
  // default_customer -> default-customer
  const bucketCustomer = customerDomain.replace(/[._]/g, '-');
  return `cdn-logs-${bucketCustomer}`;
}

/**
 * Get S3 configuration based on customer context and environment
 */
export function getS3Config(context, site = null) {
  const { env, log } = context;

  // Determine environment
  const environment = env.AWS_ENV === 'prod' ? 'prod' : 'dev';

  // Get analysis bucket config for environment
  const config = DEFAULT_ANALYSIS_CONFIG[environment] || DEFAULT_ANALYSIS_CONFIG.dev;

  // Customer-specific raw logs bucket logic
  const customerDomain = extractCustomerDomain(site);
  const rawLogsBucket = getRawLogsBucket(environment, customerDomain);

  const finalConfig = {
    ...config,
    rawLogsBucket,
    customerDomain,
    environment,
  };

  log.info(`CDN Analysis S3 Config for ${customerDomain} (${environment}):`, {
    rawLogsBucket: finalConfig.rawLogsBucket,
    analysisBucket: finalConfig.analysisBucket,
  });

  return {
    ...finalConfig,
    // Convenience methods
    getAnalysisLocation: (basePrefix = 'cdn-analysis') => `s3://${finalConfig.analysisBucket}/${basePrefix}/`,
    getAthenaTempLocation: () => `s3://${finalConfig.analysisBucket}/tmp/athena-results/`,
  };
}

/**
 * Build Athena table location for customer raw logs
 */
export function getCustomerRawLogsLocation(s3Config) {
  return `s3://${s3Config.rawLogsBucket}/`;
}

/**
 * Get partition projection configuration for raw logs
 */
export function getRawLogsPartitionConfig(s3Config) {
  // Both dev and prod environments use year/month/day/hour partitioning
  const baseLocation = getCustomerRawLogsLocation(s3Config);
  return {
    projectionEnabled: 'true',
    locationTemplate: `${baseLocation}\${year}/\${month}/\${day}/\${hour}/`,
    partitionProjections: {
      'projection.year.type': 'integer',
      'projection.year.range': '2024,2030',
      'projection.month.type': 'integer',
      'projection.month.range': '1,12',
      'projection.month.digits': '2',
      'projection.day.type': 'integer',
      'projection.day.range': '1,31',
      'projection.day.digits': '2',
      'projection.hour.type': 'integer',
      'projection.hour.range': '0,23',
      'projection.hour.digits': '2',
    },
  };
}

/* c8 ignore stop */
