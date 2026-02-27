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

import { publishToAdminHlx } from '../utils/report-uploader.js';

const LLMO_ONBOARDING_PUBLISH_FILENAME = 'query-index';

function getLlmoDataFolder(site) {
  return site?.getConfig?.()?.getLlmoDataFolder?.() || null;
}

/**
 * LLMO Onboarding Publish Handler
 *
 * Publishes the query-index file to admin.hlx.page for sites with LLMO configuration.
 *
 * This handler intentionally skips publish (and does not queue downstream analysis) when:
 * - Site is not found: Nothing to publish, and no site data exists for analysis
 * - Missing LLMO config: Site hasn't been onboarded to LLMO, so nothing to publish or analyze
 *
 * This is correct behavior because a "publish" step has no meaningful work to do for
 * non-existent or non-configured sites, and queueing downstream analysis would be wasteful.
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { siteId } = message;

  if (!siteId) {
    log.error('[LLMO Onboarding Publish] Missing required field: siteId');
    return;
  }

  // Prefer context.site (already fetched by src/index.js middleware for all handlers)
  // Fall back to DB lookup only if not present (e.g., edge cases or direct invocation)
  const site = context.site ?? await dataAccess.Site.findById(siteId);

  if (!site) {
    // Intentional: skip publish AND don't queue downstream - nothing to do for non-existent site
    log.warn(`[LLMO Onboarding Publish] Site not found. Skipping publish for site ${siteId}`);
    return;
  }

  const currentDataFolder = getLlmoDataFolder(site);
  if (!currentDataFolder) {
    // Intentional: skip publish AND don't queue downstream - site not onboarded to LLMO
    log.warn(`[LLMO Onboarding Publish] Site ${siteId} has no LLMO data folder. Skipping.`);
    return;
  }

  // publishToAdminHlx already swallows/logs Helix errors by design.
  await publishToAdminHlx(LLMO_ONBOARDING_PUBLISH_FILENAME, currentDataFolder, log);
  log.info(`[LLMO Onboarding Publish] Publish attempt finished for site ${siteId}`);
}
