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
import { isStandardAdobeCdnBucket } from '../../utils/cdn-utils.js';
import { weeklyBreakdownQueries } from '../utils/query-builder.js';

export function getConfigs(bucket, customerDomain, imsOrgId) {
  let s3path = `${bucket}`;
  if (bucket && isStandardAdobeCdnBucket(bucket)) {
    s3path = `${bucket}/${imsOrgId}/`;
  }

  return [
    {
      name: 'agentic',
      createTableSql: 'create-aggregated-table',
      aggregatedLocation: `s3://${s3path}/aggregated/`,
      tableName: `aggregated_logs_${customerDomain}`,
      filePrefix: 'agentictraffic',
      folderSuffix: 'agentic-traffic',
      workbookCreator: 'Spacecat Agentic Flat Report',
      queryFunction: weeklyBreakdownQueries.createAgenticReportQuery,
      sheetName: 'shared-all',
    },
    {
      name: 'referral',
      createTableSql: 'create-aggregated-referral-table',
      aggregatedLocation: `s3://${s3path}/aggregated-referral/`,
      tableName: `aggregated_referral_logs_${customerDomain}`,
      filePrefix: 'referral-traffic',
      folderSuffix: 'referral-traffic-cdn',
      workbookCreator: 'Spacecat Referral Flat Report',
      queryFunction: weeklyBreakdownQueries.createReferralReportQuery,
      sheetName: 'shared-all',
    }];
}
