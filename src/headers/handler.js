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

import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';

async function runner(auditUrl, context, site) {
  const { log } = context;

  const key = await getRUMDomainkey(site.getBaseURL(), context);

  const auditResult = {
    key,
  };

  log.info(`Audit result: ${JSON.stringify(auditResult)}`);
  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runner)
  .build();
