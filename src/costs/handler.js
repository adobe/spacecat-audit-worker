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

import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { AuditBuilder } from '../common/audit-builder.js';

export async function runner(auditUrl, context) {
  const { log } = context;
  const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);

  let ahrefsCostsAuditResult;
  try {
    const {
      result,
      fullAuditRef,
    } = await ahrefsAPIClient.getLimitsAndUsage();

    log.info(`Retrieved Ahrefs limits and usage: ${JSON.stringify(result)}`);
    ahrefsCostsAuditResult = {
      usedApiUnits: result?.limits_and_usage?.units_usage_api_key,
      limitApiUnits: result?.limits_and_usage?.units_limit_api_key,
      fullAuditRef,
    };
  } catch (e) {
    log.error(`Ahrefs costs type audit failed with error: ${e.message}`, e);
    ahrefsCostsAuditResult = {
      error: `Ahrefs costs type audit failed with error: ${e.message}`,
    };
  }

  return {
    auditResult: {
      ahrefs: ahrefsCostsAuditResult,
    },
    fullAuditRef: ahrefsCostsAuditResult?.fullAuditRef,
  };
}

export default new AuditBuilder()
  .withRunner(runner)
  .withMessageSender(() => {})
  .build();
