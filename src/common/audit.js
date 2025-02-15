/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { ok } from '@adobe/spacecat-shared-http-utils';
import {
  composeAuditURL,
  hasText,
  isNonEmptyObject,
  isValidUUID,
} from '@adobe/spacecat-shared-utils';
import URI from 'urijs';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';

import { retrieveAuditById, retrieveSiteBySiteId } from '../utils/data-access.js';

// eslint-disable-next-line no-empty-function
export async function defaultMessageSender() {}

export async function defaultPersister(auditData, context) {
  const { dataAccess } = context;
  const { Audit } = dataAccess;

  return Audit.create(auditData);
}

export async function noopPersister(auditData) {
  return { getId: () => auditData.id || 'noop' };
}

export async function defaultSiteProvider(siteId, context) {
  const { log, dataAccess } = context;

  const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
  if (!site) {
    throw new Error(`Site with id ${siteId} not found`);
  }

  return site;
}

export async function defaultOrgProvider(orgId, context) {
  const { dataAccess } = context;
  const { Organization } = dataAccess;

  const org = await Organization.findById(orgId);
  if (!org) {
    throw new Error(`Org with id ${orgId} not found`);
  }

  return org;
}

export async function defaultUrlResolver(site) {
  return composeAuditURL(site.getBaseURL());
}

export function wwwUrlResolver(site) {
  const baseURL = site.getBaseURL();
  const uri = new URI(baseURL);
  return hasText(uri.subdomain()) ? baseURL.replace(/https?:\/\//, '') : baseURL.replace(/https?:\/\//, 'www.');
}

export async function noopUrlResolver(site) {
  return site.getBaseURL();
}

export const defaultPostProcessors = [];

const { AUDIT_STEP_DESTINATION_CONFIGS } = AuditModel;

async function isAuditEnabledForSite(type, site, context) {
  const { Configuration } = context.dataAccess;
  const configuration = await Configuration.findLatest();
  return configuration.isHandlerEnabledForSite(type, site);
}

async function loadExistingAudit(auditId, context) {
  if (!isValidUUID(auditId)) {
    throw new Error('Valid auditId is required for step execution');
  }
  const audit = await retrieveAuditById(context.dataAccess, auditId, context.log);
  if (!audit) {
    throw new Error(`Audit record ${auditId} not found`);
  }
  return audit;
}

export class Audit {
  constructor(
    siteProvider,
    orgProvider,
    urlResolver,
    runner,
    persister,
    messageSender,
    postProcessors,
    steps = {},
  ) {
    this.siteProvider = siteProvider;
    this.orgProvider = orgProvider;
    this.urlResolver = urlResolver;
    this.runner = runner;
    this.persister = persister;
    this.messageSender = messageSender;
    this.postProcessors = postProcessors;
    this.steps = steps;
  }

  getStep(stepName) {
    return this.steps[stepName];
  }

  getStepNames() {
    return Object.keys(this.steps);
  }

  hasSteps() {
    return this.getStepNames().length > 0;
  }

  async runStep(stepName, context) {
    const step = this.getStep(stepName);
    if (!step) {
      throw new Error(`Step ${stepName} not found for audit ${this.type}`);
    }

    const stepResult = await step.handler(context);

    if (!hasText(step.destination)) {
      return stepResult;
    }

    return this.chainStep(step, stepResult, context);
  }

  async chainStep(step, stepResult, context) {
    const { audit, log } = context;

    if (!audit) {
      throw new Error(`Audit not found for step ${step.name} for audit of type ${this.type}`);
    }

    const destination = AUDIT_STEP_DESTINATION_CONFIGS[step.destination];
    if (!isNonEmptyObject(destination)) {
      throw new Error(`Unknown destination: ${step.destination} for audit ${audit.getId()} of type ${this.type}`);
    }

    const nextStepName = this.getNextStepName(step.name);
    const auditContext = {
      next: nextStepName,
      auditId: audit.getId(),
      auditType: audit.getAuditType(),
      fullAuditRef: audit.getFullAuditRef(),
    };

    const payload = destination.formatPayload(stepResult, auditContext);
    await this.messageSender({ queueUrl: destination.queueUrl, payload }, context);

    log.info(`Step ${step.name} completed for audit ${audit.getId()} of type ${this.type}, message sent to ${step.destination}`);

    return stepResult;
  }

  getNextStepName(currentStepName) {
    const stepNames = this.getStepNames();
    const currentIndex = stepNames.indexOf(currentStepName);
    return currentIndex < stepNames.length - 1 ? stepNames[currentIndex + 1] : null;
  }

  /**
   * Executes an audit, either as a single operation or as part of a multi-step workflow.
   *
   * @param {Object} message - The audit message
   * @param {string} message.type - The type of audit to run
   * @param {string} message.siteId - The ID of the site to audit
   * @param {Object} [message.auditContext] - Context for audit execution
   * @param {string} [message.auditContext.step] - Name of the step to execute
   * (for multi-step audits)
   * @param {string} [message.auditContext.auditId] - ID of existing audit
   * (required for steps after first)
   * @param {string} [message.auditContext.finalUrl] - The resolved URL for the audit
   * @param {string} [message.auditContext.fullAuditRef] - Reference to full audit data
   *
   * @param {Object} context - The execution context
   * @param {Object} context.log - Logger instance
   * @param {Object} context.dataAccess - Data access layer
   * @param {Object} context.sqs - SQS client (for step messaging)
   *
   * @returns {Promise<Object>} Returns ok() on success
   *
   * @throws {Error} If audit type is disabled for site
   * @throws {Error} If auditId is invalid or not found for step execution
   * @throws {Error} If step execution fails
   * @throws {Error} If audit has neither steps nor runner defined
   */
  async run(message, context) {
    const { log } = context;
    const { type, siteId, auditContext = {} } = message;

    try {
      // Common setup
      const site = await this.siteProvider(siteId, context);

      if (!(await isAuditEnabledForSite(type, site, context))) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        return ok();
      }

      // Handle continuation of existing audit
      if (hasText(auditContext?.next)) {
        const audit = await loadExistingAudit(auditContext.auditId, context);
        return await this.runStep(auditContext.next, { ...context, site, audit });
      }

      // Start new audit - either step-based or runner-based
      const finalUrl = await this.urlResolver(site);
      const result = this.hasSteps()
        ? await this.runStep(this.getStepNames()[0], { ...context, finalUrl, site })
        : await this.runner(finalUrl, context, site);

      // Create and process audit record
      return await this.processAuditResult(
        result,
        {
          type,
          site,
          finalUrl,
          auditContext,
        },
        context,
      );
    } catch (e) {
      throw new Error(`${type} audit failed for site ${siteId}. Reason: ${e.message}`, { cause: e });
    }
  }

  async processAuditResult(result, params, context) {
    const { type, site } = params;
    const { auditResult, fullAuditRef } = result;

    const auditData = {
      siteId: site.getId(),
      isLive: site.getIsLive(),
      auditedAt: new Date().toISOString(),
      auditType: type,
      auditResult,
      fullAuditRef,
    };

    const audit = await this.persister(auditData, context);
    return this.runPostProcessors(audit, result, { ...params, auditData }, context);
  }

  async runPostProcessors(audit, result, params, context) {
    const {
      type, site, finalUrl, auditData,
    } = params;
    const { auditResult, fullAuditRef } = result;
    const { log } = context;

    // Send result message
    const resultMessage = {
      type,
      url: site.getBaseURL(),
      auditContext: {
        auditId: audit.getId(),
        finalUrl,
        fullAuditRef,
      },
      auditResult,
    };
    await this.messageSender(resultMessage, context);

    // Run post processors
    await this.postProcessors.reduce(async (previousProcessor, postProcessor) => {
      const updatedAuditData = await previousProcessor;

      try {
        const processedResult = await postProcessor(finalUrl, updatedAuditData, context, site);
        return processedResult || updatedAuditData;
      } catch (e) {
        log.error(`Post processor ${postProcessor.name} failed for ${type} audit failed for site ${site.getId()}. Reason: ${e.message}.\nAudit data: ${JSON.stringify(updatedAuditData)}`);
        throw e;
      }
    }, Promise.resolve(auditData));

    return ok();
  }
}
