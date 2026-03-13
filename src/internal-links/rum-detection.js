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

import { createInternalLinksStepLogger } from './logging.js';

export function createInternalLinksRumSteps({
  auditType,
  interval,
  createContextLogger,
  createRUMAPIClient,
  resolveFinalUrl,
  isLinkInaccessible,
  calculatePriority,
  isWithinAuditScope,
}) {
  async function internalLinksAuditRunner(auditUrl, context) {
    const { log: baseLog, site, audit } = context;
    /* c8 ignore next - defensive logger context when audit is absent or incomplete */
    const auditId = audit && typeof audit.getId === 'function' ? audit.getId() : undefined;
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'rum-detection',
    });
    const finalUrl = context?.finalUrl || await resolveFinalUrl(site, context);

    log.info('====== RUM Detection Phase ======');
    log.info(`Site: ${site.getId()}, Domain: ${finalUrl}`);

    try {
      const rumAPIClient = context.rumApiClient || createRUMAPIClient(context);
      const options = {
        domain: finalUrl,
        interval,
        granularity: 'hourly',
      };

      log.info(`Querying RUM API for 404 internal links (interval: ${interval} days)`);

      const internal404Links = await rumAPIClient.query('404-internal-links', options);
      log.info(`Found ${internal404Links.length} 404 internal links from RUM data`);

      if (internal404Links.length === 0) {
        log.info('No 404 internal links found in RUM data');
        log.info('================================');
        return {
          auditResult: {
            brokenInternalLinks: [],
            fullAuditRef: auditUrl,
            finalUrl,
            auditContext: { interval },
            success: true,
          },
          fullAuditRef: auditUrl,
        };
      }

      log.info(`Validating ${internal404Links.length} links to confirm they are still broken...`);

      const accessibilitySettled = await Promise.allSettled(
        internal404Links.map(async (link) => {
          const validation = await isLinkInaccessible(link.url_to, log, site.getId(), auditId);
          return {
            link,
            validation,
            inaccessible: validation.isBroken,
          };
        }),
      );

      const accessibilityResults = accessibilitySettled
        .filter((result) => {
          if (result.status === 'rejected') {
            log.error(`Link validation failed: ${result.reason}`);
            return false;
          }
          return true;
        })
        .map((result) => result.value);

      const stillBroken = accessibilityResults.filter((r) => r.inaccessible).length;
      const nowFixed = accessibilityResults.filter((r) => !r.inaccessible).length;
      const failed = accessibilitySettled.filter((r) => r.status === 'rejected').length;
      log.info(`Validation results: ${stillBroken} still broken, ${nowFixed} now fixed${failed > 0 ? `, ${failed} failed` : ''}`);

      const baseURL = site.getBaseURL();
      const inaccessibleLinks = accessibilityResults
        .filter((result) => result.inaccessible)
        .filter((result) => (
          isWithinAuditScope(result.link.url_from, baseURL)
          && isWithinAuditScope(result.link.url_to, baseURL)
        ))
        .map((result) => ({
          urlFrom: result.link.url_from,
          urlTo: result.link.url_to,
          trafficDomain: result.link.traffic_domain,
          detectionSource: 'rum',
          httpStatus: result.validation.httpStatus,
          statusBucket: result.validation.statusBucket,
          contentType: result.validation.contentType,
        }));

      const totalTraffic = inaccessibleLinks.reduce((sum, link) => sum + link.trafficDomain, 0);
      log.info(`RUM detection complete: ${inaccessibleLinks.length} broken links (total traffic: ${totalTraffic} views)`);
      log.info('================================');

      const prioritizedLinks = calculatePriority(inaccessibleLinks);

      return {
        auditResult: {
          brokenInternalLinks: prioritizedLinks,
          fullAuditRef: auditUrl,
          finalUrl,
          auditContext: { interval },
          success: true,
        },
        fullAuditRef: auditUrl,
      };
    } catch (error) {
      log.error(`audit failed with error: ${error.message}`, error);
      return {
        fullAuditRef: auditUrl,
        auditResult: {
          finalUrl: auditUrl,
          error: `audit failed with error: ${error.message}`,
          success: false,
        },
      };
    }
  }

  async function runAuditAndImportTopPagesStep(context) {
    const {
      site, log: baseLog, finalUrl, audit,
    } = context;
    /* c8 ignore next - defensive logger context when audit is absent or incomplete */
    const auditId = audit && typeof audit.getId === 'function' ? audit.getId() : undefined;
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'run-audit-and-import-top-pages',
    });

    log.info('====== Step 1: RUM Detection + Import Top Pages ======');
    log.debug('Starting RUM detection audit');

    const internalLinksAuditRunnerResult = await internalLinksAuditRunner(
      finalUrl,
      context,
    );

    const { success } = internalLinksAuditRunnerResult.auditResult;

    if (!success) {
      log.error('RUM detection audit failed');
      throw new Error('Audit failed, skip scraping and suggestion generation');
    }

    log.info(`RUM detection complete. Found ${internalLinksAuditRunnerResult.auditResult.brokenInternalLinks?.length || 0} broken links`);
    log.info('Triggering import worker to fetch Ahrefs top pages');
    log.info('=====================================================');

    return {
      auditResult: internalLinksAuditRunnerResult.auditResult,
      fullAuditRef: finalUrl,
      type: 'top-pages',
      siteId: site.getId(),
    };
  }

  return {
    internalLinksAuditRunner,
    runAuditAndImportTopPagesStep,
  };
}
