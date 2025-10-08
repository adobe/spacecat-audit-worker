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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { defaultPersister as createAudit, defaultSiteProvider as findSiteById } from '../common/base-audit.js';

/* c8 ignore start */

export async function refreshGeoBrandPresenceSheetsHandler(message, context) {
  const { log } = context;
  const { siteId, auditContext } = message;

  const site = await findSiteById(siteId, context);

  // find sheets that need to be refreshed
  // TODO(aurelio)
  // mock data
  const sheets = [
    'brandpresence-all-w35-2025',
    'brandpresence-all-w36-2025',
    'brandpresence-all-w37-2025',
    'brandpresence-all-w38-2025',
    'brandpresence-all-w39-2025',
    'brandpresence-all-w40-2025',
    'brandpresence-all-w41-2025',
    'brandpresence-all-w42-2025',
  ];

  // save metadata for S3 to track progress

  const audit = await createAudit({
    // audit data goes here
  }, context);

  // Create S3 folder for audit tracking
  const { s3Client, env } = context;
  const bucketName = env?.S3_IMPORTER_BUCKET_NAME;

  if (bucketName && s3Client) {
    const auditId = audit.getId();
    const folderKey = `refresh_geo_brand_presence/${auditId}/metadata.json`;

    try {
      // Create a metadata file to establish the folder structure
      const files = sheets.map((sheetName) => ({
        file_name: `${sheetName}.xlsx`,
        status: 'pending',
        last_updated: null,
      }));

      const metadata = {
        audit_id: auditId,
        created_at: new Date().toISOString(),
        status: 'in_progress',
        files,
        summary: {
          total_files: files.length,
          completed: 0,
          pending: files.length,
          failed: 0,
        },
      };

      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: folderKey,
        Body: JSON.stringify(metadata, null, 2),
        ContentType: 'application/json',
      }));

      log.info('Created S3 folder for audit %s at s3://%s/%s', auditId, bucketName, folderKey);
    } catch (error) {
      log.error('Failed to create S3 folder for audit %s: %s', auditId, error instanceof Error ? error.message : String(error));
    }
  } else {
    log.warn('S3 bucket name or client not available, skipping folder creation');
  }

  log.info('Site: %s, Audit: %s, Context:', site, audit, auditContext);

  return ok();
}
