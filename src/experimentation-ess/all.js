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
import { processAudit, postProcessor } from './common.js';
import { wwwUrlResolver } from '../common/audit.js';

const DAYS = 180;

let log = console;

async function persistOnlyMetadata(auditData, context) {
  // persists only the audit metadata, as the
  // whole audit result will be bigger than the allowed size in dynamo
  const { dataAccess } = context;
  const { Audit } = dataAccess;
  await Audit.create({
    ...auditData,
    auditResult: [], // deliberately overrides the result
  });
}

export async function essExperimentationAllAuditRunner(auditUrl, context, site) {
  log = context.log;
  const { dataAccess } = context;
  const { Experiment, LatestAudit } = dataAccess;
  const siteId = site.getId();
  log.info(`Received ESS Experimentation All audit request for ${auditUrl}`);
  const startTime = process.hrtime();

  const latestAudit = await LatestAudit.findBySiteIdAndAuditType(siteId, 'experimentation-ess-all');
  const experiments = await Experiment.allBySiteId(siteId);
  const activeExperiments = experiments.filter((experiment) => (
    experiment.getStatus() && experiment.getStatus().toLowerCase() === 'active' && experiment.getStartDate() !== null));
  let days;
  if (latestAudit === null) {
    // experiment-ess-all audit has never been run before
    days = DAYS;
  } else if (experiments.length === 0 || activeExperiments.length === 0) {
    // no experiments/active experiments found in previous audit,
    // so we can run the audit since the last audit
    days = Math.ceil((Date.now() - new Date(latestAudit.getAuditedAt()).getTime())
     / (1000 * 60 * 60 * 24));
  } else {
    // experiments found, so run the audit since the oldest active experiment's start date
    const oldestExperiment = activeExperiments.reduce((a, b) => (
      a.getStartDate() < b.getStartDate() ? a : b));
    days = Math.ceil((Date.now() - new Date(oldestExperiment.getStartDate()).getTime())
    / (1000 * 60 * 60 * 24));
  }
  log.info(`ESS Experimentation All Audit will run for ${days} days`);
  const auditData = await processAudit(
    auditUrl,
    context,
    site,
    days,
  );

  log.info(`ESS Experimentation All Audit data size: ${JSON.stringify(auditData).length}`);

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`ESS Experimentation All Audit completed in ${formattedElapsed} seconds for ${auditUrl}`);

  return {
    auditResult: auditData,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(essExperimentationAllAuditRunner)
  .withUrlResolver(wwwUrlResolver)
  .withPostProcessors([postProcessor])
  .withPersister(persistOnlyMetadata)
  .withMessageSender(() => true)
  .build();

/* c8 ignore stop */
