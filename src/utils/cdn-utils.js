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

import { HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import crypto from 'crypto';

export const CDN_TYPES = {
  AKAMAI: 'akamai',
  FASTLY: 'fastly',
};

const LEGACY_BUCKET_MAP = {
  'adobe.com': { bucket: 'cdn-logs-adobe-com', provider: CDN_TYPES.AKAMAI },
  'business.adobe.com': { bucket: 'cdn-logs-adobe-com', provider: CDN_TYPES.AKAMAI },
  'bulk.com': { bucket: 'cdn-logs-bulk-com', provider: CDN_TYPES.FASTLY },
  'wilson.com': { bucket: 'cdn-logs-amersports', provider: CDN_TYPES.FASTLY },
  'wknd.site': { bucket: 'cdn-logs-wknd-site', provider: CDN_TYPES.FASTLY },
  'akamai.synth': { bucket: 'cdn-logs-akamai-synthetic', provider: CDN_TYPES.AKAMAI },
  'fastly.synth': { bucket: 'cdn-logs-fastly-synthetic', provider: CDN_TYPES.FASTLY },
};

/**
 * Extracts and sanitizes customer domain from site
 */
export function extractCustomerDomain(site) {
  const { host } = new URL(site.getBaseURL());
  const cleanHost = host.startsWith('www.') ? host.substring(4) : host;
  return cleanHost.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

/**
 * Generates bucket name from IMS org ID using hash algorithm
 */
export function generateBucketName(orgId) {
  const hash = crypto.createHash('sha256').update(orgId).digest('hex');
  const hashSuffix = hash.substring(0, 16);
  return `cdn-logs-${hashSuffix}`;
}

/**
 * Resolves bucket name for a site - handles both legacy and new buckets
 */
export async function resolveCdnBucketName(site, context) {
  const { s3Client, dataAccess, log } = context;

  const legacyConfig = LEGACY_BUCKET_MAP[site.getBaseURL().replace(/https?:\/\//, '')];
  if (legacyConfig) {
    log.info(`Using legacy bucket: ${legacyConfig.bucket} (${legacyConfig.provider})`);
    return legacyConfig.bucket;
  }

  try {
    const organizationId = site.getOrganizationId();
    const { Organization } = dataAccess;
    const organization = await Organization.findById(organizationId);
    const imsOrgId = organization?.getImsOrgId();

    if (imsOrgId) {
      const bucketName = generateBucketName(imsOrgId);
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      log.info(`Using IMS org bucket: ${bucketName}`);
      return bucketName;
    }
  } catch (error) {
    log.warn(`IMS org bucket lookup failed: ${error.message}`);
  }

  log.error(`No CDN bucket found for site: ${site.getBaseURL()}`);
  return null;
}

/**
 * Builds CDN path structure - supports both legacy and new format
 * @param {string} bucketName - S3 bucket name
 * @param {string} cdnProvider - CDN provider (akamai/fastly)
 * @param {Object} timeParts - Time parts {year, month, day, hour}
 * @param {boolean} isLegacy - Whether to use new structure with CDN provider folders
 */
export function buildCdnPaths(bucketName, cdnProvider, timeParts, isLegacy = false) {
  const {
    year, month, day, hour,
  } = timeParts;

  if (!isLegacy) {
    return {
      rawLogsPrefix: `raw/${cdnProvider}/${year}/${month}/${day}/${hour}/`,
      rawLocation: `s3://${bucketName}/raw/${cdnProvider}/`,
      aggregatedOutput: `s3://${bucketName}/aggregated/${year}/${month}/${day}/${hour}/`,
      tempLocation: `s3://${bucketName}/temp/athena-results/`,
    };
  } else {
    // Legacy structure: cdn-logs-domain/raw/2025/01/01/00/
    return {
      rawLogsPrefix: `raw/${year}/${month}/${day}/${hour}/`,
      rawLocation: `s3://${bucketName}/raw/`,
      aggregatedOutput: `s3://${bucketName}/aggregated/${year}/${month}/${day}/${hour}/`,
      tempLocation: `s3://${bucketName}/temp/athena-results/`,
    };
  }
}

/**
 * Detects if site uses legacy bucket mapping
 */
export function isLegacyBucket(site) {
  return !!LEGACY_BUCKET_MAP[site.getBaseURL().replace(/https?:\/\//, '')];
}

/**
 * Discovers all CDN providers in a bucket's raw folder
 * For new structure buckets, lists folders under raw/
 * For legacy buckets, returns single provider detected from content
 */
export async function discoverCdnProviders(s3Client, bucketName, site, log) {
  const legacyConfig = LEGACY_BUCKET_MAP[site.getBaseURL().replace(/https?:\/\//, '')];
  if (legacyConfig) {
    log.info(`Legacy bucket using known provider: ${legacyConfig.provider}`);
    return [legacyConfig.provider];
  }

  try {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'raw/',
      Delimiter: '/',
      MaxKeys: 100,
    }));

    /* c8 ignore next */
    const providers = (response.CommonPrefixes || [])
      .map((prefix) => prefix.Prefix.replace('raw/', '').replace('/', ''))
      .filter((provider) => provider && provider.length > 0);

    log.info(`Discovered CDN providers in ${bucketName}: ${providers.join(', ')}`);
    return providers;
  } catch (error) {
    log.error(`Error discovering CDN providers: ${error.message}`);
    return ['fastly'];
  }
}
