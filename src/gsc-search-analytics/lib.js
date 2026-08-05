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

import GoogleClient from '@adobe/spacecat-shared-google-client';
import { computeWindows } from './windows.js';
import { fetchWindow } from './fetch.js';
import { indexRows, lookup } from './match.js';
import { buildDelta } from './summarize.js';

// Only a genuinely-absent GSC connection is an expected clean stop; anything
// else (throttling, IAM, parse errors) is a real failure we must surface.
const isNotConnected = (e) => /no secrets|not connected|no google|not onboarded/i.test(e.message || '');
const toDate = (s) => new Date(`${s}T00:00:00Z`);

/**
 * Tracking-only audit: for each URL ASO fixed, record its GSC clicks/impressions/
 * ctr/position for the 84 days before and after the URL's own fix date. No causal
 * claim — this is the "Measured" layer. Input is a manually-supplied list of
 * { url, fixType, fixDate } in auditContext.fixedUrls.
 *
 * @param {string} finalUrl - resolved site base URL.
 * @param {object} context - audit context ({ log, ... }).
 * @param {object} site - the site under audit.
 * @param {object} auditContext - carries fixedUrls (or messageData.fixedUrls).
 * @returns {Promise<{auditResult: object, fullAuditRef: string}>}
 */
export async function runGscSearchAnalytics(finalUrl, context, site, auditContext = {}) {
  const { log } = context;
  const fixedUrls = auditContext.fixedUrls ?? auditContext.messageData?.fixedUrls;
  if (!Array.isArray(fixedUrls) || fixedUrls.length === 0) {
    return { auditResult: { error: 'missing fixedUrls' }, fullAuditRef: finalUrl };
  }

  let google;
  try {
    google = await GoogleClient.createFrom(context, finalUrl);
  } catch (e) {
    if (isNotConnected(e)) {
      log.info(`GSC not connected for ${finalUrl}`);
      return { auditResult: { connected: false }, fullAuditRef: finalUrl };
    }
    throw e; // surface real infra/auth failures loudly
  }

  // Group fixes by fixDate so URLs sharing a date share one pair of pulls.
  const byDate = new Map();
  for (const f of fixedUrls) {
    if (!byDate.has(f.fixDate)) {
      byDate.set(f.fixDate, []);
    }
    byDate.get(f.fixDate).push(f);
  }

  const fixes = [];
  for (const [fixDate, group] of byDate) {
    try {
      const { before, after } = computeWindows(fixDate);
      /* eslint-disable no-await-in-loop */
      const [beforeRows, afterRows] = await Promise.all([
        fetchWindow(google, toDate(before.start), toDate(before.end)),
        fetchWindow(google, toDate(after.start), toDate(after.end)),
      ]);
      /* eslint-enable no-await-in-loop */
      const beforeMap = indexRows(beforeRows);
      const afterMap = indexRows(afterRows);
      for (const f of group) {
        const b = lookup(beforeMap, f.url);
        const a = lookup(afterMap, f.url);
        fixes.push({
          url: f.url,
          fixType: f.fixType,
          fixDate,
          windows: { before, after },
          before: b,
          after: a,
          delta: (b && a) ? buildDelta(b, a) : null,
          found: { before: !!b, after: !!a },
        });
      }
    } catch (e) {
      // A failure on one date-group must not wipe the others; leave a diagnostic entry.
      log.error(`GSC fetch failed for ${fixDate} / ${finalUrl}: ${e.message}`);
      for (const f of group) {
        fixes.push({
          url: f.url, fixType: f.fixType, fixDate, failed: true, error: e.message,
        });
      }
    }
  }

  return {
    auditResult: { connected: true, fixCount: fixes.length, fixes },
    fullAuditRef: finalUrl,
  };
}
