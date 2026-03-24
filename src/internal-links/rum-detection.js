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
import { getInternalLinksFetchConfig } from './base-url.js';

const RUM_VALIDATION_CONCURRENCY = 10;

function stripAbsoluteUrlHash(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return url;
  }
}

async function mapSettledInBatches(items, batchSize, mapper) {
  const settledResults = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.allSettled(batch.map((item) => mapper(item)));
    settledResults.push(...batchResults);
  }

  return settledResults;
}

export function createInternalLinksRumSteps({
  auditType,
  interval,
  createContextLogger,
  createConfigResolver = () => ({ isLinkCheckerEnabled: () => false }),
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
      step: 'rum-detector-phase',
    });
    const finalUrl = context?.finalUrl || await resolveFinalUrl(site, context);
    const siteBaseURL = site.getBaseURL();
    const { overrideBaseURL } = getInternalLinksFetchConfig(site);

    log.info('====== RUM Detection Phase started ======');
    log.info(`RUM resolver v2: siteBaseURL=${siteBaseURL}, overrideBaseURL=${overrideBaseURL || 'none'}, resolvedRumDomain=${finalUrl}`);
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

      const baseURL = siteBaseURL;
      const scopedInternal404Links = internal404Links.filter((link) => (
        isWithinAuditScope(link.url_from, baseURL)
        && isWithinAuditScope(link.url_to, baseURL)
      ));
      if (scopedInternal404Links.length < internal404Links.length) {
        log.info(`Filtered out ${internal404Links.length - scopedInternal404Links.length} RUM links outside the audit scope before validation`);
      }

      log.info(`Validating ${scopedInternal404Links.length} scoped links (target + referring page)...`);

      const accessibilitySettled = await mapSettledInBatches(
        scopedInternal404Links,
        RUM_VALIDATION_CONCURRENCY,
        async (link) => {
          const [targetSettled, referringSettled] = await Promise.allSettled([
            isLinkInaccessible(link.url_to, log, site.getId(), auditId),
            isLinkInaccessible(link.url_from, log, site.getId(), auditId),
          ]);

          if (targetSettled.status === 'rejected') {
            throw targetSettled.reason;
          }

          const validation = targetSettled.value;
          const referringPageInaccessible = referringSettled.status === 'fulfilled'
            && referringSettled.value.isBroken === true;

          return {
            link,
            validation,
            inaccessible: validation.isBroken,
            inconclusive: validation.inconclusive === true,
            referringPageInaccessible,
          };
        },
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
      const inconclusive = accessibilityResults.filter((r) => r.inconclusive).length;
      const nowFixed = accessibilityResults
        .filter((r) => !r.inaccessible && !r.inconclusive)
        .length;
      const excludedReferring404 = accessibilityResults
        .filter((r) => r.inaccessible && r.referringPageInaccessible)
        .length;
      const failed = accessibilitySettled.filter((r) => r.status === 'rejected').length;
      const summary = `Validation results: ${stillBroken} still broken, ${nowFixed} now fixed`;
      log.info(
        `${summary}${inconclusive > 0 ? `, ${inconclusive} inconclusive` : ''}${excludedReferring404 > 0 ? `, ${excludedReferring404} excluded (referring page broken)` : ''}${failed > 0 ? `, ${failed} failed` : ''}`,
      );

      const inaccessibleLinks = accessibilityResults
        .filter((result) => result.inaccessible && !result.referringPageInaccessible)
        .map((result) => ({
          urlFrom: stripAbsoluteUrlHash(result.link.url_from),
          urlTo: stripAbsoluteUrlHash(result.link.url_to),
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
      site, log: baseLog, finalUrl, audit, env,
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
      const { error: rumError } = internalLinksAuditRunnerResult.auditResult;
      const config = createConfigResolver(site, env);
      if (config.isLinkCheckerEnabled()) {
        log.warn(`RUM detection audit failed, continuing with LinkChecker enabled: ${rumError}`);
        return {
          auditResult: {
            ...internalLinksAuditRunnerResult.auditResult,
            brokenInternalLinks: [],
            success: true,
            auditContext: {
              interval,
              rumError,
            },
          },
          fullAuditRef: finalUrl,
          type: 'top-pages',
          siteId: site.getId(),
        };
      }

      log.error(`RUM detection audit failed: ${rumError}`);
      throw new Error(rumError);
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
