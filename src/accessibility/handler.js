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

// import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { dataNeededForA11yAudit, batchSize } from './constants.js';
import { runAccessibilityTests } from './a11yAuditUtils.js';

// const auditType = 'accessibility'; // Audit.AUDIT_TYPES.ACCESSIBILITY;

export async function AccessibilityRunner(auditUrl, context) {
  const { log } = context;
  const { urls } = dataNeededForA11yAudit;

  const auditResult = await runAccessibilityTests({
    urls,
    batchSize,
    log,
  });

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

// export async function opportunityAndSuggestions(auditUrl, auditData, context, site) {
// }

// for testing purposes on local machine
// AccessibilityRunner('',
// { log: { info: console.log, error: console.error, warn: console.warn } });

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver) // do I need this?
  .withRunner(AccessibilityRunner)
// .withPostProcessors([opportunityAndSuggestions]) // don't need this for this stage
  .build();
