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
  loadExistingAudit,
  preserveOnDemand,
  preserveSlackContext,
  sendContinuationMessage,
} from './audit-utils.js';
import { handleAbort } from './bot-detection.js';
import {
  formatAuditCompletionMessage,
  formatBotProtectionPartialBlockMessage,
  formatStepCompletionMessage,
  say,
  sendAuditFailureNotification,
} from '../utils/slack-utils.js';
import { sendLowSuggestionCountAlert } from '../support/plg-suggestion-alert.js';

const { AUDIT_STEP_DESTINATION_CONFIGS } = AuditModel;
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

const PLG_AUDIT_TYPES = new Set([
  AuditModel.AUDIT_TYPES.CWV,
  AuditModel.AUDIT_TYPES.BROKEN_BACKLINKS,
  AuditModel.AUDIT_TYPES.ALT_TEXT,
]);

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

    const auditContext = {
      ...preserveOnDemand(context.auditContext),
      ...preserveSlackContext(context.auditContext),
      ...(isNonEmptyObject(stepResult.auditContext) ? stepResult.auditContext : {}),
      ...baseAuditContext,
    };

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
    let site;
    let siteUrl = siteId;

    try {
      site = await this.siteProvider(siteId, context);
      // Cache now so the catch block has it even if a later step throws
      try {
        siteUrl = site.getBaseURL();
      } catch { /* keep siteId fallback */ }
      // Preserve requiresValidation from index.js - siteProvider returns a fresh site
      if (context.site?.requiresValidation !== undefined) {
        site.requiresValidation = context.site.requiresValidation;
      }

      // Check if scrape job was aborted
      // Skip abort info validation if jobId was not created by SCRAPE_CLIENT
      // (i.e., if jobId === siteId, it's from CONTENT_SCRAPER
      // which does not create jobId in DynamoDB)
      const isJobIdFromScrapeClient = jobId && jobId !== siteId;

      if (abort && isJobIdFromScrapeClient) {
        const { blockedUrlsCount, totalUrlsCount, blockedUrls } = abort.details || {};
        // Only proceed if we have a valid total count (needed for arithmetic and comparison)
        // If abortInfo exists, blockedUrlsCount should be >= 1 (at least one URL was blocked)
        if (totalUrlsCount > 0) {
          // Only abort if ALL URLs are blocked
          if (blockedUrlsCount === totalUrlsCount) {
            log.warn(
              `[BOT-BLOCKED] All URLs blocked (${blockedUrlsCount}/${totalUrlsCount}), aborting audit for jobId=${jobId}`,
            );
            // Pass the live context reference so the dedup marker
            // (context.slackFailureNotifiedAt) lands on the shared object.
            // Mutate auditContext on it rather than spreading a throwaway copy.
            context.auditContext = auditContext;
            return handleAbort(abort, jobId, type, site, siteId, context);
          }
          // Some URLs blocked but not all - continue audit processing
          // blockedUrlsCount should be >= 1 if abortInfo exists, but check for safety
          if (blockedUrlsCount > 0) {
            const blockedUrlsList = blockedUrls?.map((u) => (typeof u === 'string' ? u : u.url)).filter(Boolean).join(', ') || 'none';
            const nonBlockedCount = totalUrlsCount - blockedUrlsCount;
            log.info(
              `[BOT-BLOCKED] Some URLs blocked (${blockedUrlsCount}/${totalUrlsCount}), `
              + `but continuing audit processing for ${type} audit on ${site.getBaseURL()} `
              + `as ${nonBlockedCount} URLs were not blocked by bot protection, jobId=${jobId}, `
              + `Blocked URLs: [${blockedUrlsList}]`,
            );
            // Notify the originating Slack thread that the audit is continuing
            // despite a partial bot-protection block. No-op when not triggered
            // from Slack.
            await say(
              context,
              auditContext?.slackContext,
              formatBotProtectionPartialBlockMessage({
                auditType: type,
                siteUrl,
                // abort.details is guaranteed truthy here — destructuring above
                // produced a positive totalUrlsCount, so it must have unwrapped
                // a real object.
                details: abort.details,
              }),
            );
          }
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
        // Per-step progress update on the audit thread. Last step is
        // intentionally NOT covered here — its success surfaces via the
        // overall "Audit Completed" message below.
        await say(
          context,
          auditContext?.slackContext,
          formatStepCompletionMessage(stepName),
        );
      } else {
        // Last step done — overall audit pipeline completed end-to-end.
        await say(
          context,
          auditContext?.slackContext,
          formatAuditCompletionMessage(),
        );
      }

      return response;
    } catch (e) {
      // Enhance error message with more context
      const errorMessage = `${type} audit failed for site ${siteId} at step ${auditContext.next || 'initial'}. Reason: ${e.message}`;
      log.error(errorMessage, { error: e });

      // Slack notification to the originating thread (deduped via context.slackFailureNotifiedAt).
      await sendAuditFailureNotification(context, {
        type,
        siteUrl,
        auditContext,
        error: e,
      });

      // PLG low-suggestion-count alert for opted-in audit types.
      if (site && PLG_AUDIT_TYPES.has(type)) {
        await sendLowSuggestionCountAlert(site, type, 0, context, errorMessage);
      }

      throw new Error(errorMessage, { cause: e });
    }
  }
}
