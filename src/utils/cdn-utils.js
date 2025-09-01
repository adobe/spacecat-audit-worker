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
import crypto from 'crypto';
import zlib from 'zlib';
import { hasText } from '@adobe/spacecat-shared-utils';

/* c8 ignore start */
export const CDN_TYPES = {
  AKAMAI: 'akamai',
  FASTLY: 'fastly',
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

  const { bucketName } = site.getConfig().getCdnLogsConfig() || {};
  if (bucketName) {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return bucketName;
  }

  try {
    const organizationId = site.getOrganizationId();
    const { Organization } = dataAccess;
    const organization = await Organization.findById(organizationId);
    const imsOrgId = organization?.getImsOrgId();

    if (imsOrgId) {
      const generatedBucketName = generateBucketName(imsOrgId);
      await s3Client.send(new HeadBucketCommand({ Bucket: generatedBucketName }));
      log.info(`Using IMS org bucket: ${generatedBucketName}`);
      return generatedBucketName;
    }
  } catch (error) {
    log.warn(`IMS org bucket lookup failed: ${error.message}`);
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
  } catch {
    // fall-through intended
  }
  throw new Error(`Unrecognized CDN Type. Bucket: ${bucket}`);
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
      rawLocation: `s3://${bucketName}/raw/${cdnProvider}/`,
      aggregatedOutput: `s3://${bucketName}/aggregated/${year}/${month}/${day}/${hour}/`,
      aggregatedReferralOutput: `s3://${bucketName}/aggregated-referral/${year}/${month}/${day}/${hour}/`,
      tempLocation: `s3://${bucketName}/temp/athena-results/`,
    };
  } else {
    // Legacy structure: cdn-logs-domain/raw/2025/01/01/00/
    return {
      rawLocation: `s3://${bucketName}/raw/`,
      aggregatedOutput: `s3://${bucketName}/aggregated/${year}/${month}/${day}/${hour}/`,
      aggregatedReferralOutput: `s3://${bucketName}/aggregated-referral/${year}/${month}/${day}/${hour}/`,
      tempLocation: `s3://${bucketName}/temp/athena-results/`,
    };
  }
}

/**
 * Determines if bucket is legacy based on the providers found
 * @param {string[]} providers - List of folders under raw/
 * @param {string} year - Current year to check for
 * @returns {boolean} True if legacy structure
 */
function isLegacyBucketStructure(providers) {
  const knownCdnProviders = Object.values(CDN_TYPES);
  const hasKnownProvider = providers?.some((provider) => knownCdnProviders.includes(provider));

  if (hasKnownProvider) {
    return false;
  }

  return true;
}

/**
 * Gets bucket structure info once and returns legacy status + providers
 * @param {Object} s3Client - S3 client instance
 * @param {string} bucketName - The S3 bucket name
 * @param {Object} timeParts - Time parts {year, month, day, hour}
 * @returns {Promise<{isLegacy: boolean, providers: string[]}>} Bucket info
 */
export async function getBucketInfo(s3Client, bucketName) {
  try {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'raw/',
      Delimiter: '/',
      MaxKeys: 10,
    }));

    const providers = (response.CommonPrefixes || [])
      .map((prefix) => prefix.Prefix.replace('raw/', '').replace('/', ''))
      .filter((provider) => provider && provider.length > 0);

    const isLegacy = isLegacyBucketStructure(providers);

    return { isLegacy, providers };
  } catch {
    return { isLegacy: true, providers: [] };
  }
}

/**
 * Discovers all CDN providers in a bucket's raw folder
 * For new structure buckets, lists folders under raw/
 * For legacy buckets, returns single provider detected from content
 */
export async function discoverCdnProviders(s3Client, bucketName, timeParts) {
  const cdnProvider = await determineCdnProvider(
    s3Client,
    bucketName,
    `raw/${timeParts.year}/${timeParts.month}/${timeParts.day}/${timeParts.hour}/`,
  );
  if (cdnProvider) {
    return [cdnProvider];
  }

  return ['fastly'];
}
/* c8 ignore end */
