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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

const JOB_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TARGET = 'https://mybrand.com/page';

describe('seo-gap-analysis/handler', () => {
  const sandbox = sinon.createSandbox();

  let handler;
  let job;
  let googleSearchByQuery;
  let createScrapeJob;
  let getObjectFromKey;
  let context;

  const makeJob = () => ({
    metadata: { seoGapAnalysis: { targetUrl: TARGET } },
    setStatus: sandbox.stub(),
    setResult: sandbox.stub(),
    setError: sandbox.stub(),
    setEndedAt: sandbox.stub(),
    setMetadata: sandbox.stub(),
    getMetadata() { return this.metadata; },
    save: sandbox.stub().resolves(),
  });

  const load = async () => esmock('../../../src/seo-gap-analysis/handler.js', {
    '@adobe/spacecat-shared-data-access': { AsyncJob: { Status: { IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', FAILED: 'FAILED' } } },
    '@adobe/spacecat-shared-scrape-client': { ScrapeClient: { createFrom: () => ({ createScrapeJob }) } },
    '../../../src/support/bright-data-client.js': { default: { createFrom: () => ({ googleSearchByQuery }) } },
    '../../../src/utils/s3-utils.js': { getObjectFromKey },
  });

  beforeEach(async () => {
    job = makeJob();
    googleSearchByQuery = sandbox.stub().resolves([
      { link: TARGET, rank: 1 },
      { link: 'https://competitor.com/x', rank: 2 },
    ]);
    createScrapeJob = sandbox.stub().resolves({ id: 'scrape-job-1' });
    getObjectFromKey = sandbox.stub();
    context = {
      log: {
        info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
      },
      env: { AUDIT_JOBS_QUEUE_URL: 'q', S3_SCRAPER_BUCKET_NAME: 'bucket' },
      s3Client: {},
      dataAccess: { AsyncJob: { findById: sandbox.stub().resolves(job) } },
    };
    handler = await load();
  });

  afterEach(() => sandbox.restore());

  describe('analyze (phase 1)', () => {
    it('returns notFound when required fields are missing', async () => {
      const res = await handler.analyze({ jobId: JOB_ID }, context);
      expect(res.status).to.equal(404);
    });

    it('returns notFound when the AsyncJob does not exist', async () => {
      context.dataAccess.AsyncJob.findById.resolves(null);
      const res = await handler.analyze(
        { jobId: JOB_ID, keyword: 'shoes', targetUrl: TARGET }, context,
      );
      expect(res.status).to.equal(404);
    });

    it('runs SERP, buckets, fans out scrape and records metadata', async () => {
      const res = await handler.analyze(
        {
          jobId: JOB_ID, keyword: 'shoes', targetUrl: TARGET, filterDomains: ['partner.com'],
        },
        context,
      );
      expect(res.status).to.equal(200);
      expect(googleSearchByQuery).to.have.been.calledWith('shoes', 20, null);
      expect(createScrapeJob).to.have.been.calledOnce;
      const payload = createScrapeJob.firstCall.args[0];
      expect(payload.processingType).to.equal('seo-comparison');
      expect(payload.urls.map((u) => u.url)).to.include(TARGET);
      expect(job.setMetadata).to.have.been.calledOnce;
      expect(job.setStatus).to.have.been.calledWith('IN_PROGRESS');
    });

    it('defaults job metadata to an empty object when absent', async () => {
      job.getMetadata = () => undefined;
      const res = await handler.analyze(
        { jobId: JOB_ID, keyword: 'shoes', targetUrl: TARGET }, context,
      );
      expect(res.status).to.equal(200);
      const written = job.setMetadata.firstCall.args[0];
      expect(written.seoGapAnalysis.scrapeJobId).to.equal('scrape-job-1');
    });

    it('passes an explicit locale through to the SERP call', async () => {
      await handler.analyze(
        {
          jobId: JOB_ID, keyword: 'shoes', targetUrl: TARGET, locale: 'de',
        },
        context,
      );
      expect(googleSearchByQuery).to.have.been.calledWith('shoes', 20, 'de');
    });

    it('marks the job FAILED and returns 500 when SERP fails', async () => {
      googleSearchByQuery.rejects(new Error('brightdata down'));
      const res = await handler.analyze(
        { jobId: JOB_ID, keyword: 'shoes', targetUrl: TARGET }, context,
      );
      expect(res.status).to.equal(500);
      expect(job.setStatus).to.have.been.calledWith('FAILED');
      expect(job.setError).to.have.been.calledOnce;
    });
  });

  describe('aggregate (phase 2)', () => {
    const targetSnap = { url: TARGET, structuredData: [{ '@type': 'Article' }], schemaTypes: ['Article'] };
    const competitorSnap = { url: 'https://competitor.com/x', structuredData: [{ '@type': 'Product' }], schemaTypes: ['Product'] };

    const completion = {
      type: 'seo-comparison',
      auditContext: { seoGapAnalysisJobId: JOB_ID, targetUrl: TARGET },
      scrapeResults: [
        { location: 'scrapes/1/target.json', metadata: { url: TARGET } },
        { location: 'scrapes/1/comp.json', metadata: { url: 'https://competitor.com/x' } },
      ],
    };

    it('returns notFound without a correlation id', async () => {
      const res = await handler.aggregate({ scrapeResults: [] }, context);
      expect(res.status).to.equal(404);
    });

    it('returns notFound when the AsyncJob is gone', async () => {
      context.dataAccess.AsyncJob.findById.resolves(null);
      const res = await handler.aggregate(completion, context);
      expect(res.status).to.equal(404);
    });

    it('computes the gap report and completes the job', async () => {
      getObjectFromKey
        .withArgs(sinon.match.any, 'bucket', 'scrapes/1/target.json', sinon.match.any)
        .resolves({ scrapeResult: targetSnap, finalUrl: TARGET });
      getObjectFromKey
        .withArgs(sinon.match.any, 'bucket', 'scrapes/1/comp.json', sinon.match.any)
        .resolves({ scrapeResult: competitorSnap, finalUrl: 'https://competitor.com/x' });

      const res = await handler.aggregate(completion, context);
      expect(res.status).to.equal(200);
      expect(job.setStatus).to.have.been.calledWith('COMPLETED');
      const report = job.setResult.firstCall.args[0];
      expect(report.competitorCount).to.equal(1);
      expect(report.target.url).to.equal(TARGET);
    });

    it('resolves target from job metadata and skips null snapshots', async () => {
      const msg = { ...completion, auditContext: { seoGapAnalysisJobId: JOB_ID } };
      getObjectFromKey.onFirstCall().resolves(null); // missing snapshot skipped
      getObjectFromKey.onSecondCall().resolves({ scrapeResult: competitorSnap });
      const res = await handler.aggregate(msg, context);
      expect(res.status).to.equal(200);
      expect(job.setStatus).to.have.been.calledWith('COMPLETED');
    });

    it('resolves correlation + target from message metaData and reads via metadata.path', async () => {
      const msg = {
        type: 'seo-comparison',
        metaData: { seoGapAnalysisJobId: JOB_ID, targetUrl: TARGET },
        scrapeResults: [
          { metadata: { path: 'scrapes/1/target.json', url: TARGET } },
          { metadata: {} }, // no location and no path -> snapshot skipped
        ],
      };
      getObjectFromKey
        .withArgs(sinon.match.any, 'bucket', 'scrapes/1/target.json', sinon.match.any)
        .resolves({ scrapeResult: targetSnap, finalUrl: TARGET });
      const res = await handler.aggregate(msg, context);
      expect(res.status).to.equal(200);
      expect(job.setStatus).to.have.been.calledWith('COMPLETED');
    });

    it('resolves correlation from per-result jobMetadata and tolerates no known target', async () => {
      job.metadata = {}; // no seoGapAnalysis.targetUrl fallback either
      const msg = {
        type: 'seo-comparison',
        scrapeResults: [
          { location: 'scrapes/1/a.json', metadata: { jobMetadata: { seoGapAnalysisJobId: JOB_ID } } },
        ],
      };
      getObjectFromKey.resolves({ scrapeResult: competitorSnap });
      const res = await handler.aggregate(msg, context);
      expect(res.status).to.equal(200);
      // With no identifiable target, everything is treated as a competitor.
      const report = job.setResult.firstCall.args[0];
      expect(report.competitorCount).to.equal(1);
      expect(report.target.url).to.equal(null);
    });

    it('matches the target by finalUrl when the scraped url differs (redirect)', async () => {
      getObjectFromKey
        .withArgs(sinon.match.any, 'bucket', 'scrapes/1/target.json', sinon.match.any)
        .resolves({ scrapeResult: { ...targetSnap, url: 'https://mybrand.com/redirected' }, finalUrl: TARGET });
      getObjectFromKey
        .withArgs(sinon.match.any, 'bucket', 'scrapes/1/comp.json', sinon.match.any)
        .resolves({ scrapeResult: competitorSnap, finalUrl: 'https://competitor.com/x' });
      const res = await handler.aggregate(completion, context);
      expect(res.status).to.equal(200);
      const report = job.setResult.firstCall.args[0];
      expect(report.competitorCount).to.equal(1);
    });

    it('completes with an empty report when the completion carries no scrapeResults', async () => {
      const res = await handler.aggregate(
        { type: 'seo-comparison', auditContext: { seoGapAnalysisJobId: JOB_ID, targetUrl: TARGET } },
        context,
      );
      expect(res.status).to.equal(200);
      const report = job.setResult.firstCall.args[0];
      expect(report.competitorCount).to.equal(0);
    });

    it('marks the job FAILED and returns 500 when reading snapshots throws', async () => {
      getObjectFromKey.rejects(new Error('s3 boom'));
      const res = await handler.aggregate(completion, context);
      expect(res.status).to.equal(500);
      expect(job.setStatus).to.have.been.calledWith('FAILED');
    });
  });
});
