/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import crypto from 'crypto';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ok } from '@adobe/spacecat-shared-http-utils';
import { hasText } from '@adobe/spacecat-shared-utils';

const BP_PLATFORM = 'chatgpt_free';
const SHEET_FILENAME_RE = /-w(\d{1,2})-(\d{4})(?:-(\d{6}))?\.xlsx$/i;
const KEY_DATE_RE = /\/(\d{4})\/(\d{2})\/(\d{2})\//;
const MAX_LISTING_PAGES = 10;

// Must match DRS's sanitize_path_component byte-for-byte (BP consumer re-lists on this value).
export function sanitizePathComponent(component) {
  const raw = typeof component === 'string' ? component : String(component ?? '');
  let sanitized = raw.toLowerCase()
    .replaceAll('.', '-')
    .replaceAll('/', '-')
    .replaceAll('\\', '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!sanitized && raw.trim()) {
    sanitized = crypto.createHash('sha256').update(raw.toLowerCase(), 'utf8').digest('hex').slice(0, 16);
  }

  return sanitized;
}

async function getBrandForSite(postgrestClient, organizationId, siteId, log) {
  const { data, error } = await postgrestClient
    .from('brands')
    .select('id, name, brand_claims_enabled')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .eq('site_id', siteId)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to resolve brand for site: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    log?.warn?.(
      `brand-claims: multiple active brands for org ${organizationId} site ${siteId} `
      + `(LLMO-4592 invariant violation): picking ${data[0].id} deterministically`,
    );
  }
  return data[0];
}

async function enableBrandClaims(postgrestClient, brandId, updatedBy) {
  const { data, error } = await postgrestClient
    .from('brands')
    .update({ brand_claims_enabled: true, updated_by: updatedBy })
    .eq('id', brandId)
    .neq('status', 'deleted')
    .select('id, name')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update brand claims flag: ${error.message}`);
  }
  return data || null;
}

async function findLatestSheet(s3Client, bucket, prefix) {
  let best = null;
  let continuationToken;
  let pages = 0;

  do {
    pages += 1;
    // eslint-disable-next-line no-await-in-loop
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of response.Contents || []) {
      const key = object.Key;
      const filenameMatch = key.match(SHEET_FILENAME_RE);
      const dateMatch = key.match(KEY_DATE_RE);

      if (filenameMatch && dateMatch) {
        const [, yyyy, mm, dd] = dateMatch;
        const partitionDate = `${yyyy}-${mm}-${dd}`;
        const lastModified = object.LastModified ? new Date(object.LastModified).getTime() : 0;

        if (!best
          || partitionDate > best.partitionDate
          || (partitionDate === best.partitionDate && lastModified > best.lastModified)) {
          const [, week, year, dailySuffix] = filenameMatch;
          best = {
            key,
            partitionDate,
            lastModified,
            week: parseInt(week, 10),
            year: parseInt(year, 10),
            cadence: dailySuffix ? 'daily' : 'weekly',
            sheetDate: partitionDate,
          };
        }
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken && pages < MAX_LISTING_PAGES);

  return best;
}

// Enables the brand's claims gate, then re-publishes the ready-signal for its latest BP sheet.
export default async function brandClaimsHandler(message, context) {
  const {
    log, sqs, dataAccess, s3Client, env,
  } = context;
  const { siteId } = message;

  if (!hasText(siteId)) {
    log.error('brand-claims: message missing siteId');
    return ok();
  }

  const queueUrl = env?.SQS_BP_SHEET_READY_QUEUE_URL;
  if (!hasText(queueUrl)) {
    log.error('brand-claims: SQS_BP_SHEET_READY_QUEUE_URL is not configured');
    return ok();
  }

  const drsBpBucket = env?.DRS_BP_BUCKET;
  if (!hasText(drsBpBucket)) {
    log.error('brand-claims: DRS_BP_BUCKET is not configured');
    return ok();
  }

  const postgrestClient = dataAccess?.services?.postgrestClient;
  if (!postgrestClient?.from) {
    log.error(`brand-claims: brand storage (postgrestClient) is not available for site ${siteId}`);
    return ok();
  }

  const { Site, Organization } = dataAccess;
  const site = context.site || await Site.findById(siteId);
  if (!site) {
    log.warn(`brand-claims: site not found: ${siteId}`);
    return ok();
  }

  const organizationId = site.getOrganizationId();
  const organization = await Organization.findById(organizationId);
  const imsOrgId = organization?.getImsOrgId?.();
  if (!hasText(imsOrgId)) {
    log.warn(`brand-claims: could not resolve an IMS org for site ${siteId}`);
    return ok();
  }

  const brand = await getBrandForSite(postgrestClient, organizationId, siteId, log);
  if (!brand) {
    log.warn(`brand-claims: no active brand found for site ${siteId}`);
    return ok();
  }

  if (brand.brand_claims_enabled) {
    log.info(`brand-claims: already enabled for brand ${brand.id} ("${brand.name}") on site ${siteId} — skipping enable`);
  } else {
    await enableBrandClaims(postgrestClient, brand.id, 'audit-worker:brand-claims');
    log.info(`brand-claims: enabled for brand ${brand.id} ("${brand.name}") on site ${siteId}`);
  }

  const brandSlug = sanitizePathComponent(brand.name);
  if (!brandSlug) {
    log.warn(`brand-claims: brand name "${brand.name}" (${brand.id}) sanitizes to an empty S3 path component — enabled but cannot look up its sheet`);
    return ok();
  }

  const prefix = `${siteId}/${brandSlug}/analytics/${BP_PLATFORM}/`;
  const sheet = await findLatestSheet(s3Client, drsBpBucket, prefix);
  if (!sheet) {
    log.warn(`brand-claims: no Brand Presence sheet found for site ${siteId} on platform ${BP_PLATFORM} — enabled but nothing to run`);
    return ok();
  }

  const event = {
    event_type: 'BRAND_PRESENCE_SHEET_WRITTEN',
    schema_version: 1,
    organization_id: imsOrgId,
    brand_id: brand.id,
    brand: brandSlug,
    site_id: siteId,
    week: sheet.week,
    year: sheet.year,
    cadence: sheet.cadence,
    sheet_date: sheet.sheetDate,
    platform: BP_PLATFORM,
    s3_bucket: drsBpBucket,
    s3_key: sheet.key,
    parent_job_id: null,
    batch_id: null,
  };

  await sqs.sendMessage(queueUrl, event);
  log.info(`brand-claims: published ready-signal for site ${siteId} (brand "${brand.name}"), s3_key=${sheet.key}`);

  return ok();
}
