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
import { BaseProvider } from './base-provider.js';
import { buildTypeClassification } from './agentic-patterns.js';

const AKAMAI_CONFIG = {
  cdnType: 'akamai',
  databaseName: 'cdn_logs_',
  userAgentField: 'ua',
  defaultFilterClause: null,

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

  tableProperties: {
    serdeLibrary: 'org.apache.hive.hcatalog.data.JsonSerDe',
    storageFormat: 'ROW FORMAT SERDE',
    filteredStorageFormat: 'STORED AS PARQUET',
  },
};

function mapAkamaiFieldsForUnload() {
  const mkUrl = `CONCAT(
    reqPath,
    CASE WHEN queryStr IS NOT NULL AND queryStr != ''
      THEN CONCAT('?', queryStr)
    ELSE '' END
  ) AS url`;

  return {
    selectFields: [
      'reqTimeSec AS timestamp',
      'country AS geo_country',
      'reqHost AS host',
      mkUrl,
      'reqMethod AS request_method',
      'proto AS request_protocol',
      'ua AS request_user_agent',
      'CASE WHEN statusCode < \'400\' THEN \'HIT\' ELSE \'ERROR\' END AS response_state',
      'statusCode AS response_status',
      `CASE
         WHEN statusCode = '200' THEN 'OK'
         WHEN statusCode = '404' THEN 'Not Found'
         WHEN statusCode >= '500' THEN 'Server Error'
         ELSE 'Other'
       END AS response_reason`,
      'referer AS request_referer',
      `${buildTypeClassification('ua')} AS agentic_type`,
    ].join(',\n          '),
  };
}

export class AkamaiProvider extends BaseProvider {
  static config = AKAMAI_CONFIG;

  static mapFieldsForUnload = mapAkamaiFieldsForUnload;
}

/* c8 ignore stop */
