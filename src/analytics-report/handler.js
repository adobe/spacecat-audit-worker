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

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createFrom } from '@adobe/spacecat-helix-content-sdk';
import { uploadAndPublishFile } from '../utils/report-uploader.js';
import { AuditBuilder } from '../common/audit-builder.js';

function getLastWeekFormat(dateString) {
  const date = new Date(dateString);
  // Subtract 7 days to get last week
  date.setDate(date.getDate() - 7);

  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const week = Math.ceil(((date - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `w${week.toString().padStart(2, '0')}-${year}`;
}

export async function analyticsReportRunner(auditUrl, context) {
  const { log, s3Client } = context;
  const bucketName = 'referral-revenue-reports';
  const SHAREPOINT_URL = 'https://adobe.sharepoint.com/:x:/r/sites/HelixProjects'
    + '/Shared%20Documents/sites/elmo-ui-data';
  const sharepointClient = await createFrom({
    clientId: process.env.SHAREPOINT_CLIENT_ID,
    clientSecret: process.env.SHAREPOINT_CLIENT_SECRET,
    authority: process.env.SHAREPOINT_AUTHORITY,
    domainId: process.env.SHAREPOINT_DOMAIN_ID,
  }, { url: SHAREPOINT_URL, type: 'onedrive' });

  try {
    const currentDate = new Date().toISOString().split('T')[0];
    const { Contents: allFiles } = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucketName }),
    );

    const todayFiles = allFiles?.filter((file) => (
      file.Key.endsWith('.xlsx') && file.Key.includes(currentDate)
    )) || [];

    if (!todayFiles.length) {
      return {
        auditResult: {
          processed: 0,
          success: true,
        },
        fullAuditRef: `${currentDate}-analytics-report`,
      };
    }

    for (const file of todayFiles) {
      // eslint-disable-next-line no-await-in-loop
      const { Body } = await s3Client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: file.Key }),
      );
      // eslint-disable-next-line no-await-in-loop
      const buffer = await Body.transformToByteArray();

      const pathParts = file.Key.split('/');
      const originalFilename = pathParts.pop();
      const outputLocation = pathParts.join('/');

      const weekFormat = getLastWeekFormat(currentDate);
      const filename = originalFilename.replace(currentDate, weekFormat);

      // eslint-disable-next-line no-await-in-loop
      await uploadAndPublishFile(
        buffer,
        filename,
        outputLocation,
        sharepointClient,
        log,
      );
    }

    return {
      auditResult: {
        processed: todayFiles.length,
        success: true,
      },
      fullAuditRef: `${currentDate}-analytics-report`,
    };
  } catch (error) {
    log.error(`Analytics report failed: ${error.message}`);
    throw error;
  }
}

export default new AuditBuilder()
  .withRunner(analyticsReportRunner)
  .build();
