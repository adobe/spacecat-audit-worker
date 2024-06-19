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

/* c8 ignore start */
import { AuditBuilder } from '../common/audit-builder.js';
import { processAudit } from './common.js';

const DAYS = 1;

let log = console;

export async function essExperimentationDailyAuditRunner(auditUrl, context, site) {
  log = context.log;
  log.info(`Received ESS Experimentation Daily audit request for ${auditUrl}`);
  const startTime = process.hrtime();

  const auditData = await processAudit(
    auditUrl,
    context,
    site,
    DAYS,
  );

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`ESS Experimentation Daily Audit completed in ${formattedElapsed} seconds for ${auditUrl}`);

  return {
    auditResult: auditData,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(essExperimentationDailyAuditRunner)
  .build();
/* c8 ignore stop */
