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
import { ok } from '@adobe/spacecat-shared-http-utils';
import { hasText, isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { BaseAudit } from './base-audit.js';
import {
  isAuditEnabledForSite,
  loadExistingAudit,
  sendContinuationMessage,
} from './audit-utils.js';

const { AUDIT_STEP_DESTINATION_CONFIGS } = AuditModel;

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
    const auditContext = {
      next: nextStepName,
      auditId: audit.getId(),
      auditType: audit.getAuditType(),
      fullAuditRef: audit.getFullAuditRef(),
    };

    const queueUrl = destination.getQueueUrl(context);
    const payload = destination.formatPayload(stepResult, auditContext);
    await sendContinuationMessage({ queueUrl, payload }, context);

    log.info(`Step ${step.name} completed for audit ${audit.getId()} of type ${this.type}, message sent to ${step.destination}`);

    return stepResult;
  }

  async run(message, context) {
    const { stepNames } = this;
    const { log } = context;
    const { type, auditContext = {} } = message;

    const siteId = message.siteId || message.config.siteId;

    log.info(`[broken-internal-links] [${type}]-1  in step run >> ~ message:`, message);
    log.info(`[broken-internal-links] [${type}]-1  [Site Id: ${siteId}] in step run >> ~ auditContext:`, auditContext);

    try {
      const site = await this.siteProvider(siteId, context);

      if (!(await isAuditEnabledForSite(type, site, context))) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        return ok();
      }

      // Determine which step to run
      const hasNext = hasText(auditContext.next);
      const stepName = auditContext.next || stepNames[0];
      const isLastStep = stepName === stepNames[stepNames.length - 1];
      const step = this.getStep(stepName);
      const stepContext = { ...context, site };

      // For subsequent steps, load existing audit
      if (hasNext) {
        stepContext.audit = await loadExistingAudit(auditContext.auditId, context);
      } else {
        // For first step, resolve URL
        stepContext.finalUrl = await this.urlResolver(site, context);
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
