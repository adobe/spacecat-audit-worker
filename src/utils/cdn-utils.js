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

import { HeadBucketCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import zlib from 'zlib';
import { hasText } from '@adobe/spacecat-shared-utils';

/* c8 ignore start */
export const CDN_TYPES = {
  AKAMAI: 'akamai',
  FASTLY: 'fastly',
  CLOUDFLARE: 'cloudflare',
  CLOUDFRONT: 'cloudfront',
  FRONTDOOR: 'frontdoor',
};

export const SERVICE_PROVIDER_TYPES = {
  AEM_CS_FASTLY: 'aem-cs-fastly',
  COMMERCE_FASTLY: 'commerce-fastly',
  BYOCDN_FASTLY: 'byocdn-fastly',
  BYOCDN_AKAMAI: 'byocdn-akamai',
  BYOCDN_CLOUDFLARE: 'byocdn-cloudflare',
  BYOCDN_CLOUDFRONT: 'byocdn-cloudfront',
  BYOCDN_FRONTDOOR: 'byocdn-frontdoor',
  AMS_CLOUDFRONT: 'ams-cloudfront',
  AMS_FRONTDOOR: 'ams-frontdoor',
};

// Maps service providers to underlying CDN providers
export const SERVICE_TO_CDN_MAPPING = {
  [SERVICE_PROVIDER_TYPES.AEM_CS_FASTLY]: CDN_TYPES.FASTLY,
  [SERVICE_PROVIDER_TYPES.COMMERCE_FASTLY]: CDN_TYPES.FASTLY,
  [SERVICE_PROVIDER_TYPES.BYOCDN_FASTLY]: CDN_TYPES.FASTLY,
  [SERVICE_PROVIDER_TYPES.BYOCDN_AKAMAI]: CDN_TYPES.AKAMAI,
  [SERVICE_PROVIDER_TYPES.BYOCDN_CLOUDFLARE]: CDN_TYPES.CLOUDFLARE,
  [SERVICE_PROVIDER_TYPES.BYOCDN_CLOUDFRONT]: CDN_TYPES.CLOUDFRONT,
  [SERVICE_PROVIDER_TYPES.BYOCDN_FRONTDOOR]: CDN_TYPES.FRONTDOOR,
  [SERVICE_PROVIDER_TYPES.AMS_CLOUDFRONT]: CDN_TYPES.CLOUDFRONT,
  [SERVICE_PROVIDER_TYPES.AMS_FRONTDOOR]: CDN_TYPES.FRONTDOOR,
};

/**
 * Maps service provider to CDN provider for SQL purposes
 * @param {string} serviceProvider - Service provider name
 * @returns {string} CDN provider name
 */
export function mapServiceToCdnProvider(serviceProvider) {
  return SERVICE_TO_CDN_MAPPING[serviceProvider] || serviceProvider;
}

/**
 * Extracts and sanitizes customer domain from site
 */
export function extractCustomerDomain(site) {
  const { host } = new URL(site.getBaseURL());
  const cleanHost = host.startsWith('www.') ? host.substring(4) : host;
  return cleanHost.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

/**
 * Generates new standardized bucket name based on environment
 */
export function generateStandardBucketName(env = 'prod') {
  return `cdn-logs-adobe-${env}`;
}

/**
 * Validates if a bucket name is a standard CDN logs bucket
 * @param {string} bucketName - The bucket name to validate
 * @returns {boolean} True if it matches allowed patterns
 */
export function isStandardAdobeCdnBucket(bucketName) {
  // Match cdn-logs-adobe-(prod|dev|stage) exactly
  if (/^cdn-logs-adobe-(prod|dev|stage)$/.test(bucketName)) {
    return true;
  }

  // Match cdn-logs-{mixed alphanumeric} - must contain both letters and numbers
  if (/^cdn-logs-[a-zA-Z0-9-]+$/.test(bucketName)) {
    // Extract the part after 'cdn-logs-' to check for mixed content
    const suffix = bucketName.substring('cdn-logs-'.length);
    if (/[a-zA-Z]/.test(suffix) && /[0-9]/.test(suffix)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves bucket name for a site - handles both legacy and new buckets
 */
export async function resolveCdnBucketName(site, context) {
  const {
    s3Client, log, env,
  } = context;

  // If the bucket name is configured, use it
  const { bucketName } = site.getConfig()?.getLlmoCdnBucketConfig() || {};
  if (bucketName) {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return bucketName;
  }

  // Try standardized environment-based bucket (if env is available)
  if (env?.AWS_ENV) {
    const environment = env.AWS_ENV;
    const standardBucket = generateStandardBucketName(environment);
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: standardBucket }));
      return standardBucket;
    } catch (error) {
      log.info(`Standardized bucket ${standardBucket} not found`, error);
    }
  }

  log.error(`No CDN bucket found for site: ${site.getBaseURL()}`);
  return null;
}

async function bufferFromStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function determineCdnProvider(s3, bucket, prefix) {
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: prefix, MaxKeys: 1,
  }));
  const key = list.Contents?.[0]?.Key;
  if (!key) return null;

  let text;
  if (key.endsWith('.gz')) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    text = zlib.gunzipSync(await bufferFromStream(obj.Body)).toString();
  } else {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-65535' }),
    );
    text = (await bufferFromStream(obj.Body)).toString();
  }
  const first = text.split('\n').find((l) => l.trim());
  try {
    const rec = JSON.parse(first);
    if (hasText(rec.reqPath)) return CDN_TYPES.AKAMAI;
    if (hasText(rec.url)) return CDN_TYPES.FASTLY;
    if (hasText(rec.ClientRequestURI)) return CDN_TYPES.CLOUDFLARE;
  } catch {
    // fall-through intended
  }
  throw new Error(`Unrecognized CDN Type. Bucket: ${bucket}`);
}

/**
 * Builds CDN path structure - supports legacy and new format
 * @param {string} bucketName - S3 bucket name
 * @param {string} serviceProvider - service provider
 * @param {Object} timeParts - Time parts {year, month, day, hour}
 * @param {string} imsOrgId - IMS Organization ID (for new structure)
 */
export function buildCdnPaths(bucketName, serviceProvider, timeParts, imsOrgId = null) {
  const {
    year, month, day, hour,
  } = timeParts;

  // New standardized bucket structure: cdn-logs-adobe-{env}/{imsOrgId}/raw/{serviceProvider}/
  if (isStandardAdobeCdnBucket(bucketName) && imsOrgId) {
    return {
      rawLocation: `s3://${bucketName}/${imsOrgId}/raw/${serviceProvider}/`,
      aggregatedLocation: `s3://${bucketName}/${imsOrgId}/aggregated/`,
      aggregatedOutput: `s3://${bucketName}/${imsOrgId}/aggregated/${year}/${month}/${day}/${hour}/`,
      aggregatedReferralLocation: `s3://${bucketName}/${imsOrgId}/aggregated-referral/`,
      aggregatedReferralOutput: `s3://${bucketName}/${imsOrgId}/aggregated-referral/${year}/${month}/${day}/${hour}/`,
      tempLocation: `s3://${bucketName}/temp/athena-results/`,
    };
  }

  return {
    rawLocation: `s3://${bucketName}/raw/`,
    aggregatedLocation: `s3://${bucketName}/aggregated/`,
    aggregatedReferralLocation: `s3://${bucketName}/aggregated-referral/`,
    aggregatedOutput: `s3://${bucketName}/aggregated/${year}/${month}/${day}/${hour}/`,
    aggregatedReferralOutput: `s3://${bucketName}/aggregated-referral/${year}/${month}/${day}/${hour}/`,
    tempLocation: `s3://${bucketName}/temp/athena-results/`,
  };
}

/**
 * Determines if bucket is legacy based on the providers found
 * @param {string[]} providers - List of folders under raw/
 * @returns {boolean} True if legacy structure
 */
function isLegacyBucketStructure(providers) {
  const knownCdnProviders = Object.values(SERVICE_PROVIDER_TYPES);
  const hasKnownProvider = providers?.some((provider) => knownCdnProviders.includes(provider));

  if (hasKnownProvider) {
    return false;
  }

  return true;
}

/**
 * Gets bucket structure info once and returns legacy status + service providers
 * @param {Object} s3Client - S3 client instance
 * @param {string} bucketName - The S3 bucket name
 * @param {string} imsOrgId - IMS Organization ID (for new structure)
 * @returns {Promise<{isLegacy: boolean, providers: string[]}>} Bucket info
 */
export async function getBucketInfo(s3Client, bucketName, imsOrgId = null) {
  try {
    let providers = [];
    // For standardized Adobe buckets with IMS org, check under {imsOrgId}/raw/
    if (isStandardAdobeCdnBucket(bucketName) && imsOrgId) {
      const response = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: `${imsOrgId}/raw/`,
        Delimiter: '/',
        MaxKeys: 10,
      }));

      providers = (response.CommonPrefixes || [])
        .map((prefix) => prefix.Prefix.replace(`${imsOrgId}/raw/`, '').replace('/', ''))
        .filter((provider) => provider && provider.length > 0);

      return { isLegacy: isLegacyBucketStructure(providers), providers };
    }

    return { isLegacy: true, providers };
  } catch {
    return { isLegacy: true, providers: [] };
  }
}

/**
 * Checks if data exists for a given path
 * @param {Object} s3Client - S3 client instance
 * @param {string} location - The S3 raw location path (s3://bucket/path/)
 * @returns {Promise<boolean>} True if path has data
 */
export async function pathHasData(s3Client, location) {
  try {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: location.replace('s3://', '').split('/')[0],
      Prefix: location.replace('s3://', '').split('/').slice(1).join('/'),
      MaxKeys: 1,
    }));
    return response.Contents && response.Contents.length > 0;
  } catch {
    return false;
  }
}

/**
 * Discovers all CDN providers in a bucket's raw folder
 * For legacy buckets, returns single provider detected from content
 */
export async function discoverCdnProviders(s3Client, bucketName, timeParts) {
  const prefix = `raw/${timeParts.year}/${timeParts.month}/${timeParts.day}/${timeParts.hour}/`;

  const cdnProvider = await determineCdnProvider(s3Client, bucketName, prefix);
  if (cdnProvider) {
    return [cdnProvider];
  }

  return [];
}
/* c8 ignore end */
