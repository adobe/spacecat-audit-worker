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

import {
  Audit,
  defaultSiteProvider,
  defaultOrgProvider,
  defaultMessageSender,
  defaultPersister,
  defaultUrlResolver,
  defaultPostProcessors,
} from './audit.js';

export class AuditBuilder {
  constructor() {
    this.siteProvider = defaultSiteProvider;
    this.orgProvider = defaultOrgProvider;
    this.urlResolver = defaultUrlResolver;
    this.persister = defaultPersister;
    this.messageSender = defaultMessageSender;
    this.postProcessors = defaultPostProcessors;
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

  build() {
    if (typeof this.runner !== 'function') {
      throw Error('"runner" must be a function');
    }

    return new Audit(
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
