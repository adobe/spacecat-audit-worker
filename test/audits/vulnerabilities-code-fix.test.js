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
  const defaultBucketName = 'mystique-bucket';

  const buildMessage = () => ({
    siteId,
    data: {
      opportunityId,
      updates: [{
        suggestion_id: suggestionId,
        fixes: [{
          code_fix_path: 'reports/report.json',
        }],
      }],
    },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    getObjectFromKey = sandbox.stub().resolves({ diff: 'diff-content' });

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
    };

    suggestion = {
      getId: () => suggestionId,
      getData: () => ({ some: 'data' }),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
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
            findById: sandbox.stub().resolves(suggestion),
          },
        },
        s3Client: { send: sandbox.stub().resolves() },
        env: { S3_MYSTIQUE_BUCKET_NAME: defaultBucketName },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns bad request when siteId is missing', async () => {
    message = { data: message.data };

    const response = await handler(message, context);

    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('No siteId provided in message');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No siteId provided/));
  });

  it('returns not found when site does not exist', async () => {
    context.dataAccess.Site.findById.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(404);
    expect(response.headers.get('x-error')).to.equal('Site not found');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Site not found/));
  });

  it('returns bad request when data is missing', async () => {
    message = { siteId };

    const response = await handler(message, context);

    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('No data provided in message');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No data provided/));
  });

  it('returns bad request when opportunityId is missing', async () => {
    message.data = { updates: [] };

    const response = await handler(message, context);

    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('No opportunityId provided in message data');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No opportunityId/));
  });

  it('returns not found when opportunity does not exist', async () => {
    context.dataAccess.Opportunity.findById.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(404);
    expect(response.headers.get('x-error')).to.equal('Opportunity not found');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Opportunity not found/));
  });

  it('returns bad request when opportunity does not belong to site', async () => {
    opportunity.getSiteId = () => 'other-site-id';

    const response = await handler(message, context);

    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('Site ID mismatch');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Site ID mismatch/));
  });

  it('returns ok when updates are empty', async () => {
    message.data.updates = [];

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Empty updates array/));
    expect(context.dataAccess.Suggestion.findById).to.not.have.been.called;
  });

  it('skips updates when suggestionId is missing', async () => {
    message.data.updates = [{ fixes: [{ code_fix_path: 'reports/report.json' }] }];

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.dataAccess.Suggestion.findById).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No suggestionId/));
  });

  it('skips updates when suggestion is not found', async () => {
    context.dataAccess.Suggestion.findById.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Suggestion not found/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('skips updates when fixes are empty', async () => {
    message.data.updates[0].fixes = [];

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No code-fixes in update data/));
    expect(getObjectFromKey).to.not.have.been.called;
  });

  it('handles missing report data from S3', async () => {
    getObjectFromKey.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/No code change report found/));
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No code-fix report found/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('handles invalid JSON report data from S3', async () => {
    getObjectFromKey.resolves('not-json');

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Failed to parse report data as JSON/));
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No code-fix report found/));
    expect(suggestion.setData).to.not.have.been.called;
  });

  it('handles errors when fetching report data from S3', async () => {
    getObjectFromKey.rejects(new Error('S3 failure'));

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(
      sinon.match(/Error reading code change report from S3/),
      sinon.match.instanceOf(Error),
    );
    expect(context.log.error).to.have.been.calledWith(sinon.match(/No code-fix report found/));
  });

  it('applies patch data and warns for multiple fixes', async () => {
    message.data.updates[0].fixes = [
      { code_fix_path: 'reports/report-a.json', code_fix_bucket: 'custom-bucket' },
      { code_fix_path: 'reports/report-b.json' },
    ];

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/More than one code-fix/));
    expect(context.log.info).to.have.been.calledWith(sinon.match(/Successfully read code change report/));
    expect(getObjectFromKey).to.have.been.calledWith(
      context.s3Client,
      'custom-bucket',
      'reports/report-a.json',
      context.log,
    );
    expect(suggestion.setData).to.have.been.calledWith({
      some: 'data',
      patchContent: 'diff-content',
      isCodeChangeAvailable: true,
    });
    expect(suggestion.save).to.have.been.calledOnce;
  });

  it('parses report JSON strings and uses default bucket name', async () => {
    getObjectFromKey.resolves(JSON.stringify({ diff: 'json-diff' }));

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(getObjectFromKey).to.have.been.calledWith(
      context.s3Client,
      defaultBucketName,
      'reports/report.json',
      context.log,
    );
    expect(suggestion.setData).to.have.been.calledWith({
      some: 'data',
      patchContent: 'json-diff',
      isCodeChangeAvailable: true,
    });
    expect(suggestion.save).to.have.been.calledOnce;
  });
});

