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

/* eslint-env mocha */

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import { DEPLOY_STATUS, MAX_POLLING_AGE_MS } from '../../src/experiment-deploy/constants.js';

describe('experiment-deploy state-machine', () => {
  let sandbox;
  let processExperimentDeployJob;
  let mockDrsClient;
  let mockTokowakaClient;
  let log;
  let dataAccess;
  let context;

  function createMockSuggestion(id, data = {}) {
    let currentData = { url: `https://example.com/${id}`, ...data };
    return {
      getId: () => id,
      getStatus: () => currentData.status || 'NEW',
      getData: () => currentData,
      setData: (d) => { currentData = d; },
      setUpdatedBy: sinon.stub(),
      save: sinon.stub().resolves(),
    };
  }

  function createMockJob(metadata, status = 'IN_PROGRESS', startedAt = new Date().toISOString()) {
    let currentMetadata = { ...metadata };
    let currentStatus = status;
    let endedAt = null;
    let error = null;
    return {
      getId: () => 'job-1',
      getStatus: () => currentStatus,
      getMetadata: () => currentMetadata,
      getStartedAt: () => startedAt,
      getEndedAt: () => endedAt,
      getError: () => error,
      setMetadata: (m) => { currentMetadata = m; },
      setStatus: (s) => { currentStatus = s; },
      setEndedAt: (e) => { endedAt = e; },
      setError: (e) => { error = e; },
      save: sinon.stub().resolves(),
    };
  }

  function createMockDeploymentExperiment(
    id = 'dep-exp-1',
    {
      initialStatus = DEPLOY_STATUS.PRE_ANALYSIS_SUBMITTED,
      initialPreDeploymentId = 'sched-pre-001',
      initialPostDeploymentId = undefined,
      initialError = undefined,
    } = {},
  ) {
    let status = initialStatus;
    let preDeploymentId = initialPreDeploymentId;
    let postDeploymentId = initialPostDeploymentId;
    let error = initialError;
    return {
      getId: () => id,
      getStatus: () => status,
      getPreDeploymentId: () => preDeploymentId,
      getPostDeploymentId: () => postDeploymentId,
      getError: () => error,
      setStatus: (nextStatus) => { status = nextStatus; },
      setPreDeploymentId: (nextPreDeploymentId) => { preDeploymentId = nextPreDeploymentId; },
      setPostDeploymentId: (nextPostDeploymentId) => { postDeploymentId = nextPostDeploymentId; },
      setError: (nextError) => { error = nextError; },
      setUpdatedBy: sinon.stub(),
      save: sinon.stub().resolves(),
    };
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const defaultDeploymentExperiment = createMockDeploymentExperiment('dep-exp-default');

    mockDrsClient = {
      getScheduleStatus: sandbox.stub(),
      createExperimentSchedule: sandbox.stub(),
    };

    mockTokowakaClient = {
      deploySuggestions: sandbox.stub(),
    };

    log = {
      info: sandbox.spy(),
      warn: sandbox.spy(),
      error: sandbox.spy(),
      debug: sandbox.spy(),
    };

    dataAccess = {
      AsyncJob: { findById: sandbox.stub() },
      Suggestion: { allByOpportunityId: sandbox.stub() },
      Site: { findById: sandbox.stub() },
      Opportunity: { findById: sandbox.stub() },
      DeploymentExperiment: {
        findById: sandbox.stub().resolves(defaultDeploymentExperiment),
        findByPreDeploymentId: sandbox.stub().resolves(defaultDeploymentExperiment),
      },
    };

    context = {
      log,
      dataAccess,
      env: { DRS_API_URL: 'https://drs.test', DRS_API_KEY: 'key' },
    };

    const mod = await esmock('../../src/experiment-deploy/state-machine.js', {
      '@adobe/spacecat-shared-drs-client': {
        default: { createFrom: () => mockDrsClient },
      },
      '@adobe/spacecat-shared-tokowaka-client': {
        default: { createFrom: () => mockTokowakaClient },
      },
    });
    processExperimentDeployJob = mod.processExperimentDeployJob;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns early when job not found', async () => {
    dataAccess.AsyncJob.findById.resolves(null);
    await processExperimentDeployJob(context, 'missing-id');
    expect(log.error.calledWith('[edge-deploy-failed] AsyncJob missing-id not found')).to.be.true;
  });

  it('skips when job is not IN_PROGRESS', async () => {
    const job = createMockJob({ jobType: 'experiment-deploy' }, 'COMPLETED');
    dataAccess.AsyncJob.findById.resolves(job);
    await processExperimentDeployJob(context, 'job-1');
    expect(log.info.calledWith('[experiment-deploy] Job job-1 is COMPLETED, skipping')).to.be.true;
  });

  it('skips when jobType is not experiment-deploy', async () => {
    const job = createMockJob({ jobType: 'other' });
    dataAccess.AsyncJob.findById.resolves(job);
    await processExperimentDeployJob(context, 'job-1');
    expect(log.warn.calledWith('[experiment-deploy] Job job-1 is not experiment-deploy, skipping')).to.be.true;
  });

  it('fails job when polling has expired', async () => {
    const expiredTime = new Date(Date.now() - MAX_POLLING_AGE_MS - 1000).toISOString();
    const job = createMockJob({
      jobType: 'experiment-deploy',
      experimentId: 'exp-1',
      opportunityId: 'opp-1',
      suggestionIds: ['s1'],
      deploymentExperimentId: 'dep-exp-default',
    }, 'IN_PROGRESS', expiredTime);

    const suggestion = createMockSuggestion('s1');
    dataAccess.AsyncJob.findById.resolves(job);
    dataAccess.Suggestion.allByOpportunityId.resolves([suggestion]);

    await processExperimentDeployJob(context, 'job-1');

    expect(job.getStatus()).to.equal('FAILED');
  });

  it('warns on unknown deployStatus', async () => {
    const unknownDeploymentExperiment = createMockDeploymentExperiment('dep-exp-unknown', {
      initialStatus: 'unknown_state',
      initialPreDeploymentId: 'sched-pre-unknown',
    });
    const job = createMockJob({
      jobType: 'experiment-deploy',
      deploymentExperimentId: 'dep-exp-unknown',
      opportunityId: 'opp-1',
      suggestionIds: [],
    });
    dataAccess.AsyncJob.findById.resolves(job);
    dataAccess.DeploymentExperiment.findById.resolves(unknownDeploymentExperiment);
    dataAccess.Suggestion.allByOpportunityId.resolves([]);

    await processExperimentDeployJob(context, 'job-1');
    expect(log.warn.calledWith('[experiment-deploy] Unknown deployStatus: unknown_state for job job-1')).to.be.true;
  });

  it('fails when DeploymentExperiment is not found', async () => {
    const job = createMockJob({
      jobType: 'experiment-deploy',
      experimentId: 'exp-1',
      siteId: 'site-1',
      opportunityId: 'opp-1',
      suggestionIds: ['s1'],
    });
    const suggestion = createMockSuggestion('s1');
    dataAccess.AsyncJob.findById.resolves(job);
    dataAccess.Suggestion.allByOpportunityId.resolves([suggestion]);
    dataAccess.DeploymentExperiment.findById.resolves(null);

    await processExperimentDeployJob(context, 'job-1');

    expect(job.getStatus()).to.equal('FAILED');
    expect(log.error.calledWithMatch(/DeploymentExperiment not found for this job/)).to.be.true;
  });

  it('fails when DeploymentExperiment collection is missing', async () => {
    const job = createMockJob({
      jobType: 'experiment-deploy',
      deploymentExperimentId: 'dep-exp-missing-collection',
      experimentId: 'exp-1',
      siteId: 'site-1',
      opportunityId: 'opp-1',
      suggestionIds: ['s1'],
    });
    const suggestion = createMockSuggestion('s1');
    dataAccess.AsyncJob.findById.resolves(job);
    dataAccess.Suggestion.allByOpportunityId.resolves([suggestion]);
    dataAccess.DeploymentExperiment = undefined;

    await processExperimentDeployJob(context, 'job-1');

    expect(job.getStatus()).to.equal('FAILED');
    expect(log.error.calledWithMatch(/DeploymentExperiment not found for this job/)).to.be.true;
  });

  describe('pre_analysis_submitted', () => {
    let job;
    let suggestion;
    let deploymentExperiment;

    beforeEach(() => {
      deploymentExperiment = createMockDeploymentExperiment('dep-exp-pre', {
        initialStatus: DEPLOY_STATUS.PRE_ANALYSIS_SUBMITTED,
        initialPreDeploymentId: 'sched-pre-001',
      });
      dataAccess.DeploymentExperiment.findById.resolves(deploymentExperiment);
      job = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['s1'],
        deploymentExperimentId: 'dep-exp-pre',
        urls: ['https://example.com/s1'],
      });
      suggestion = createMockSuggestion('s1');
      dataAccess.AsyncJob.findById.resolves(job);
      dataAccess.Suggestion.allByOpportunityId.resolves([suggestion]);
    });

    it('retries when pre-analysis schedule is still running (no jobs summary yet)', async () => {
      mockDrsClient.getScheduleStatus.resolves({ schedule: { schedule_id: 'sched-pre-001' } });
      await processExperimentDeployJob(context, 'job-1');
      expect(log.info.calledWithMatch(/pre-analysis schedule is still running/)).to.be.true;
      expect(job.getStatus()).to.equal('IN_PROGRESS');
    });

    it('retries when pre-analysis is still RUNNING', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 2,
          in_progress: 1,
          is_complete: false,
        },
      });
      await processExperimentDeployJob(context, 'job-1');
      expect(log.info.calledWithMatch(/pre-analysis schedule is still running/)).to.be.true;
    });

    it('fails when pre-analysis FAILED', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 2,
          completed: 0,
          completed_with_errors: 0,
          failed: 2,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });
      await processExperimentDeployJob(context, 'job-1');
      expect(job.getStatus()).to.equal('FAILED');
      expect(deploymentExperiment.getStatus()).to.equal(DEPLOY_STATUS.FAILED);
    });

    it('fails when pre schedule id is missing', async () => {
      const jobWithoutPreSchedule = createMockJob({
        jobType: 'experiment-deploy',
        deploymentExperimentId: 'dep-exp-pre',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['s1'],
      });
      deploymentExperiment = createMockDeploymentExperiment('dep-exp-pre', {
        initialStatus: DEPLOY_STATUS.PRE_ANALYSIS_SUBMITTED,
        initialPreDeploymentId: '',
      });
      dataAccess.DeploymentExperiment.findById.resolves(deploymentExperiment);
      dataAccess.AsyncJob.findById.resolves(jobWithoutPreSchedule);

      await processExperimentDeployJob(context, 'job-1');

      expect(jobWithoutPreSchedule.getStatus()).to.equal('FAILED');
      expect(log.error.calledWithMatch(/Missing pre-analysis schedule ID/)).to.be.true;
    });

    it('proceeds through deploy and post-analysis when pre-analysis COMPLETED', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 2,
          completed: 2,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const mockSite = { getId: () => 'site-1', getBaseURL: () => 'https://example.com' };
      const mockOpportunity = { getId: () => 'opp-1', getType: () => 'llmo' };
      dataAccess.Site.findById.resolves(mockSite);
      dataAccess.Opportunity.findById.resolves(mockOpportunity);

      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [suggestion],
        failedSuggestions: [],
      });

      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-001' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(mockTokowakaClient.deploySuggestions.calledOnce).to.be.true;
      expect(mockDrsClient.createExperimentSchedule.calledOnce).to.be.true;
      expect(
        mockDrsClient.createExperimentSchedule.firstCall.args[0].triggerImmediately,
      ).to.equal(false);
      expect(deploymentExperiment.getStatus()).to.equal(DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED);
      expect(deploymentExperiment.getPostDeploymentId()).to.equal('sched-post-001');
    });

    it('accepts top-level schedule_id from post schedule creation', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      dataAccess.Site.findById.resolves({ getId: () => 'site-1', getBaseURL: () => 'https://example.com' });
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1', getType: () => 'llmo' });
      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [suggestion],
        failedSuggestions: [],
      });
      mockDrsClient.createExperimentSchedule.resolves({ schedule_id: 'sched-post-flat' });

      await processExperimentDeployJob(context, 'job-1');

      expect(deploymentExperiment.getStatus()).to.equal(DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED);
      expect(deploymentExperiment.getPostDeploymentId()).to.equal('sched-post-flat');
    });

    it('handles ineligible suggestions from tokowaka deploy', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 2,
          completed: 2,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const mockSite = { getId: () => 'site-1', getBaseURL: () => 'https://example.com' };
      const mockOpportunity = { getId: () => 'opp-1', getType: () => 'llmo' };
      dataAccess.Site.findById.resolves(mockSite);
      dataAccess.Opportunity.findById.resolves(mockOpportunity);

      const ineligibleSuggestion = createMockSuggestion('s2');
      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [suggestion],
        failedSuggestions: [{ suggestion: ineligibleSuggestion, reason: 'ineligible' }],
      });

      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-002' },
      });

      await processExperimentDeployJob(context, 'job-1');
      expect(log.info.calledWithMatch(/is ineligible/)).to.be.true;
    });

    it('removes stale edgeOptimizeStatus on successful deployment', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const staleSuggestion = createMockSuggestion('s-stale', {
        url: 'https://example.com/stale',
        edgeOptimizeStatus: 'STALE',
      });
      const jobWithStale = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['s-stale'],
        deploymentExperimentId: 'dep-exp-pre',
        urls: ['https://example.com/stale'],
      });

      dataAccess.AsyncJob.findById.resolves(jobWithStale);
      dataAccess.Suggestion.allByOpportunityId.resolves([staleSuggestion]);
      dataAccess.Site.findById.resolves({ getId: () => 'site-1', getBaseURL: () => 'https://example.com' });
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1', getType: () => 'llmo' });

      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [staleSuggestion],
        failedSuggestions: [],
      });
      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-stale' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(staleSuggestion.getData().edgeOptimizeStatus).to.be.undefined;
    });

    it('handles domain-wide deployment and marks covered/skipped suggestions', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const domainWideSuggestion = createMockSuggestion('dw1', {
        isDomainWide: true,
        allowedRegexPatterns: ['^https://example\\.com/page.*'],
      });
      const skippedInBatchSuggestion = createMockSuggestion('s1', {
        url: 'https://example.com/page1',
      });
      const coveredSuggestion = createMockSuggestion('s2', {
        url: 'https://example.com/page2',
      });

      const jobWithDomainWide = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['dw1', 's1'],
        deploymentExperimentId: 'dep-exp-pre',
        urls: ['https://example.com/page1'],
      });

      dataAccess.AsyncJob.findById.resolves(jobWithDomainWide);
      dataAccess.Suggestion.allByOpportunityId.resolves([
        domainWideSuggestion,
        skippedInBatchSuggestion,
        coveredSuggestion,
      ]);

      const mockSite = { getId: () => 'site-1', getBaseURL: () => 'https://example.com' };
      const mockOpportunity = { getId: () => 'opp-1', getType: () => 'llmo' };
      dataAccess.Site.findById.resolves(mockSite);
      dataAccess.Opportunity.findById.resolves(mockOpportunity);

      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [],
        failedSuggestions: [],
      });
      mockTokowakaClient.fetchMetaconfig = sandbox.stub().resolves(null);
      mockTokowakaClient.uploadMetaconfig = sandbox.stub().resolves();

      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-dw' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(mockTokowakaClient.fetchMetaconfig.calledOnce).to.be.true;
      expect(mockTokowakaClient.uploadMetaconfig.calledOnce).to.be.true;
      expect(domainWideSuggestion.save.called).to.be.true;
      expect(coveredSuggestion.save.called).to.be.true;
      expect(skippedInBatchSuggestion.save.called).to.be.true;
    });

    it('filters out non-new/domain-wide/no-url suggestions from covered suggestions', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const domainWideSuggestion = createMockSuggestion('dw-filter', {
        isDomainWide: true,
        allowedRegexPatterns: ['^https://example\\.com/page.*'],
      });
      const skippedInBatchSuggestion = createMockSuggestion('s-skip', {
        url: 'https://example.com/page1',
      });
      const nonNewSuggestion = createMockSuggestion('s-not-new', {
        url: 'https://example.com/page2',
        status: 'APPROVED',
      });
      const otherDomainWide = createMockSuggestion('s-domain-wide', {
        isDomainWide: true,
        allowedRegexPatterns: ['^https://example\\.com/.*'],
      });
      const noUrlSuggestion = createMockSuggestion('s-no-url', { url: undefined });

      const jobWithDomainWide = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['dw-filter', 's-skip'],
        deploymentExperimentId: 'dep-exp-pre',
        urls: ['https://example.com/page1'],
      });

      dataAccess.AsyncJob.findById.resolves(jobWithDomainWide);
      dataAccess.Suggestion.allByOpportunityId.resolves([
        domainWideSuggestion,
        skippedInBatchSuggestion,
        nonNewSuggestion,
        otherDomainWide,
        noUrlSuggestion,
      ]);
      dataAccess.Site.findById.resolves({ getId: () => 'site-1', getBaseURL: () => 'https://example.com' });
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1', getType: () => 'llmo' });

      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [],
        failedSuggestions: [],
      });
      mockTokowakaClient.fetchMetaconfig = sandbox.stub().resolves({});
      mockTokowakaClient.uploadMetaconfig = sandbox.stub().resolves();
      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-filter' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(nonNewSuggestion.save.called).to.be.false;
      expect(otherDomainWide.save.called).to.be.false;
      expect(noUrlSuggestion.save.called).to.be.false;
    });

    it('logs and continues when domain-wide metaconfig upload fails', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const domainWideSuggestion = createMockSuggestion('dw-fail', {
        isDomainWide: true,
        allowedRegexPatterns: ['^https://example\\.com/.*'],
      });
      const jobWithDomainWide = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['dw-fail'],
        deploymentExperimentId: 'dep-exp-pre',
        urls: ['https://example.com/page1'],
      });

      dataAccess.AsyncJob.findById.resolves(jobWithDomainWide);
      dataAccess.Suggestion.allByOpportunityId.resolves([domainWideSuggestion]);
      dataAccess.Site.findById.resolves({ getId: () => 'site-1', getBaseURL: () => 'https://example.com' });
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1', getType: () => 'llmo' });

      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [],
        failedSuggestions: [],
      });
      mockTokowakaClient.fetchMetaconfig = sandbox.stub().resolves({});
      mockTokowakaClient.uploadMetaconfig = sandbox.stub().rejects(new Error('upload failed'));
      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-after-dw-fail' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(log.error.calledWithMatch(/Error deploying domain-wide suggestion/)).to.be.true;
      expect(mockDrsClient.createExperimentSchedule.calledOnce).to.be.true;
    });

    it('handles invalid regex and keeps non-covered or url-less suggestions', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const domainWideSuggestion = createMockSuggestion('dw-invalid', {
        isDomainWide: true,
        allowedRegexPatterns: ['[invalid-regex'],
      });
      const urlLessTargetSuggestion = createMockSuggestion('s-no-url-target', { url: undefined });
      const nonCoveredTargetSuggestion = createMockSuggestion('s-non-covered', {
        url: 'https://example.com/non-covered',
      });
      const noUrlCoveredCandidate = createMockSuggestion('s-no-url-covered', { url: undefined });

      const jobWithInvalidRegex = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['dw-invalid', 's-no-url-target', 's-non-covered'],
        deploymentExperimentId: 'dep-exp-pre',
        urls: ['https://example.com/non-covered'],
      });

      dataAccess.AsyncJob.findById.resolves(jobWithInvalidRegex);
      dataAccess.Suggestion.allByOpportunityId.resolves([
        domainWideSuggestion,
        urlLessTargetSuggestion,
        nonCoveredTargetSuggestion,
        noUrlCoveredCandidate,
      ]);
      dataAccess.Site.findById.resolves({ getId: () => 'site-1', getBaseURL: () => 'https://example.com' });
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1', getType: () => 'llmo' });

      // Since regex is invalid, non-domain suggestions remain valid
      // and are sent to deploySuggestions.
      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [urlLessTargetSuggestion, nonCoveredTargetSuggestion],
        failedSuggestions: [],
      });
      mockTokowakaClient.fetchMetaconfig = sandbox.stub().resolves({});
      mockTokowakaClient.uploadMetaconfig = sandbox.stub().resolves();
      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-invalid-regex' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(log.warn.calledWithMatch(/Invalid regex pattern/)).to.be.true;
      expect(mockTokowakaClient.deploySuggestions.calledOnce).to.be.true;
      expect(noUrlCoveredCandidate.save.called).to.be.false;
    });

    it('handles domain-wide only deployments when no same-batch skips exist', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const domainWideOnly = createMockSuggestion('dw-only', {
        isDomainWide: true,
        allowedRegexPatterns: ['^https://example\\.com/.*'],
      });
      const jobDomainWideOnly = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['dw-only'],
        deploymentExperimentId: 'dep-exp-pre',
        urls: ['https://example.com/page1'],
      });

      dataAccess.AsyncJob.findById.resolves(jobDomainWideOnly);
      dataAccess.Suggestion.allByOpportunityId.resolves([domainWideOnly]);
      dataAccess.Site.findById.resolves({ getId: () => 'site-1', getBaseURL: () => 'https://example.com' });
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1', getType: () => 'llmo' });

      mockTokowakaClient.fetchMetaconfig = sandbox.stub().resolves({});
      mockTokowakaClient.uploadMetaconfig = sandbox.stub().resolves();
      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-dw-only' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(mockTokowakaClient.deploySuggestions.called).to.be.false;
      expect(domainWideOnly.save.called).to.be.true;
    });

    it('treats complete summary without failed field as completed', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 0,
          completed_with_errors: 0,
          // failed intentionally omitted to cover fallback branch
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      dataAccess.Site.findById.resolves({ getId: () => 'site-1', getBaseURL: () => 'https://example.com' });
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1', getType: () => 'llmo' });
      mockTokowakaClient.deploySuggestions.resolves({
        succeededSuggestions: [suggestion],
        failedSuggestions: [],
      });
      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-no-failed' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(deploymentExperiment.getStatus()).to.equal(DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED);
    });

    it('continues to post submission when tokowaka deployment throws', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });

      const mockSite = { getId: () => 'site-1', getBaseURL: () => 'https://example.com' };
      const mockOpportunity = { getId: () => 'opp-1', getType: () => 'llmo' };
      dataAccess.Site.findById.resolves(mockSite);
      dataAccess.Opportunity.findById.resolves(mockOpportunity);

      mockTokowakaClient.deploySuggestions.rejects(new Error('tokowaka down'));
      mockDrsClient.createExperimentSchedule.resolves({
        schedule: { schedule_id: 'sched-post-after-error' },
      });

      await processExperimentDeployJob(context, 'job-1');

      expect(log.error.calledWithMatch(/Error deploying suggestions to Tokowaka/)).to.be.true;
      expect(mockDrsClient.createExperimentSchedule.calledOnce).to.be.true;
      expect(deploymentExperiment.getStatus()).to.equal(DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED);
    });

    it('fails when site not found', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });
      dataAccess.Site.findById.resolves(null);
      dataAccess.Opportunity.findById.resolves({ getId: () => 'opp-1' });

      await processExperimentDeployJob(context, 'job-1');
      expect(job.getStatus()).to.equal('FAILED');
    });

    it('fails when opportunity not found', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 1,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });
      dataAccess.Site.findById.resolves({ getId: () => 'site-1' });
      dataAccess.Opportunity.findById.resolves(null);

      await processExperimentDeployJob(context, 'job-1');
      expect(job.getStatus()).to.equal('FAILED');
    });
  });

  describe('post_analysis_submitted', () => {
    let job;
    let suggestion;
    let deploymentExperiment;

    beforeEach(() => {
      deploymentExperiment = createMockDeploymentExperiment('dep-exp-post', {
        initialStatus: DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED,
        initialPreDeploymentId: 'sched-pre-001',
        initialPostDeploymentId: 'sched-post-001',
      });
      dataAccess.DeploymentExperiment.findById.resolves(deploymentExperiment);
      job = createMockJob({
        jobType: 'experiment-deploy',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['s1'],
        deploymentExperimentId: 'dep-exp-post',
      });
      suggestion = createMockSuggestion('s1');
      dataAccess.AsyncJob.findById.resolves(job);
      dataAccess.Suggestion.allByOpportunityId.resolves([suggestion]);
    });

    it('retries when post-analysis schedule is still running (no jobs summary yet)', async () => {
      mockDrsClient.getScheduleStatus.resolves({ schedule: { schedule_id: 'sched-post-001' } });
      await processExperimentDeployJob(context, 'job-1');
      expect(log.info.calledWithMatch(/post-analysis schedule is still running/)).to.be.true;
    });

    it('retries when post-analysis is still RUNNING', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 3,
          completed: 1,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 2,
          is_complete: false,
        },
      });
      await processExperimentDeployJob(context, 'job-1');
      expect(log.info.calledWithMatch(/post-analysis schedule is still running/)).to.be.true;
    });

    it('marks job as failed when post-analysis FAILED', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 2,
          completed: 0,
          completed_with_errors: 0,
          failed: 2,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });
      await processExperimentDeployJob(context, 'job-1');
      expect(job.getStatus()).to.equal('FAILED');
      expect(deploymentExperiment.getStatus())
        .to.equal(DEPLOY_STATUS.DEPLOYED_POST_ANALYSIS_FAILED);
    });

    it('fails when post schedule id is missing', async () => {
      const jobWithoutPostSchedule = createMockJob({
        jobType: 'experiment-deploy',
        deploymentExperimentId: 'dep-exp-post',
        experimentId: 'exp-1',
        siteId: 'site-1',
        opportunityId: 'opp-1',
        suggestionIds: ['s1'],
      });
      deploymentExperiment = createMockDeploymentExperiment('dep-exp-post', {
        initialStatus: DEPLOY_STATUS.POST_ANALYSIS_SUBMITTED,
        initialPreDeploymentId: 'sched-pre-001',
        initialPostDeploymentId: undefined,
      });
      dataAccess.DeploymentExperiment.findById.resolves(deploymentExperiment);
      dataAccess.AsyncJob.findById.resolves(jobWithoutPostSchedule);

      await processExperimentDeployJob(context, 'job-1');

      expect(jobWithoutPostSchedule.getStatus()).to.equal('FAILED');
      expect(log.error.calledWithMatch(/Missing post-analysis schedule ID/)).to.be.true;
    });

    it('completes job when post-analysis COMPLETED', async () => {
      mockDrsClient.getScheduleStatus.resolves({
        jobs_summary: {
          total: 2,
          completed: 2,
          completed_with_errors: 0,
          failed: 0,
          cancelled: 0,
          in_progress: 0,
          is_complete: true,
        },
      });
      await processExperimentDeployJob(context, 'job-1');
      expect(job.getStatus()).to.equal('COMPLETED');
      expect(deploymentExperiment.getStatus()).to.equal(DEPLOY_STATUS.POST_ANALYSIS_DONE);
    });
  });

  it('catches errors during state transitions and fails the job', async () => {
    const job = createMockJob({
      jobType: 'experiment-deploy',
      experimentId: 'exp-1',
      siteId: 'site-1',
      opportunityId: 'opp-1',
      suggestionIds: ['s1'],
      deploymentExperimentId: 'dep-exp-pre',
    });
    const suggestion = createMockSuggestion('s1');
    dataAccess.AsyncJob.findById.resolves(job);
    dataAccess.Suggestion.allByOpportunityId.resolves([suggestion]);
    mockDrsClient.getScheduleStatus.rejects(new Error('DRS unavailable'));

    await processExperimentDeployJob(context, 'job-1');

    expect(job.getStatus()).to.equal('FAILED');
    expect(log.error.calledWithMatch(/Error processing job/)).to.be.true;
  });
});
