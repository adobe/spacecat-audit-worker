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

import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { ok } from '@adobe/spacecat-shared-http-utils';
import { hasText, isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { BaseAudit } from './base-audit.js';
import {
  isAuditEnabledForSite,
  loadExistingAudit,
  sendContinuationMessage,
} from './audit-utils.js';

const { AUDIT_STEP_DESTINATION_CONFIGS } = AuditModel;
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

export class StepAudit extends BaseAudit {
  constructor(
    siteProvider,
    orgProvider,
    urlResolver,
    persister,
    messageSender,
    postProcessors,
    steps = {},
  ) {
    super(siteProvider, orgProvider, urlResolver, persister, messageSender, postProcessors);

    Object.freeze(this.steps = steps);
    Object.freeze(this.stepNames = Object.keys(steps));
  }

  getStep(name) {
    const step = this.steps[name];
    if (!isNonEmptyObject(step)) {
      throw new Error(`Step ${name} not found for audit ${this.type}`);
    }

    return step;
  }

  getNextStepName(currentStepName) {
    const currentIndex = this.stepNames.indexOf(currentStepName);
    return currentIndex < this.stepNames.length - 1 ? this.stepNames[currentIndex + 1] : null;
  }

  /**
   * Handles abort signals from upstream services (e.g., bot protection from content scraper).
   * Logs detailed information for bot protection aborts and returns an appropriate response.
   * @private
   * @param {Object} abort - Abort signal with reason and details
   * @param {string} jobId - Job identifier
   * @param {string} type - Audit type
   * @param {Object} site - Site object
   * @param {string} siteId - Site identifier
   * @param {Object} log - Logger instance
   * @returns {Object} HTTP response indicating audit was skipped
   */
  static handleAbort(abort, jobId, type, site, siteId, log) {
    const { reason, details } = abort;

    /* c8 ignore start */
    // Log abort structure for debugging
    log.info(
      `[AUDIT-DEBUG] Processing abort signal: jobId=${jobId}, type=${type}, siteId=${siteId}, `
      + `reason=${reason}, hasDetails=${!!details}, detailsKeys=${details ? Object.keys(details).join(',') : 'none'}`,
    );
    /* c8 ignore stop */

    if (reason === 'bot-protection') {
      const {
        blockedUrlsCount, totalUrlsCount, byBlockerType, byHttpStatus, blockedUrls,
      } = details || {};

      /* c8 ignore start */
      // Validate bot protection details structure
      if (!details) {
        log.error(
          `[AUDIT-ERROR] Bot protection abort missing details: jobId=${jobId}, type=${type}, siteId=${siteId}`,
        );
      } else if (blockedUrlsCount === undefined || totalUrlsCount === undefined) {
        log.warn(
          `[AUDIT-WARNING] Bot protection abort has incomplete details: jobId=${jobId}, `
          + `hasBlockedUrlsCount=${blockedUrlsCount !== undefined}, hasTotalUrlsCount=${totalUrlsCount !== undefined}`,
        );
      }
      /* c8 ignore stop */

      const statusDetails = Object.entries(byHttpStatus || {})
        .map(([status, count]) => `${status}: ${count}`)
        .join(', ');
      const blockerDetails = Object.entries(byBlockerType || {})
        .map(([blockerType, count]) => `${blockerType}: ${count}`)
        .join(', ');

      log.warn(
        `[BOT-BLOCKED] Audit aborted for jobId=${jobId}, type=${type}, site=${site.getBaseURL()} (${siteId}): `
        + `HTTP Status: [${statusDetails}], Blocker Types: [${blockerDetails}], `
        + `${blockedUrlsCount}/${totalUrlsCount} URLs blocked, `
        + `Bot Protected URLs: [${blockedUrls?.map((u) => u.url).join(', ') || 'none'}]`,
      );
    } else {
      /* c8 ignore start */
      // Log non-bot-protection abort reasons
      log.warn(
        `[AUDIT-ABORT] Audit aborted for non-bot-protection reason: jobId=${jobId}, `
        + `type=${type}, siteId=${siteId}, reason=${reason}`,
      );
      /* c8 ignore stop */
    }

    /* c8 ignore start */
    log.info(
      `[AUDIT-DEBUG] Abort handled successfully: jobId=${jobId}, type=${type}, siteId=${siteId}, `
      + `skipped=true, reason=${reason}`,
    );
    /* c8 ignore stop */

    // Return generic abort response
    return ok({
      skipped: true,
      reason,
      ...details,
    });
  }

  async chainStep(step, stepResult, context) {
    const { audit, log } = context;

    if (!hasText(step?.destination)) {
      throw new Error('Invalid step configuration: missing destination');
    }

    const destination = AUDIT_STEP_DESTINATION_CONFIGS[step.destination];
    if (!isNonEmptyObject(destination)) {
      throw new Error(`Invalid destination configuration for step ${step.name}`);
    }

    const nextStepName = this.getNextStepName(step.name);

    const baseAuditContext = {
      next: nextStepName,
      auditId: audit.getId(),
      auditType: audit.getAuditType(),
      fullAuditRef: audit.getFullAuditRef(),
    };

    const auditContext = isNonEmptyObject(stepResult.auditContext)
      ? { ...stepResult.auditContext, ...baseAuditContext }
      : baseAuditContext;

    if (step.destination === AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT) {
      const scrapeClient = ScrapeClient.createFrom(context);
      const payload = destination.formatPayload(stepResult, auditContext, context);
      log.debug(`Creating new scrapeJob with the ScrapeClient. Payload: ${JSON.stringify(payload)}`);
      const scrapeJob = await scrapeClient.createScrapeJob(payload);
      log.info(`Created scrapeJob with id: ${scrapeJob.id}`);
      return stepResult;
    } else {
      const queueUrl = destination.getQueueUrl(context);
      const payload = destination.formatPayload(stepResult, auditContext, context);
      await sendContinuationMessage({ queueUrl, payload }, context);
    }

    log.debug(`Step ${step.name} completed for audit ${audit.getId()} of type ${audit.getAuditType()}, message sent to ${step.destination}`);

    return stepResult;
  }

  async run(message, context) {
    const { stepNames } = this;
    const { log } = context;
    const {
      type, data, siteId, auditContext = {}, abort, jobId,
    } = message;

    /* c8 ignore start */
    // Debug: Log received message structure
    log.info(`[DEBUG-AUDIT-RECEIVED] type=${type}, siteId=${siteId}, jobId=${jobId || 'none'}, hasAbort=${!!abort}, abortReason=${abort?.reason || 'none'}, messageKeys=${Object.keys(message).join(',')}`);
    /* c8 ignore stop */

    try {
      const site = await this.siteProvider(siteId, context);

      if (!(await isAuditEnabledForSite(type, site, context))) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        return ok();
      }

      // Check if scrape job was aborted (e.g., due to bot protection)
      if (abort) {
        /* c8 ignore start */
        log.info(
          `[AUDIT-DEBUG] Abort detected in message: jobId=${jobId}, type=${type}, `
          + `siteId=${siteId}, reason=${abort.reason}, `
          + `hasDetails=${!!abort.details}, detailsBlockedCount=${abort.details?.blockedUrlsCount || 0}`,
        );
        /* c8 ignore stop */

        try {
          const result = StepAudit.handleAbort(abort, jobId, type, site, siteId, log);
          /* c8 ignore start */
          log.info(
            `[AUDIT-DEBUG] Abort handled and audit skipped: jobId=${jobId}, type=${type}, `
            + `siteId=${siteId}, resultSkipped=${result.body?.skipped}`,
          );
          /* c8 ignore stop */
          return result;
        } catch (error) {
          /* c8 ignore start */
          log.error(
            `[AUDIT-ERROR] Failed to handle abort: jobId=${jobId}, type=${type}, `
            + `siteId=${siteId}, error=${error.message}`,
            error,
          );
          /* c8 ignore stop */
          throw error;
        }
      }

      // Determine which step to run
      const hasNext = hasText(auditContext.next);
      const hasScrapeJobId = hasText(auditContext.scrapeJobId);
      const stepName = auditContext.next || stepNames[0];
      const isLastStep = stepName === stepNames[stepNames.length - 1];
      const step = this.getStep(stepName);
      const stepContext = {
        ...context,
        auditContext,
        data,
        site,
      };

      stepContext.finalUrl = await this.urlResolver(site, context);

      // For subsequent steps, load existing audit
      if (hasNext) {
        stepContext.audit = await loadExistingAudit(auditContext.auditId, context);
      }

      // If there are scrape results, load the paths
      if (hasScrapeJobId) {
        stepContext.scrapeJobId = auditContext.scrapeJobId;
        const scrapeClient = ScrapeClient.createFrom(context);
        stepContext.scrapeResultPaths = await scrapeClient
          .getScrapeResultPaths(auditContext.scrapeJobId);
      }

      // Run the step
      const stepResult = await step.handler(stepContext);
      let response = ok();

      if (!hasNext) {
        response = await this.processAuditResult(
          stepResult,
          {
            type,
            site,
            finalUrl: stepContext.finalUrl,
            context,
          },
          stepContext,
        );
      }

      if (!isLastStep) {
        const result = await this.chainStep(step, stepResult, stepContext);
        response = ok(result);
      }

      return response;
    } catch (e) {
      // Enhance error message with more context
      const errorMessage = `${type} audit failed for site ${siteId} at step ${auditContext.next || 'initial'}. Reason: ${e.message}`;
      log.error(errorMessage, { error: e });
      throw new Error(errorMessage, { cause: e });
    }
  }
}
