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

import { createInternalLinksConfigResolver } from './config.js';
import { createInternalLinksStepLogger } from './logging.js';
import { getMergedAuditInputUrls } from '../utils/audit-input-urls.js';

export function createSubmitForScraping({
  auditType,
  createContextLogger,
  isWithinAuditScope,
}) {
  return async function submitForScraping(context) {
    const {
      site, dataAccess, log: baseLog, audit, env,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId: audit.getId(),
      step: 'submit-for-scraping',
    });

    const { success } = audit.getAuditResult();

    if (!success) {
      log.error('Audit failed, skip scraping and suggestion generation');
      throw new Error('Audit failed, skip scraping and suggestion generation');
    }

    log.info('====== Step 2: Submit For Scraping ======');

    const { urls: mergedUrls } = await getMergedAuditInputUrls({
      site,
      dataAccess,
      auditType: 'broken-internal-links',
      getAgenticUrls: () => Promise.resolve([]),
      getTopPages: async () => {
        try {
          const { SiteTopPage } = dataAccess;
          return await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');
        } catch (error) {
          log.warn(`Failed to fetch SEO top pages from database: ${error.message}`);
          return [];
        }
      },
      log,
    });
    log.info(`Found ${mergedUrls.length} URLs after merging all sources`);
    const maxUrlsToProcess = config.getMaxUrlsToProcess();

    let finalUrls = mergedUrls;

    const baseURL = site.getBaseURL();
    finalUrls = finalUrls.filter((url) => isWithinAuditScope(url, baseURL));
    log.info(`After audit scope filtering: ${finalUrls.length} URLs`);

    if (finalUrls.length > maxUrlsToProcess) {
      log.warn(`Capping URLs from ${finalUrls.length} to ${maxUrlsToProcess}`);
      finalUrls = finalUrls.slice(0, maxUrlsToProcess);
    }

    if (finalUrls.length === 0) {
      log.warn('No URLs available for scraping');
      log.info('==========================================');
      return {
        auditResult: audit.getAuditResult(),
        fullAuditRef: audit.getFullAuditRef(),
        urls: [],
        siteId: site.getId(),
        type: 'broken-internal-links',
      };
    }

    log.info(`Submitting ${finalUrls.length} URLs for scraping (cache enabled)`);
    log.info('==========================================');

    return {
      auditResult: audit.getAuditResult(),
      fullAuditRef: audit.getFullAuditRef(),
      urls: finalUrls.map((url) => ({ url })),
      siteId: site.getId(),
      type: 'broken-internal-links',
      processingType: 'default',
      options: config.getScraperOptions(),
    };
  };
}
