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

import { S3Client } from '@aws-sdk/client-s3';
import { getStaticContent, isoCalendarWeek } from '@adobe/spacecat-shared-utils';

// Region of the importer bucket (S3_IMPORTER_BUCKET_NAME) the daily exports write to.
export const IMPORTER_BUCKET_REGION = 'us-east-1';

let importerS3Client;
/**
 * Lazily-created, shared S3 client pinned to the importer bucket region. Reused
 * across the agentic + referral daily exports and across warm Lambda invocations,
 * instead of constructing a new client per export.
 */
export function getImporterS3Client() {
  if (!importerS3Client) {
    importerS3Client = new S3Client({ region: IMPORTER_BUCKET_REGION });
  }
  return importerS3Client;
}

export async function loadSql(filename, variables) {
  return getStaticContent(variables, `./src/cdn-logs-report/sql/${filename}.sql`);
}

/**
 * Generates reporting periods data for past weeks
 * @param {number|Date} [offsetOrDate=-1] - If number: weeks offset. If Date: reference date
 * @param {Date} [referenceDate=new Date()] - Reference date (when first param is number)
 * @returns {Object} Object with weeks array and periodIdentifier
 */
export function generateReportingPeriods(refDate = new Date(), offsetWeeks = -1) {
  const refUTC = new Date(Date.UTC(
    refDate.getUTCFullYear(),
    refDate.getUTCMonth(),
    refDate.getUTCDate(),
  ));

  const dayOfWeek = refUTC.getUTCDay();
  /* c8 ignore next */
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(refUTC);
  weekStart.setUTCDate(refUTC.getUTCDate() - daysToMonday - (Math.abs(offsetWeeks) * 7));
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  const { week: weekNumber, year } = isoCalendarWeek(weekStart);

  const periodIdentifier = `w${String(weekNumber).padStart(2, '0')}-${year}`;

  return {
    weeks: [{
      startDate: weekStart, endDate: weekEnd, weekNumber, year, weekLabel: `Week ${weekNumber}`,
    }],
    periodIdentifier,
  };
}
/**
 * Atomically replaces site-scoped agentic URL classification rules via the
 * writer RPC. Reads continue to use native table endpoints.
 */
export async function replaceAgenticUrlClassificationRules({
  site,
  context,
  categoryRules = [],
  pageTypeRules = [],
  updatedBy = 'audit-worker:agentic-patterns',
}) {
  const siteId = site.getId();
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;

  if (!postgrestClient?.rpc) {
    throw new Error('PostgREST client is required to replace agentic URL classification rules');
  }

  const { data, error } = await postgrestClient.rpc(
    'wrpc_replace_agentic_url_classification_rules',
    {
      p_site_id: siteId,
      p_category_rules: categoryRules,
      p_page_type_rules: pageTypeRules,
      p_updated_by: updatedBy,
    },
  );

  if (error) {
    context?.log?.error?.(`Failed to replace agentic URL classification rules for site ${siteId}: ${error.message}`);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
}

/**
 * Fetches a site's top referral URL paths (by pageviews) from the data service.
 * The corpus for referral category-rule generation (LLMO-6257 P2) — the Postgres
 * analogue of the CDN top-URLs Athena query.
 */
export async function fetchReferralTopUrls({ site, context, limit = 200 }) {
  const siteId = site.getId();
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;

  if (!postgrestClient?.rpc) {
    throw new Error('PostgREST client is required to fetch referral top URLs');
  }

  const { data, error } = await postgrestClient.rpc(
    'rpc_referral_traffic_top_urls',
    {
      p_site_id: siteId,
      p_limit: limit,
    },
  );

  if (error) {
    context?.log?.error?.(`Failed to fetch referral top URLs for site ${siteId}: ${error.message}`);
    throw error;
  }

  return (Array.isArray(data) ? data : [])
    .map((row) => row?.url_path)
    .filter((path) => typeof path === 'string' && path.length > 0);
}
