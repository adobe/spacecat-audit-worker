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

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { AsyncJob } from '@adobe/spacecat-shared-data-access';
import batchGuidanceHandler from '../../../src/readability/preflight/batch-guidance-handler.js';

use(sinonChai);

const COMPLETED = AsyncJob.Status.COMPLETED;

describe('Readability preflight batch guidance handler', () => {
  let log;
  let job;
  let findById;
  let s3Send;
  let batchResults;
  let context;

  const readabilityAudit = (opportunities) => ([
    { pageUrl: 'https://example.com/p1', audits: [{ name: 'readability', type: 'seo', opportunities }] },
  ]);

  const makeJob = (status, result) => ({
    getStatus: () => status,
    getMetadata: () => ({
      payload: {
        readabilityMetadata: {
          batch: true,
          originalOrderMapping: [
            { textContent: 'Hard to read one.', originalIndex: 0 },
            { textContent: 'Hard to read two.', originalIndex: 1 },
          ],
        },
      },
    }),
    getResult: () => result,
    setResult: sinon.stub(),
    setStatus: sinon.stub(),
    setEndedAt: sinon.stub(),
    save: sinon.stub().resolves(),
    getId: () => 'job-456',
  });

  beforeEach(() => {
    log = {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    };
    batchResults = [];
    s3Send = sinon.stub().callsFake(async (cmd) => {
      if (cmd?.constructor?.name === 'GetObjectCommand') {
        return { Body: { transformToString: async () => JSON.stringify(batchResults) } };
      }
      return {};
    });
    job = makeJob('IN_PROGRESS', readabilityAudit([
      { check: 'poor-readability', textContent: 'Hard to read one.', fleschReadingEase: 20 },
    ]));
    findById = sinon.stub().resolves(job);
    context = {
      log,
      env: { S3_MYSTIQUE_BUCKET_NAME: 'test-bucket' },
      s3Client: { send: s3Send },
      dataAccess: { AsyncJob: { findById } },
    };
  });

  afterEach(() => sinon.restore());

  const message = (extra = {}) => ({
    type: 'guidance:readability',
    mode: 'preflight',
    siteId: 'site-123',
    auditId: 'job-456',
    data: { s3ResultsPath: 'readability-batches/responses/site-123/job-456.json' },
    ...extra,
  });

  it('applies a successful suggestion and completes the job in one shot', async () => {
    batchResults = [{
      status: 'success',
      selector: 'p.a',
      data: {
        page_url: 'https://example.com/p1',
        original_paragraph: 'Hard to read one.',
        current_flesch_score: 20,
        improved_paragraph: 'Easy to read one.',
        improved_flesch_score: 65,
        seo_recommendation: 'Use short sentences.',
        ai_rationale: 'Simpler words.',
      },
    }];

    const res = await batchGuidanceHandler(message(), context);

    expect(res.status).to.equal(200);
    expect(job.setResult).to.have.been.calledOnce;
    const updated = job.setResult.getCall(0).args[0];
    const opp = updated[0].audits[0].opportunities[0];
    expect(opp.suggestionStatus).to.equal('completed');
    expect(opp.aiSuggestion).to.equal('Easy to read one.');
    expect(opp.improvedFleschScore).to.equal(65);
    expect(opp.readabilityImprovement).to.equal(45);
    expect(job.setStatus).to.have.been.calledWith(COMPLETED);
    expect(job.setEndedAt).to.have.been.calledOnce;
    expect(job.save).to.have.been.calledOnce;
    // S3 results file deleted after applying
    const deletes = s3Send.getCalls().filter((c) => c.args[0]?.constructor?.name === 'DeleteObjectCommand');
    expect(deletes).to.have.lengthOf(1);
  });

  it('marks an excluded item as excluded', async () => {
    batchResults = [{
      status: 'success',
      selector: 'p.a',
      data: {
        page_url: 'https://example.com/p1',
        original_paragraph: 'Hard to read one.',
        should_exclude: true,
        exclusion_reason: 'not prose',
      },
    }];

    await batchGuidanceHandler(message(), context);

    const opp = job.setResult.getCall(0).args[0][0].audits[0].opportunities[0];
    expect(opp.suggestionStatus).to.equal('excluded');
    expect(opp.shouldExclude).to.equal(true);
    expect(opp.exclusionReason).to.equal('not prose');
  });

  it('marks an opportunity with no matching suggestion as error', async () => {
    // Batch returned a failed item, so no suggestion matches the opportunity.
    batchResults = [{ status: 'failed', selector: 'p.a', data: { error: 'timeout' } }];

    await batchGuidanceHandler(message(), context);

    const opp = job.setResult.getCall(0).args[0][0].audits[0].opportunities[0];
    expect(opp.suggestionStatus).to.equal('error');
    expect(job.setStatus).to.have.been.calledWith(COMPLETED);
  });

  it('reconstructs opportunities from suggestions when the result has none', async () => {
    job = makeJob('IN_PROGRESS', readabilityAudit([]));
    findById.resolves(job);
    batchResults = [
      {
        status: 'success',
        selector: 'p.b',
        data: {
          page_url: 'https://example.com/p1',
          original_paragraph: 'Hard to read two.',
          current_flesch_score: 15,
          improved_paragraph: 'Easy two.',
          improved_flesch_score: 60,
          seo_recommendation: 'x',
          ai_rationale: 'y',
        },
      },
      {
        status: 'success',
        selector: 'p.a',
        data: {
          page_url: 'https://example.com/p1',
          original_paragraph: 'Hard to read one.',
          current_flesch_score: 20,
          improved_paragraph: 'Easy one.',
          improved_flesch_score: 65,
          seo_recommendation: 'x',
          ai_rationale: 'y',
        },
      },
    ];

    await batchGuidanceHandler(message(), context);

    const opps = job.setResult.getCall(0).args[0][0].audits[0].opportunities;
    expect(opps).to.have.lengthOf(2);
    // Ordered by originalOrderMapping (one before two), not by S3 result order.
    expect(opps[0].textContent).to.equal('Hard to read one.');
    expect(opps[1].textContent).to.equal('Hard to read two.');
    expect(opps[0].suggestionStatus).to.equal('completed');
  });

  it('is idempotent: a response for an already-COMPLETED job is a no-op but still cleans up S3', async () => {
    job = makeJob(COMPLETED, readabilityAudit([]));
    findById.resolves(job);

    const res = await batchGuidanceHandler(message(), context);

    expect(res.status).to.equal(200);
    expect(job.setStatus).to.not.have.been.called;
    expect(job.save).to.not.have.been.called;
    const deletes = s3Send.getCalls().filter((c) => c.args[0]?.constructor?.name === 'DeleteObjectCommand');
    expect(deletes).to.have.lengthOf(1);
  });

  it('returns 400 when s3ResultsPath is missing', async () => {
    const res = await batchGuidanceHandler(message({ data: {} }), context);
    expect(res.status).to.equal(400);
    expect(job.setStatus).to.not.have.been.called;
  });

  it('returns 404 when the AsyncJob is not found', async () => {
    findById.resolves(null);
    const res = await batchGuidanceHandler(message(), context);
    expect(res.status).to.equal(404);
  });

  it('returns 500 when the bucket is not configured', async () => {
    context.env.S3_MYSTIQUE_BUCKET_NAME = undefined;
    const res = await batchGuidanceHandler(message(), context);
    expect(res.status).to.equal(500);
  });

  it('returns 500 and leaves the job unchanged when S3 fetch fails', async () => {
    s3Send.callsFake(async (cmd) => {
      if (cmd?.constructor?.name === 'GetObjectCommand') {
        throw new Error('S3 down');
      }
      return {};
    });

    const res = await batchGuidanceHandler(message(), context);

    expect(res.status).to.equal(500);
    expect(job.setStatus).to.not.have.been.called;
    expect(job.save).to.not.have.been.called;
  });
});
