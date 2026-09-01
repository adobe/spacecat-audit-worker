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
import { hasText, isoCalendarWeek } from '@adobe/spacecat-shared-utils';
import { resolveSemrushEntitlement } from '../utils/semrush-entitlement.js';
import { resolveEnableSemrush } from '../utils/offsite-audit-utils.js';
import { createOffsiteLogger, AUDIT } from '../utils/offsite-logging.js';

const BP_PLATFORM = 'chatgpt_free';

/**
 * `ingest_source` values on the `BRAND_PRESENCE_SHEET_WRITTEN` event. Additive contract
 * (LLMO-7177): the field is OPTIONAL and defaults to `brand_presence_s3` when absent (so a
 * pre-7177 consumer is unaffected). BOTH branches now stamp it explicitly — the DRS branch
 * with `brand_presence_s3`, the Semrush branch with `semrush_feed` — so Mystique can read
 * it to source the right feed (the DRS BP `.xlsx` in S3 vs the Semrush URL-Inspector feed
 * keyed by `domain`) without relying on the absent-means-DRS default.
 */
const INGEST_SOURCE_DRS = 'brand_presence_s3';
const INGEST_SOURCE_SEMRUSH = 'semrush_feed';

/**
 * Cadence stamped on the Semrush-branch event. Claims runs on a weekly cadence (see
 * `isMondayPartition`), and the `brands` projection (`getBrandForSite`) selects no cadence
 * column — there is none today — so the value is a fixed default. When a per-brand `cadence`
 * column is added to `brands`, extend that projection AND read it here (do not read
 * `brand.cadence` today: it is always `undefined`).
 */
const BRAND_CLAIMS_DEFAULT_CADENCE = 'weekly';

/**
 * Coerces a Slack-delivered `week`/`year` override to a bounded positive integer, or
 * `undefined` when absent/invalid. Slack custom args arrive as strings, so numeric strings
 * are accepted alongside real numbers; anything outside the sane bound is rejected (treated
 * as "not supplied") rather than trusted.
 *
 * @param {number|string} raw
 * @param {number} min
 * @param {number} max
 * @returns {number|undefined}
 */
function toBoundedInt(raw, min, max) {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return undefined;
  }
  return n;
}

/**
 * Resolves the `(week, year)` the Semrush run is FOR. Prefers an explicit run window from
 * `auditContext.messageData` (`week`+`year`, tri-state like `enableSemrush`: both must be
 * present and valid to override), so a retry / DLQ redrive that crosses the UTC ISO-week
 * boundary re-emits the SAME bucket for the same run rather than drifting to a new week.
 * Falls back to the current ISO week when no valid explicit window is supplied.
 *
 * @param {object} [auditContext] - `message.auditContext`
 * @returns {{week: number, year: number}}
 */
function resolveRunWeekYear(auditContext) {
  const md = auditContext?.messageData ?? {};
  const week = toBoundedInt(md.week, 1, 53);
  const year = toBoundedInt(md.year, 2000, 9999);
  if (week !== undefined && year !== undefined) {
    return { week, year };
  }
  return isoCalendarWeek(new Date());
}

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
    .order('name', { ascending: true })
    // Only the first row is used (deterministic tiebreak below); cap the result set so a
    // data-integrity violation can't return an unbounded list.
    .limit(2);

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

/**
 * True if the S3 date partition (`YYYY`/`MM`/`DD`) falls on a Monday (UTC).
 *
 * Claims runs on a WEEKLY cadence keyed to Monday's sheet: the Brand Claims
 * consumer's cadence gate drops a daily sheet whose `sheet_date` isn't a Monday.
 * So a daily sheet is only eligible as "latest" on a Monday partition.
 *
 * @param {string} yyyy - 4-digit year.
 * @param {string} mm - 2-digit month.
 * @param {string} dd - 2-digit day.
 * @returns {boolean} True when the date is a Monday.
 */
function isMondayPartition(yyyy, mm, dd) {
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return date.getUTCDay() === 1;
}

async function findLatestSheet(s3Client, bucket, prefix, log) {
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
        const [, week, year, dailySuffix] = filenameMatch;
        const [, yyyy, mm, dd] = dateMatch;
        const partitionDate = `${yyyy}-${mm}-${dd}`;
        const lastModified = object.LastModified ? new Date(object.LastModified).getTime() : 0;

        // Claims runs weekly on Monday's sheet; a daily sheet (6-digit run suffix)
        // is eligible as "latest" only on a Monday partition, matching the BP
        // consumer's daily→Monday cadence gate. Weekly sheets (no suffix) are
        // always eligible. (LLMO-6877)
        const eligible = !dailySuffix || isMondayPartition(yyyy, mm, dd);

        if (eligible
          && (!best
            || partitionDate > best.partitionDate
            || (partitionDate === best.partitionDate && lastModified > best.lastModified))) {
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

  // Keys sort lexicographically and the newest partitions sort last, so stopping at the
  // page cap with more results pending risks selecting a stale sheet — surface it.
  if (continuationToken) {
    log?.warn?.(`brand-claims: S3 listing hit the ${MAX_LISTING_PAGES}-page cap for prefix ${prefix} — selection may be stale`);
  }

  return best;
}

// Publishes the ready-signal for the brand's latest BP sheet, but only for brands whose
// brand_claims_enabled gate is on. Enabling/disabling the gate is done out of band (the
// api-service enable-brand-claims Slack command) and acts as the per-site opt-in list.
export default async function brandClaimsHandler(message, context) {
  const {
    log, sqs, dataAccess, s3Client, env,
  } = context;
  const { siteId } = message;

  if (!hasText(siteId)) {
    log.warn('brand-claims: message missing siteId');
    return ok();
  }

  // Infra/config faults throw so SQS retries and the message hits the DLQ with an error
  // signal, rather than being silently acked and lost.
  const queueUrl = env?.SQS_BP_SHEET_READY_QUEUE_URL;
  if (!hasText(queueUrl)) {
    throw new Error('brand-claims: SQS_BP_SHEET_READY_QUEUE_URL is not configured');
  }

  const drsBpBucket = env?.DRS_BP_BUCKET;
  if (!hasText(drsBpBucket)) {
    throw new Error('brand-claims: DRS_BP_BUCKET is not configured');
  }

  const postgrestClient = dataAccess?.services?.postgrestClient;
  if (!postgrestClient?.from) {
    throw new Error(`brand-claims: brand storage (postgrestClient) is not available for site ${siteId}`);
  }

  const { Site } = dataAccess;
  const site = context.site || await Site.findById(siteId);
  if (!site) {
    log.warn(`brand-claims: site not found: ${siteId}`);
    return ok();
  }

  // Use the canonical server-resolved ids for the brand query, event, and S3 prefix
  // rather than trusting the raw message value. organizationId is the SpaceCat org
  // UUID — the BP consumer feeds event.organization_id straight into the SpaceCat
  // brand API (/v2/orgs/{spaceCatId}/...), which 400s on an IMS org id.
  const resolvedSiteId = site.getId();
  const organizationId = site.getOrganizationId();

  const brand = await getBrandForSite(postgrestClient, organizationId, resolvedSiteId, log);
  if (!brand) {
    log.warn(`brand-claims: no active brand found for site ${resolvedSiteId}`);
    return ok();
  }

  // The brand_claims_enabled flag is the opt-in gate: it's set out of band (the api-service
  // enable-brand-claims Slack command) for the sites we want weekly claims on. A disabled
  // brand is skipped entirely — no ready-signal is published, so no claims are (re)generated
  // for sites we don't want to touch.
  if (!brand.brand_claims_enabled) {
    log.info(`brand-claims: brand ${brand.id} ("${brand.name}") on site ${resolvedSiteId} is not enabled for claims — skipping run`);
    return ok();
  }

  const brandSlug = sanitizePathComponent(brand.name);

  // Per-site DRS-vs-Semrush decision (LLMO-7177). Default is the DRS Brand Presence sheet;
  // Semrush is chosen only when it is enabled for this run AND the brand is entitled to it.
  // The per-run Slack override (`enableSemrush`) takes precedence over the env flag, mirroring
  // offsite-brand-presence's `resolveEnableSemrush` pattern. Anything else — disabled,
  // non-entitled, or an inconclusive entitlement check — falls back to the unchanged DRS path,
  // so a Semrush hiccup can never zero out a site that has a DRS sheet. This runs BEFORE the
  // `brandSlug` guard: the Semrush feed carries no S3 brand-slug path component (the downstream
  // Serenity proxy resolves workspace/project/market from `organization_id` + `brand_id`, both
  // already on the event), so a brand whose name sanitizes to empty can still run on the feed path.
  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_CLAIMS, siteId: resolvedSiteId });
  const enableSemrushOverride = resolveEnableSemrush(message?.auditContext ?? {}, olog);
  const semrushEnabled = enableSemrushOverride
    ?? (env?.BRAND_CLAIMS_SEMRUSH_ENABLED === 'true');

  if (semrushEnabled) {
    const entitlement = await resolveSemrushEntitlement(context, {
      orgId: organizationId, brandId: brand.id,
    });
    if (entitlement.entitled) {
      // Replay-stable window: an explicit `week`/`year` (Slack override / redrive) is used
      // verbatim, else the current ISO week — so a DLQ redrive across the week boundary does
      // not re-bucket the same run.
      const { week, year } = resolveRunWeekYear(message?.auditContext);
      // No `domain`: it is a per-market concept (each market has its own domain, the brand has
      // none), and the Serenity proxy resolves workspace/project/market from `organization_id`
      // + `brand_id` downstream — a brand-primary-site domain would mis-bind multi-market brands
      // (mysticat-architecture#248 correction).
      const event = {
        event_type: 'BRAND_PRESENCE_SHEET_WRITTEN',
        schema_version: 1,
        organization_id: organizationId,
        brand_id: brand.id,
        brand: brandSlug,
        site_id: resolvedSiteId,
        week,
        year,
        cadence: BRAND_CLAIMS_DEFAULT_CADENCE,
        sheet_date: null,
        platform: BP_PLATFORM,
        s3_bucket: null,
        s3_key: null,
        ingest_source: INGEST_SOURCE_SEMRUSH,
        parent_job_id: null,
        batch_id: null,
      };

      await sqs.sendMessage(queueUrl, event);
      log.info(`brand-claims: published Semrush-feed ready-signal for site ${resolvedSiteId} (brand "${brand.name}"), week=${week}, year=${year}`);
      return ok();
    }
    // resolved:true = confirmed non-entitlement (flag off / no workspace); resolved:false =
    // inconclusive (no client / transient error). Both fall back to DRS — the entitlement
    // helper already logs the granular reason.
    log.info(`brand-claims: brand ${brand.id} ("${brand.name}") on site ${resolvedSiteId} is not Semrush-entitled (reason=${entitlement.reason}, resolved=${entitlement.resolved}) — falling back to the DRS sheet`);
  }

  // DRS branch requires the S3 brand-slug path component; an empty slug cannot address a sheet.
  if (!brandSlug) {
    log.warn(`brand-claims: brand name "${brand.name}" (${brand.id}) sanitizes to an empty S3 path component — cannot look up its sheet`);
    return ok();
  }

  const prefix = `${resolvedSiteId}/${brandSlug}/analytics/${BP_PLATFORM}/`;
  const sheet = await findLatestSheet(s3Client, drsBpBucket, prefix, log);
  if (!sheet) {
    log.warn(`brand-claims: no Brand Presence sheet found for site ${resolvedSiteId} on platform ${BP_PLATFORM} — enabled but nothing to run`);
    return ok();
  }

  const event = {
    event_type: 'BRAND_PRESENCE_SHEET_WRITTEN',
    schema_version: 1,
    organization_id: organizationId,
    brand_id: brand.id,
    brand: brandSlug,
    site_id: resolvedSiteId,
    week: sheet.week,
    year: sheet.year,
    cadence: sheet.cadence,
    sheet_date: sheet.sheetDate,
    platform: BP_PLATFORM,
    s3_bucket: drsBpBucket,
    s3_key: sheet.key,
    ingest_source: INGEST_SOURCE_DRS,
    parent_job_id: null,
    batch_id: null,
  };

  await sqs.sendMessage(queueUrl, event);
  log.info(`brand-claims: published ready-signal for site ${resolvedSiteId} (brand "${brand.name}"), s3_key=${sheet.key}`);

  return ok();
}
