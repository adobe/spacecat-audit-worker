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

import { isNonEmptyObject, isValidUUID } from '@adobe/spacecat-shared-utils';
import { AsyncJob, Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { ok } from '@adobe/spacecat-shared-http-utils';
import { StepAudit } from './step-audit.js';
import { sendContinuationMessage, isAuditEnabledForSite } from './audit-utils.js';

const { AUDIT_STEP_DESTINATION_CONFIGS } = AuditModel;

export class AsyncJobRunner extends StepAudit {
  constructor(
    jobProvider,
    siteProvider,
    orgProvider,
    urlResolver,
    persister,
    messageSender,
    postProcessors,
    steps = {},
  ) {
    super(siteProvider, orgProvider, urlResolver, persister, messageSender, postProcessors, steps);

    this.jobProvider = jobProvider;
  }

  async chainStep(step, stepResult, context) {
    const {
      type, job, urls, log, promiseToken,
    } = context;

    const destination = AUDIT_STEP_DESTINATION_CONFIGS[step.destination];
    const nextStepName = this.getNextStepName(step.name);
    const auditContext = {
      next: nextStepName,
      jobId: job.getId(),
      auditType: type,
      urls,
      ...(promiseToken ? { promiseToken } : {}),
    };

    const queueUrl = destination.getQueueUrl(context);
    const payload = destination.formatPayload(stepResult, auditContext, context);
    await sendContinuationMessage({ queueUrl, payload }, context);

    log.debug(`Step ${step.name} completed for job ${job.getId()} of type ${type}, message sent to ${step.destination}`);

    return stepResult;
  }

  async run(message, context) {
    const { stepNames } = this;
    const { log } = context;
    const {
      type, jobId, auditContext = {},
    } = message;
    try {
      const job = await this.jobProvider(auditContext.jobId || jobId, context);

      const jobMetadata = job.getMetadata();
      if (!isNonEmptyObject(jobMetadata)) {
        const error = `Job ${jobId} metadata is not an object`;
        log.error(error);
        throw new Error(error);
      }
      const { siteId } = jobMetadata.payload;
      if (!isValidUUID(siteId)) {
        const error = `Job ${jobId} has invalid siteId ${siteId}`;
        log.error(error);
        throw new Error(error);
      }

      const site = await this.siteProvider(siteId, context);

      if (!(await isAuditEnabledForSite(type, site, context))) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        job.setStatus(AsyncJob.Status.CANCELLED);
        job.setMetadata({
          payload: {
            siteId,
            reason: `${type} audits disabled for site ${siteId}`,
          },
        });
        await job.save();
        return ok();
      }

      const stepName = auditContext.next || stepNames[0];
      const isLastStep = stepName === stepNames[stepNames.length - 1];
      const step = this.getStep(stepName);
      const updatedStepContext = {
        ...context, site, job, type,
      };

      updatedStepContext.finalUrl = await this.urlResolver(site, context);
      const promiseToken = message.promiseToken || message.auditContext?.promiseToken;
      if (promiseToken) {
        updatedStepContext.promiseToken = promiseToken;
        log.debug(`site: ${siteId}. Promise token added to step context`);
      }

      const stepResult = await step.handler(updatedStepContext);
      let response = ok();

      if (!isLastStep) {
        const result = await this.chainStep(step, stepResult, updatedStepContext);
        response = ok(result);
      }

      return response;
    } catch (e) {
      const errorMessage = `${type} audit failed for job ${jobId} at step ${auditContext.next || 'initial'}. Reason: ${e.message}`;
      log.error(errorMessage, { error: e });
      throw new Error(errorMessage, { cause: e });
    }
  }
}
