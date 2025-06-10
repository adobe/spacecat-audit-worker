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
import { getObjectKeysFromSubfolders } from './data-processing.js';

export async function getExistingUrlsFromFailedAudits(s3Client, bucketName, siteId, log) {
  const version = new Date().toISOString().split('T')[0];
  let existingKeys = [];
  try {
    existingKeys = await getObjectKeysFromSubfolders(
      s3Client,
      bucketName,
      'accessibility',
      siteId,
      version,
      log,
    );
    log.info(`[A11yAudit] Found existing URLs from failed audits: ${existingKeys.objectKeys}`);
  } catch (error) {
    log.error(`[A11yAudit] Error getting existing URLs from failed audits: ${error}`);
  }

  const existingUrls = existingKeys.map((key) => {
    const fileName = key.split('/').pop();
    const url = fileName.replace('.json', '');
    const pieces = url.split('_');
    const almostFullUrl = pieces.reduce((acc, piece, index) => {
      if (index < 2) {
        return `${acc}${piece}.`;
      }
      return `${acc}${piece}/`;
    }, '');
    return `https://${almostFullUrl}`;
  });

  return existingUrls;
}
