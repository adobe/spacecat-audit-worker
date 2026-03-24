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

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('Vulnerabilities Code-Fix Handler Tests', function () {
  let sandbox;
  let context;
  let message;
  let site;
  let opportunity;
  let suggestion;
  let getObjectFromKey;
  let handler;

  const siteId = 'site-123';
  const opportunityId = 'opp-123';
  const suggestionId = 'sugg-123';
  const reportBucket = 'starfish-results';
  const reportPath = 'results/job-789/report.json';

  const buildStarfishReport = (overrides = {}) => ({
    taskId: 'audit-123',
    jobId: 'job-789',
    status: 'completed',
    results: [
      { suggestionId, status: 'applied', diff: 'diff --git a/pom.xml b/pom.xml\n...' },
    ],
    attempts: [],
    usage: {},
    ...overrides,
  });

  const buildMessage = () => ({
    siteId,
    data: {
      opportunityId,
      reportBucket,
      reportPath,
    },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    getObjectFromKey = sandbox.stub().resolves(buildStarfishReport());

    ({ default: handler } = await esmock('../../src/vulnerabilities-code-fix/handler.js', {
      '../../src/utils/s3-utils.js': { getObjectFromKey },
    }));

    message = buildMessage();

    site = {
      getId: () => siteId,
    };

    opportunity = {
      getId: () => opportunityId,
      getSiteId: () => siteId,
      getType: () => 'security-vulnerabilities',
    };

    suggestion = {
      getId: () => suggestionId,
      getData: () => ({ some: 'data' }),
      setData: sandbox.stub(),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          debug: sandbox.spy(),
          info: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves(site),
          },
          Opportunity: {
            findById: sandbox.stub().resolves(opportunity),
          },
          Suggestion: {
            batchGetByKeys: sandbox.stub().resolves({ data: [suggestion] }),
            saveMany: sandbox.stub().resolves(),
          },
        },
        s3Client: { send: sandbox.stub().resolves() },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // --- Envelope validation ---

  it('returns bad request when siteId is missing', async () => {
    message = { data: message.data };
    const response = await handler(message, context);
    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('No siteId provided in message');
  });

  it('returns not found when site does not exist', async () => {
    context.dataAccess.Site.findById.resolves(null);
    const response = await handler(message, context);
    expect(response.status).to.equal(404);
    expect(response.headers.get('x-error')).to.equal('Site not found');
  });

  it('returns bad request when data is missing', async () => {
    message = { siteId };
    const response = await handler(message, context);
    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('No data provided in message');
  });

  it('returns bad request when opportunityId is missing', async () => {
    message.data = { reportBucket, reportPath };
    const response = await handler(message, context);
    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('No opportunityId provided in message data');
  });

  it('returns not found when opportunity does not exist', async () => {
    context.dataAccess.Opportunity.findById.resolves(null);
    const response = await handler(message, context);
    expect(response.status).to.equal(404);
    expect(response.headers.get('x-error')).to.equal('Opportunity not found');
  });

  it('returns bad request when opportunity does not belong to site', async () => {
    opportunity.getSiteId = () => 'other-site-id';
    const response = await handler(message, context);
    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('Site ID mismatch');
  });

  it('returns bad request when reportBucket is missing', async () => {
    message.data = { opportunityId, reportPath };
    const response = await handler(message, context);
    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('Missing reportBucket or reportPath in message data');
  });

  it('returns bad request when reportPath is missing', async () => {
    message.data = { opportunityId, reportBucket };
    const response = await handler(message, context);
    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('Missing reportBucket or reportPath in message data');
  });

  // --- S3 report reading ---

  it('returns ok when report is not found in S3', async () => {
    getObjectFromKey.resolves(null);
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No report found at/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('returns ok when S3 read throws an error', async () => {
    getObjectFromKey.rejects(new Error('Access Denied'));
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Failed to read report/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('parses report from JSON string', async () => {
    getObjectFromKey.resolves(JSON.stringify(buildStarfishReport()));
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(suggestion.setData).to.have.been.called;
  });

  it('returns ok when report JSON string is invalid', async () => {
    getObjectFromKey.resolves('not-json');
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Failed to read report/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  // --- Report-level checks ---

  it('returns ok when report status is failed', async () => {
    getObjectFromKey.resolves(buildStarfishReport({ status: 'failed', results: [] }));
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Job failed/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('returns ok when results array is empty', async () => {
    getObjectFromKey.resolves(buildStarfishReport({ results: [] }));
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/no results/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('returns ok when results is missing from report', async () => {
    const report = buildStarfishReport();
    delete report.results;
    getObjectFromKey.resolves(report);
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/no results/));
  });

  // --- Result-level filtering ---

  it('returns ok with no updates when all results are skipped or failed', async () => {
    getObjectFromKey.resolves(buildStarfishReport({
      results: [
        { suggestionId, status: 'skipped', message: 'Library not found' },
        { suggestionId: 'sugg-456', status: 'failed', message: 'Conflict' },
      ],
    }));
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith(sinon.match(/No applied results/));
    expect(context.dataAccess.Suggestion.batchGetByKeys).to.not.have.been.called;
  });

  it('skips applied result with missing diff', async () => {
    getObjectFromKey.resolves(buildStarfishReport({
      results: [{ suggestionId, status: 'applied' }],
    }));
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/has no diff/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('skips when suggestion not found in database', async () => {
    context.dataAccess.Suggestion.batchGetByKeys.resolves({ data: [] });
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Suggestion not found/));
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  // --- Happy path ---

  it('updates suggestion with diff from applied result', async () => {
    const response = await handler(message, context);
    expect(response.status).to.equal(200);
    expect(getObjectFromKey).to.have.been.calledWith(
      context.s3Client,
      reportBucket,
      reportPath,
      context.log,
    );
    expect(suggestion.setData).to.have.been.calledWith({
      some: 'data',
      patchContent: 'diff --git a/pom.xml b/pom.xml\n...',
      isCodeChangeAvailable: true,
    });
    expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([suggestion]);
  });

  it('updates multiple suggestions from one report', async () => {
    const suggestion2Id = 'sugg-456';
    const suggestion2 = {
      getId: () => suggestion2Id,
      getData: () => ({ other: 'data' }),
      setData: sandbox.stub(),
    };

    getObjectFromKey.resolves(buildStarfishReport({
      results: [
        { suggestionId, status: 'applied', diff: 'diff-1' },
        { suggestionId: suggestion2Id, status: 'applied', diff: 'diff-2' },
        { suggestionId: 'sugg-789', status: 'skipped', message: 'Not applicable' },
      ],
    }));

    context.dataAccess.Suggestion.batchGetByKeys.resolves({ data: [suggestion, suggestion2] });

    const response = await handler(message, context);
    expect(response.status).to.equal(200);

    expect(getObjectFromKey).to.have.been.calledOnce;
    expect(suggestion.setData).to.have.been.calledWith({
      some: 'data',
      patchContent: 'diff-1',
      isCodeChangeAvailable: true,
    });
    expect(suggestion2.setData).to.have.been.calledWith({
      other: 'data',
      patchContent: 'diff-2',
      isCodeChangeAvailable: true,
    });
    expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([suggestion, suggestion2]);
  });
});
