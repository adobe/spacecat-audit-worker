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

import { hasText, isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { ok } from '@adobe/spacecat-shared-http-utils';
import { StepAudit } from './step-audit.js';
import { sendContinuationMessage, isAuditEnabledForSite } from './audit-utils.js';

const { AUDIT_STEP_DESTINATION_CONFIGS } = AuditModel;

export class AsyncJobRunner extends StepAudit {
  constructor(
    siteProvider,
    orgProvider,
    urlResolver,
    persister,
    messageSender,
    postProcessors,
    steps = {},
  ) {
    super(siteProvider, orgProvider, urlResolver, persister, messageSender, postProcessors, steps);
  }

  async chainStep(step, stepResult, context) {
    const {
      jobId, type, urls, log,
    } = context;

    if (!hasText(step?.destination)) {
      throw new Error('Invalid step configuration: missing destination');
    }

    const destination = AUDIT_STEP_DESTINATION_CONFIGS[step.destination];
    if (!isNonEmptyObject(destination)) {
      throw new Error(`Invalid destination configuration for step ${step.name}`);
    }

    const nextStepName = this.getNextStepName(step.name);

    const stepContext = {
      next: nextStepName,
      jobId,
      type,
      urls,
    };

    const queueUrl = destination.getQueueUrl(context);
    const payload = destination.formatPayload(stepResult, stepContext, context);
    await sendContinuationMessage({ queueUrl, payload }, context);

    log.info(`Step ${step.name} completed for job ${jobId} of type ${type}, message sent to ${step.destination}`);

    return stepResult;
  }

  async run(message, context) {
    const { stepNames } = this;
    const { log } = context;
    const {
      type, siteId, urls, jobId, stepContext = {},
    } = message;

    try {
      const site = await this.siteProvider(siteId, context);

      if (!(await isAuditEnabledForSite(type, site, context))) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        return ok();
      }

      const stepName = stepContext.next || stepNames[0];
      const isLastStep = stepName === stepNames[stepNames.length - 1];
      const step = this.getStep(stepName);
      const updatedStepContext = {
        ...context, site, urls, jobId,
      };

      updatedStepContext.finalUrl = await this.urlResolver(site, context);

      const stepResult = await step.handler(updatedStepContext);
      let response = ok();

      if (!isLastStep) {
        const result = await this.chainStep(step, stepResult, updatedStepContext);
        response = ok(result);
      }

      return response;
    } catch (e) {
      const errorMessage = `${type} audit failed for site ${siteId} at step ${stepContext.next || 'initial'}. Reason: ${e.message}`;
      log.error(errorMessage, { error: e });
      throw new Error(errorMessage, { cause: e });
    }
  }
}
