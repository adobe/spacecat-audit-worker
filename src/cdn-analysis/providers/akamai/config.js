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
export const AKAMAI_CONFIG = {
  cdnType: 'akamai',
  databaseName: 'cdn_logs_',

  // Raw logs table schema (Akamai format)
  rawLogsSchema: {
    reqTimeSec: 'string',
    country: 'string',
    reqHost: 'string',
    reqPath: 'string',
    queryStr: 'string',
    reqMethod: 'string',
    proto: 'string',
    UA: 'string',
    statusCode: 'string',
    referer: 'string',
  },

  // Filtered logs table schema (normalized to standard format)
  filteredLogsSchema: {
    timestamp: 'string',
    geo_country: 'string',
    host: 'string',
    url: 'string',
    request_method: 'string',
    request_protocol: 'string',
    request_user_agent: 'string',
    response_state: 'string',
    response_status: 'int',
    response_reason: 'string',
    request_referer: 'string',
    agentic_type: 'string',
  },

  // Table properties
  tableProperties: {
    serdeLibrary: 'org.apache.hive.hcatalog.data.JsonSerDe',
    storageFormat: 'ROW FORMAT SERDE',
    filteredStorageFormat: 'STORED AS PARQUET',
  },
};

function extractCustomerDomain(site) {
  if (site && typeof site.getBaseURL === 'function') {
    const baseURL = site.getBaseURL();
    return new URL(baseURL).host.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  }
  return 'default_customer';
}

function getRawLogsBucket(environment, customerDomain) {
  if (environment === 'dev') {
    return 'elmo-fastly-wknd-site-cdn-logs';
  }
  const bucketCustomer = customerDomain.replace(/[._]/g, '-');
  return `cdn-logs-${bucketCustomer}`;
}

export function getAkamaiS3Config(context, site = null) {
  const { env, log } = context;
  const environment = env.AWS_ENV === 'prod' ? 'prod' : 'dev';
  const customerDomain = extractCustomerDomain(site);
  const rawLogsBucket = getRawLogsBucket(environment, customerDomain);

  const config = {
    cdnType: 'akamai',
    rawLogsBucket,
    analysisBucket: rawLogsBucket,
    customerDomain,
    environment,
    getAthenaTempLocation: () => `s3://${rawLogsBucket}/temp/athena-results/`,
  };

  log.info(`Akamai S3 Config: ${customerDomain} (${environment})`, {
    rawLogsBucket: config.rawLogsBucket,
    analysisBucket: config.analysisBucket,
  });

  return config;
}

export function getAkamaiCustomerRawLogsLocation(s3Config) {
  return `s3://${s3Config.rawLogsBucket}/raw/`;
}

export function getAkamaiRawLogsPartitionConfig(s3Config) {
  const baseLocation = getAkamaiCustomerRawLogsLocation(s3Config);
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
