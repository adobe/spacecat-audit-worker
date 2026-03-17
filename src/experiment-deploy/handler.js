/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { processExperimentDeployJob } from './state-machine.js';

/**
 * Experiment-deploy poller handler. Invoked on a schedule.
 * Fetches all in-progress AsyncJobs with jobType 'experiment-deploy'
 * and processes 10 jobs at a time.
 */
export default async function experimentDeployHandler(message, context) {
  const { log } = context;
  const { AsyncJob } = context.dataAccess;

  const inProgressJobs = await AsyncJob.allByStatus('IN_PROGRESS');
  const experimentJobs = inProgressJobs.filter(
    (job) => job.getMetadata()?.jobType === 'experiment-deploy',
  );

  if (experimentJobs.length === 0) {
    log.info('[experiment-deploy-poller] No in-progress experiment-deploy jobs found');
    return ok();
  }

  log.info(`[experiment-deploy-poller] Found ${experimentJobs.length} in-progress experiment-deploy job(s),`
    + ' processing 10 jobs in this run');

  await Promise.allSettled(
    experimentJobs.slice(0, 10).map(async (job) => {
      try {
        await processExperimentDeployJob(context, job.getId());
      } catch (err) {
        log.error(`[experiment-deploy-poller] Error processing job ${job.getId()}: ${err.message}`, err);
      }
    }),
  );

  return ok();
}
