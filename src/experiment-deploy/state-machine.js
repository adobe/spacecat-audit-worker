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

import DrsClient from '@adobe/spacecat-shared-drs-client';
import TokowakaClient from '@adobe/spacecat-shared-tokowaka-client';
import {
  DEPLOY_STATUS, MAX_POLLING_AGE_MS,
} from './constants.js';

function isExpired(job) {
  const startedAt = new Date(job.getStartedAt()).getTime();
  return (Date.now() - startedAt) > MAX_POLLING_AGE_MS;
}

function isDomainWideSuggestion(suggestion) {
  const data = suggestion.getData();
  return data?.isDomainWide === true;
}

function isStatusNew(suggestion) {
  return suggestion.getStatus() === 'NEW';
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function evaluateScheduleSummary(scheduleStatus) {
  const summary = scheduleStatus?.jobs_summary;
  if (!summary || summary.total === 0 || summary.in_progress > 0 || !summary.is_complete) {
    return 'RUNNING';
  }

  const successfulCount = (summary.completed || 0) + (summary.completed_with_errors || 0);
  if (successfulCount === 0 && (summary.failed || 0) > 0) {
    return 'FAILED';
  }

  return 'COMPLETED';
}

async function deploySuggestionsToEdge(
  context,
  site,
  opportunity,
  targetSuggestions,
  allSuggestions,
  log,
) {
  const tokowakaClient = TokowakaClient.createFrom(context);
  const validSuggestions = [];
  const domainWideSuggestions = [];

  targetSuggestions.forEach((suggestion) => {
    if (isDomainWideSuggestion(suggestion)) {
      const allowedRegexPatterns = suggestion.getData()?.allowedRegexPatterns;
      if (hasNonEmptyArray(allowedRegexPatterns)) {
        domainWideSuggestions.push({ suggestion, allowedRegexPatterns });
      }
    } else if (isStatusNew(suggestion)) {
      validSuggestions.push(suggestion);
    }
  });

  if (hasNonEmptyArray(domainWideSuggestions) && hasNonEmptyArray(validSuggestions)) {
    const allDomainWidePatterns = [];
    domainWideSuggestions.forEach(({ allowedRegexPatterns }) => {
      allowedRegexPatterns.forEach((pattern) => {
        try {
          allDomainWidePatterns.push(new RegExp(pattern));
        } catch (error) {
          log.warn(`[experiment-deploy] Invalid regex pattern: ${pattern}`, error);
        }
      });
    });

    const filteredValidSuggestions = [];
    const skippedSuggestions = [];

    validSuggestions.forEach((suggestion) => {
      const url = suggestion.getData()?.url;
      if (!url) {
        filteredValidSuggestions.push(suggestion);
        return;
      }

      const isCovered = allDomainWidePatterns.some((regex) => regex.test(url));
      if (isCovered) {
        skippedSuggestions.push(suggestion);
        log.info(`[experiment-deploy] Skipping suggestion ${suggestion.getId()} - covered by domain-wide pattern`);
      } else {
        filteredValidSuggestions.push(suggestion);
      }
    });

    validSuggestions.length = 0;
    validSuggestions.push(...filteredValidSuggestions);
    context.skippedDueToSameBatchDomainWide = skippedSuggestions;
  }

  let succeededSuggestions = [];

  if (hasNonEmptyArray(validSuggestions)) {
    try {
      const deploymentResult = await tokowakaClient.deploySuggestions(
        site,
        opportunity,
        validSuggestions,
      );

      const {
        succeededSuggestions: deployedSuggestions,
        failedSuggestions: ineligibleSuggestions,
      } = deploymentResult;

      const deploymentTimestamp = Date.now();
      succeededSuggestions = await Promise.all(
        deployedSuggestions.map(async (suggestion) => {
          const currentData = suggestion.getData();
          const updatedData = {
            ...currentData,
            edgeDeployed: deploymentTimestamp,
          };
          if (updatedData.edgeOptimizeStatus === 'STALE') {
            delete updatedData.edgeOptimizeStatus;
          }
          suggestion.setData(updatedData);
          suggestion.setUpdatedBy('experiment-deploy-worker');
          await suggestion.save();
          return suggestion;
        }),
      );

      if (hasNonEmptyArray(ineligibleSuggestions)) {
        ineligibleSuggestions.forEach((item) => {
          log.info(`[experiment-deploy] ${opportunity.getType()} suggestion ${item.suggestion.getId()} is ineligible: ${item.reason}`);
        });
      }
    } catch (error) {
      log.error(`[edge-deploy-failed] Error deploying suggestions to Tokowaka: ${error.message}`, error);
    }
  }

  if (hasNonEmptyArray(domainWideSuggestions)) {
    const baseURL = site.getBaseURL();
    for (const { suggestion, allowedRegexPatterns } of domainWideSuggestions) {
      try {
        // eslint-disable-next-line no-await-in-loop
        let metaconfig = await tokowakaClient.fetchMetaconfig(baseURL);

        if (!metaconfig) {
          metaconfig = {
            siteId: site.getId(),
          };
        }

        metaconfig.prerender = {
          allowList: allowedRegexPatterns,
        };

        // eslint-disable-next-line no-await-in-loop
        await tokowakaClient.uploadMetaconfig(baseURL, metaconfig);

        const deploymentTimestamp = Date.now();
        const currentData = suggestion.getData();
        suggestion.setData({
          ...currentData,
          edgeDeployed: deploymentTimestamp,
        });
        suggestion.setUpdatedBy('experiment-deploy-worker');
        // eslint-disable-next-line no-await-in-loop
        await suggestion.save();
        succeededSuggestions.push(suggestion);

        const skippedInBatchIds = new Set(
          (context.skippedDueToSameBatchDomainWide || []).map((s) => s.getId()),
        );
        const regexPatterns = allowedRegexPatterns.map((pattern) => new RegExp(pattern));
        const coveredSuggestions = allSuggestions.filter((s) => {
          if (s.getId() === suggestion.getId()) {
            return false;
          }
          if (skippedInBatchIds.has(s.getId())) {
            return false;
          }
          if (!isStatusNew(s)) {
            return false;
          }
          if (isDomainWideSuggestion(s)) {
            return false;
          }
          const url = s.getData()?.url;
          if (!url) {
            return false;
          }
          return regexPatterns.some((regex) => regex.test(url));
        });

        if (hasNonEmptyArray(coveredSuggestions)) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.all(
            coveredSuggestions.map(async (coveredSuggestion) => {
              const coveredData = coveredSuggestion.getData();
              coveredSuggestion.setData({
                ...coveredData,
                edgeDeployed: deploymentTimestamp,
                coveredByDomainWide: suggestion.getId(),
              });
              coveredSuggestion.setUpdatedBy('experiment-deploy-worker');
              return coveredSuggestion.save();
            }),
          );
        }
      } catch (error) {
        log.error(`[edge-deploy-failed] Error deploying domain-wide suggestion ${suggestion.getId()}: ${error.message}`, error);
      }
    }
  }

  const skippedDomainWide = context.skippedDueToSameBatchDomainWide;
  if (hasNonEmptyArray(skippedDomainWide)) {
    const deploymentTimestamp = Date.now();
    await Promise.all(
      skippedDomainWide.map(async (skippedSuggestion) => {
        const currentData = skippedSuggestion.getData();
        skippedSuggestion.setData({
          ...currentData,
          edgeDeployed: deploymentTimestamp,
          coveredByDomainWide: 'same-batch-deployment',
          skippedInDeployment: true,
        });
        skippedSuggestion.setUpdatedBy('experiment-deploy-worker');
        await skippedSuggestion.save();
      }),
    );

    succeededSuggestions.push(...skippedDomainWide);
  }

  return succeededSuggestions;
}

async function updateDeploymentExperimentStatus(
  deploymentExperiment,
  { status, postDeploymentId = undefined, error = undefined } = {},
) {
  if (!deploymentExperiment) {
    return;
  }

  if (status) {
    deploymentExperiment.setStatus(status);
  }
  if (typeof postDeploymentId !== 'undefined') {
    deploymentExperiment.setPostDeploymentId(postDeploymentId);
  }
  if (typeof error !== 'undefined') {
    deploymentExperiment.setError(error);
  }
  deploymentExperiment.setUpdatedBy('experiment-deploy-worker');
  await deploymentExperiment.save();
}

async function resolveDeploymentExperiment(dataAccess, metadata) {
  const deploymentExperimentCollection = dataAccess.DeploymentExperiment;
  if (!deploymentExperimentCollection) {
    return null;
  }

  if (metadata?.deploymentExperimentId) {
    return deploymentExperimentCollection.findById(metadata.deploymentExperimentId);
  }

  return null;
}

async function failJob(job, suggestions, errorMessage, log, deploymentExperiment = null) {
  log.error(`[edge-deploy-failed] Job ${job.getId()} failed: ${errorMessage}`);

  const metadata = job.getMetadata();
  metadata.error = errorMessage;
  job.setMetadata(metadata);
  job.setStatus('FAILED');
  job.setError({ code: 'EXPERIMENT_FAILED', message: errorMessage });
  job.setEndedAt(new Date().toISOString());
  await job.save();

  await updateDeploymentExperimentStatus(deploymentExperiment, {
    status: DEPLOY_STATUS.FAILED,
    error: { message: errorMessage },
  });
}

async function handlePreAnalysisSubmitted(
  context,
  job,
  suggestions,
  allSuggestions,
  deploymentExperiment = null,
) {
  const { log } = context;
  const metadata = job.getMetadata();
  const drsClient = DrsClient.createFrom(context);
  const preScheduleId = deploymentExperiment.getPreDeploymentId();

  if (!preScheduleId) {
    await failJob(job, suggestions, 'Missing pre-analysis schedule ID', log, deploymentExperiment);
    return;
  }

  const preScheduleStatus = await drsClient.getScheduleStatus(metadata.siteId, preScheduleId);
  const preStatus = evaluateScheduleSummary(preScheduleStatus);

  if (preStatus === 'RUNNING') {
    log.info(`[experiment-deploy] Job ${job.getId()}: pre-analysis schedule is still running`);
    return;
  }

  if (preStatus === 'FAILED') {
    await failJob(job, suggestions, 'DRS pre-analysis failed', log, deploymentExperiment);
    return;
  }

  if (preStatus === 'COMPLETED') {
    log.info(`[experiment-deploy] Job ${job.getId()}: pre-analysis completed, deploying to edge`);

    await updateDeploymentExperimentStatus(deploymentExperiment, {
      status: DEPLOY_STATUS.PRE_ANALYSIS_DONE,
    });

    const { dataAccess } = context;
    const site = await dataAccess.Site.findById(metadata.siteId);
    const opportunity = await dataAccess.Opportunity.findById(metadata.opportunityId);

    if (!site || !opportunity) {
      await failJob(job, suggestions, 'Site or opportunity not found', log, deploymentExperiment);
      return;
    }

    const succeededSuggestions = await deploySuggestionsToEdge(
      context,
      site,
      opportunity,
      suggestions,
      allSuggestions,
      log,
    );

    await updateDeploymentExperimentStatus(deploymentExperiment, {
      status: DEPLOY_STATUS.DEPLOYED,
    });

    // cache warming here for pre-render for top 200 athena urls U prompt urls from llmo config
    // separate step functions for audit worker itself for each state

    log.info(`[experiment-deploy] Job ${job.getId()}: deployed ${succeededSuggestions.length} suggestions, submitting post-analysis`);

    const drsPostResult = await drsClient.createExperimentSchedule({
      siteId: metadata.siteId,
      experimentId: metadata.experimentId,
      experimentPhase: 'post',
      experimentationUrls: metadata.urls,
      metadata: { triggered_by: 'spacecat-edge-deploy', opportunityId: metadata.opportunityId },
      triggerImmediately: false,
    });

    const postScheduleId = drsPostResult?.schedule?.schedule_id || drsPostResult?.schedule_id;

    await updateDeploymentExperimentStatus(deploymentExperiment, {
      status: DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED,
      postDeploymentId: postScheduleId,
    });

    log.info(`[experiment-deploy] Job ${job.getId()}: post-analysis submitted (schedule: ${postScheduleId})`);
  }
}

async function handlePostAnalysisSubmitted(context, job, suggestions, deploymentExperiment = null) {
  const { log } = context;
  const metadata = job.getMetadata();
  const drsClient = DrsClient.createFrom(context);
  const postScheduleId = deploymentExperiment.getPostDeploymentId();

  if (!postScheduleId) {
    await failJob(job, suggestions, 'Missing post-analysis schedule ID', log, deploymentExperiment);
    return;
  }

  const postScheduleStatus = await drsClient.getScheduleStatus(metadata.siteId, postScheduleId);
  const postStatus = evaluateScheduleSummary(postScheduleStatus);

  if (postStatus === 'RUNNING') {
    log.info(`[experiment-deploy] Job ${job.getId()}: post-analysis schedule is still running`);
    return;
  }

  if (postStatus === 'FAILED') {
    log.error(`[edge-deploy-failed] Job ${job.getId()}: post-analysis failed`);
    job.setStatus('FAILED');
    job.setError({ code: 'POST_ANALYSIS_FAILED', message: 'DRS post-analysis failed' });
    job.setEndedAt(new Date().toISOString());
    await job.save();

    await updateDeploymentExperimentStatus(deploymentExperiment, {
      status: DEPLOY_STATUS.DEPLOYED_POST_ANALYSIS_FAILED,
      error: { message: 'DRS post-analysis failed' },
    });
    return;
  }

  if (postStatus === 'COMPLETED') {
    log.info(`[experiment-deploy] Job ${job.getId()}: post-analysis completed, experiment done`);

    job.setStatus('COMPLETED');
    job.setEndedAt(new Date().toISOString());
    await job.save();

    await updateDeploymentExperimentStatus(deploymentExperiment, {
      status: DEPLOY_STATUS.POST_ANALYSIS_DONE,
    });
  }
}

export async function processExperimentDeployJob(context, asyncJobId) {
  const { dataAccess, log } = context;

  const job = await dataAccess.AsyncJob.findById(asyncJobId);
  if (!job) {
    log.error(`[edge-deploy-failed] AsyncJob ${asyncJobId} not found`);
    return;
  }

  if (job.getStatus() !== 'IN_PROGRESS') {
    log.info(`[experiment-deploy] Job ${asyncJobId} is ${job.getStatus()}, skipping`);
    return;
  }

  const metadata = job.getMetadata();
  if (metadata?.jobType !== 'experiment-deploy') {
    log.warn(`[experiment-deploy] Job ${asyncJobId} is not experiment-deploy, skipping`);
    return;
  }

  const deploymentExperiment = await resolveDeploymentExperiment(dataAccess, metadata);
  if (!deploymentExperiment) {
    const suggestions = await dataAccess.Suggestion.allByOpportunityId(metadata.opportunityId);
    const targetSuggestions = suggestions.filter(
      (s) => metadata.suggestionIds.includes(s.getId()),
    );
    await failJob(
      job,
      targetSuggestions,
      'DeploymentExperiment not found for this job',
      log,
      null,
    );
    return;
  }

  if (isExpired(job)) {
    const suggestions = await dataAccess.Suggestion.allByOpportunityId(metadata.opportunityId);
    const targetSuggestions = suggestions.filter(
      (s) => metadata.suggestionIds.includes(s.getId()),
    );
    // TBD time to expire
    await failJob(
      job,
      targetSuggestions,
      'Experiment polling timed out after 48 hours',
      log,
      deploymentExperiment,
    );
    return;
  }

  const deployStatus = deploymentExperiment.getStatus();
  log.info(`[experiment-deploy] Processing job ${asyncJobId}, status: ${deployStatus}`);

  const allSuggestions = await dataAccess.Suggestion.allByOpportunityId(metadata.opportunityId);
  const targetSuggestions = allSuggestions.filter(
    (s) => metadata.suggestionIds.includes(s.getId()),
  );

  try {
    switch (deployStatus) {
      case DEPLOY_STATUS.PRE_ANALYSIS_SUBMITTED:
        await handlePreAnalysisSubmitted(
          context,
          job,
          targetSuggestions,
          allSuggestions,
          deploymentExperiment,
        );
        break;

      case DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED:
        await handlePostAnalysisSubmitted(context, job, targetSuggestions, deploymentExperiment);
        break;

      default:
        log.warn(`[experiment-deploy] Unknown deployStatus: ${deployStatus} for job ${asyncJobId}`);
        break;
    }
  } catch (error) {
    log.error(`[edge-deploy-failed] Error processing job ${asyncJobId}: ${error.message}`, error);
    await failJob(job, targetSuggestions, error.message, log, deploymentExperiment);
  }
}
