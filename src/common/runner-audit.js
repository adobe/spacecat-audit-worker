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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { BaseAudit } from './base-audit.js';
import { isAuditEnabledForSite } from './audit-utils.js';

export class RunnerAudit extends BaseAudit {
  constructor(
    siteProvider,
    orgProvider,
    urlResolver,
    runner,
    persister,
    messageSender,
    postProcessors,
  ) {
    super(siteProvider, orgProvider, urlResolver, persister, messageSender, postProcessors);
    this.runner = runner;
  }

  async run(message, context) {
    const { log } = context;
    const { type, siteId, auditContext = {} } = message;

    try {
      const site = await this.siteProvider(siteId, context);

      if (!(await isAuditEnabledForSite(type, site, context))) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        return ok();
      }

      const finalUrl = await this.urlResolver(site);
      log.debug(`DEBUUUUUUG: Running ${type} audit for site ${siteId} at final URL ${finalUrl}`);
      const result = await this.runner(finalUrl, context, site);

      return this.processAuditResult(
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
}
