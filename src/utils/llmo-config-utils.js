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

import { llmoConfig } from '@adobe/spacecat-shared-utils';

function resolveSiteId(site) {
  return site?.getId?.();
}

export async function getConfigCdnProvider(site, context) {
  const { log, s3Client, env = {} } = context;
  const siteId = resolveSiteId(site);
  const s3Bucket = env.S3_IMPORTER_BUCKET_NAME;

  if (!siteId || !s3Client || !s3Bucket) {
    return '';
  }

  try {
    const { config } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket });
    return config?.cdnBucketConfig?.cdnProvider?.trim?.() || '';
  } catch (error) {
    log?.warn?.(`Failed to fetch config CDN provider: ${error.message}`);
    return '';
  }
}
