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

import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';

import {
  defaultSiteProvider,
  defaultOrgProvider,
  defaultMessageSender,
  defaultPersister,
  defaultUrlResolver,
  defaultPostProcessors,
  StepAudit,
  RunnerAudit,
  AsyncJobRunner,
} from './index.js';

export class AuditBuilder {
  constructor() {
    this.siteProvider = defaultSiteProvider;
    this.orgProvider = defaultOrgProvider;
    this.urlResolver = defaultUrlResolver;
    this.persister = defaultPersister;
    this.messageSender = defaultMessageSender;
    this.postProcessors = defaultPostProcessors;
    this.isAsyncJob = false;
    this.steps = {};
  }

  // message > site
  withSiteProvider(siteProvider) {
    this.siteProvider = siteProvider;
    return this;
  }

  // site > finalUrl
  withUrlResolver(urlResolver) {
    this.urlResolver = urlResolver;
    return this;
  }

  // site, finalUrl
  withRunner(runner) {
    this.runner = runner;
    return this;
  }

  withPersister(persister) {
    this.persister = persister;
    return this;
  }

  // audit
  withMessageSender(messageSender) {
    this.messageSender = messageSender;
    return this;
  }

  withPostProcessors(postprocessors) {
    this.postProcessors = postprocessors;
    return this;
  }

  withAsyncJob() {
    this.isAsyncJob = true;
    return this;
  }

  /**
   * Adds a step to the audit workflow.
   *
   * @param {string} name - Unique name of the step
   * @param {Function} handler - Function to execute for this step
   * @param {AuditModel.AUDIT_STEP_DESTINATIONS} destination - Destination queue for step results
   * (e.g., DESTINATIONS.IMPORT_WORKER). Only the last step may omit the destination.
   *
   * @returns {AuditBuilder} Returns this builder instance for method chaining
   *
   * @example
   * new AuditBuilder()
   *   .addStep('ingest', async (site, audit, auditContext, context) => {
   *     // First step must return auditResult and fullAuditRef
   *     // site: Site instance with getBaseURL(), getId(), etc.
   *     // audit: undefined for first step
   *     // context: { log, dataAccess, sqs, ... }
   *
   *     const data = await fetchData(site.getBaseURL());
   *     return {
   *       auditResult: { status: 'success', data },
   *       fullAuditRef: 'path/to/full/data'
   *     };
   *   }, AuditModel.AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
   *   .addStep('scrape', async (site, audit, auditContext, context) => {
   *     // Subsequent steps can return any data needed by their destination
   *     // audit: Audit record with getId(), getFullAuditRef(), etc.
   *     // auditContext: { step, auditId, finalUrl, fullAuditRef }
   *     return {
   *       url: site.getBaseURL(),
   *       options: {
   *         fullAuditRef: audit.getFullAuditRef(),
   *         // ... other scraper options
   *       }
   *     };
   *   }, AuditModel.AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
   */
  addStep(name, handler, destination = null) {
    const supportedDestinations = Object.values(AuditModel.AUDIT_STEP_DESTINATIONS);

    if (destination && !supportedDestinations.includes(destination)) {
      throw new Error(`Invalid destination: ${destination}. Must be one of: ${supportedDestinations.join(', ')}`);
    }

    this.steps[name] = {
      name,
      handler,
      destination,
    };
    return this;
  }

  build() {
    const stepNames = Object.keys(this.steps);

    if (stepNames.length > 0) {
      stepNames.forEach((stepName, index) => {
        const isLastStep = index === stepNames.length - 1;
        const step = this.steps[stepName];

        if (!isLastStep && !step.destination) {
          throw new Error(`Step ${stepName} must specify a destination as it is not the last step`);
        }
      });

      if (this.isAsyncJob) {
        return new AsyncJobRunner(
          this.siteProvider,
          this.orgProvider,
          this.urlResolver,
          this.persister,
          this.messageSender,
          this.postProcessors,
          this.steps,
        );
      }

      return new StepAudit(
        this.siteProvider,
        this.orgProvider,
        this.urlResolver,
        this.persister,
        this.messageSender,
        this.postProcessors,
        this.steps,
      );
    }

    if (typeof this.runner !== 'function') {
      throw Error('Audit must have either steps or a runner defined');
    }

    return new RunnerAudit(
      this.siteProvider,
      this.orgProvider,
      this.urlResolver,
      this.runner,
      this.persister,
      this.messageSender,
      this.postProcessors,
    );
  }
}
