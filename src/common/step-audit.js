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
      scrapeJobId: context.scrapeJobId,
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
      type, data, siteId, auditContext = {},
    } = message;

    try {
      const site = await this.siteProvider(siteId, context);

      if (!(await isAuditEnabledForSite(type, site, context))) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        return ok();
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

        // Check for bot protection by querying CloudWatch logs
        // Content scraper logs bot protection events, making CloudWatch the source of truth
        const { queryBotProtectionLogs } = await import('../utils/cloudwatch-utils.js');

        const auditCreatedAt = new Date(stepContext.audit.getAuditedAt()).getTime();

        const logEvents = await queryBotProtectionLogs(
          auditContext.scrapeJobId,
          context,
          auditCreatedAt,
        );

        if (logEvents.length > 0) {
          const scrapeUrlResults = await scrapeClient
            .getScrapeJobUrlResults(auditContext.scrapeJobId);

          const totalUrlsCount = scrapeUrlResults.length;
          const botProtectedUrls = logEvents.map((event) => ({
            url: event.url,
            blockerType: event.blockerType,
            httpStatus: event.httpStatus,
            confidence: event.confidence,
          }));

          // Aggregate bot protection statistics
          const stats = {
            totalCount: logEvents.length,
            byHttpStatus: {},
            byBlockerType: {},
          };

          for (const event of logEvents) {
            const status = event.httpStatus || 'unknown';
            const blockerType = event.blockerType || 'unknown';
            stats.byHttpStatus[status] = (stats.byHttpStatus[status] || 0) + 1;
            stats.byBlockerType[blockerType] = (stats.byBlockerType[blockerType] || 0) + 1;
          }

          // Format detailed log message with HTTP status counts
          const statusDetails = Object.entries(stats.byHttpStatus)
            .map(([status, count]) => `${status}: ${count}`)
            .join(', ');
          const blockerDetails = Object.entries(stats.byBlockerType)
            .map(([blockerType, count]) => `${blockerType}: ${count}`)
            .join(', ');

          log.warn(
            `${type} audit for site ${siteId} aborted: bot protection detected for `
            + `${botProtectedUrls.length}/${totalUrlsCount} URLs. `
            + `HTTP Status Counts: [${statusDetails}]. `
            + `Blocker Types: [${blockerDetails}]. `
            + 'Audit cannot proceed due to bot protection blocking access to site content.',
          );

          return ok({
            skipped: true,
            reason: 'bot-protection-detected',
            botProtectedUrlsCount: botProtectedUrls.length,
            totalUrlsCount,
            botProtectedUrls,
            stats,
          });
        }
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
