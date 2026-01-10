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
import chaiAsPromised from 'chai-as-promised';
import handler from '../../../src/seo-indexability-check/handler.js';
import * as validators from '../../../src/seo-indexability-check/validators.js';
import * as responseSender from '../../../src/seo-indexability-check/response-sender.js';

use(sinonChai);
use(chaiAsPromised);

describe('SEO Indexability Check - Handler', () => {
  let sandbox;
  let context;
  let sqs;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sqs = {
      sendMessage: sandbox.stub().resolves(),
    };

    context = {
      log: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
      sqs,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url',
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('validates URLs and sends results to Mystique', async () => {
    const message = {
      type: 'tech-check:seo-indexability',
      siteId: 'site-123',
      auditId: 'audit-456',
      requestId: 'req-789',
      data: {
        urls: [
          {
            url: 'https://example.com/clean',
            primaryKeyword: 'test keyword',
            position: 8,
            trafficValue: 1200,
            intent: 'commercial',
          },
          {
            url: 'https://example.com/blocked',
            primaryKeyword: 'blocked keyword',
            position: 15,
            trafficValue: 800,
            intent: 'transactional',
          },
        ],
      },
    };

    const validationResults = [
      {
        url: 'https://example.com/clean',
        primaryKeyword: 'test keyword',
        position: 8,
        trafficValue: 1200,
        intent: 'commercial',
        indexable: true,
        checks: {
          httpStatus: { passed: true, statusCode: 200 },
          redirects: { passed: true, redirectCount: 0 },
          canonical: { passed: true, isSelfReferencing: true },
          noindex: { passed: true, hasNoindexHeader: false },
        },
        blockers: [],
      },
      {
        url: 'https://example.com/blocked',
        primaryKeyword: 'blocked keyword',
        position: 15,
        trafficValue: 800,
        intent: 'transactional',
        indexable: false,
        checks: {
          httpStatus: { passed: true, statusCode: 200 },
          redirects: { passed: false, redirectCount: 3 },
          canonical: { passed: true, isSelfReferencing: true },
          noindex: { passed: false, hasNoindexHeader: true },
        },
        blockers: ['redirect-chain', 'noindex'],
      },
    ];

    sandbox.stub(validators, 'validateUrls').resolves(validationResults);
    sandbox.stub(responseSender, 'sendValidationResults').resolves();

    const response = await handler(message, context);

    expect(validators.validateUrls).to.have.been.calledOnceWith(message.data.urls, context);
    expect(responseSender.sendValidationResults).to.have.been.calledOnce;

    const sendArgs = responseSender.sendValidationResults.getCall(0).args[0];
    expect(sendArgs.siteId).to.equal('site-123');
    expect(sendArgs.requestId).to.equal('req-789');
    expect(sendArgs.cleanUrls).to.have.lengthOf(1);
    expect(sendArgs.blockedUrls).to.have.lengthOf(1);

    expect(response.statusCode).to.equal(200);
    expect(response.body).to.deep.equal({
      processed: 2,
      clean: 1,
      blocked: 1,
    });

    expect(context.log.info).to.have.been.calledWith('Received tech-check:seo-indexability request: 2 URLs from siteId=site-123, requestId=req-789');
    expect(context.log.info).to.have.been.calledWith('Validation complete: 1 clean, 1 blocked');
  });

  it('handles all clean URLs', async () => {
    const message = {
      siteId: 'site-123',
      requestId: 'req-789',
      data: {
        urls: [
          { url: 'https://example.com/page1', primaryKeyword: 'keyword1' },
          { url: 'https://example.com/page2', primaryKeyword: 'keyword2' },
        ],
      },
    };

    const validationResults = [
      {
        url: 'https://example.com/page1',
        indexable: true,
        checks: {},
        blockers: [],
      },
      {
        url: 'https://example.com/page2',
        indexable: true,
        checks: {},
        blockers: [],
      },
    ];

    sandbox.stub(validators, 'validateUrls').resolves(validationResults);
    sandbox.stub(responseSender, 'sendValidationResults').resolves();

    const response = await handler(message, context);

    expect(response.body.clean).to.equal(2);
    expect(response.body.blocked).to.equal(0);
  });

  it('handles all blocked URLs', async () => {
    const message = {
      siteId: 'site-123',
      requestId: 'req-789',
      data: {
        urls: [
          { url: 'https://example.com/page1', primaryKeyword: 'keyword1' },
          { url: 'https://example.com/page2', primaryKeyword: 'keyword2' },
        ],
      },
    };

    const validationResults = [
      {
        url: 'https://example.com/page1',
        indexable: false,
        checks: {},
        blockers: ['http-error'],
      },
      {
        url: 'https://example.com/page2',
        indexable: false,
        checks: {},
        blockers: ['redirect-chain'],
      },
    ];

    sandbox.stub(validators, 'validateUrls').resolves(validationResults);
    sandbox.stub(responseSender, 'sendValidationResults').resolves();

    const response = await handler(message, context);

    expect(response.body.clean).to.equal(0);
    expect(response.body.blocked).to.equal(2);
    expect(context.log.info).to.have.been.calledWith(sinon.match(/Blocker summary:/));
  });

  it('logs blocker summary for blocked URLs', async () => {
    const message = {
      siteId: 'site-123',
      requestId: 'req-789',
      data: {
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
          { url: 'https://example.com/page3' },
        ],
      },
    };

    const validationResults = [
      {
        url: 'https://example.com/page1',
        indexable: false,
        blockers: ['http-error'],
      },
      {
        url: 'https://example.com/page2',
        indexable: false,
        blockers: ['redirect-chain', 'noindex'],
      },
      {
        url: 'https://example.com/page3',
        indexable: false,
        blockers: ['redirect-chain'],
      },
    ];

    sandbox.stub(validators, 'validateUrls').resolves(validationResults);
    sandbox.stub(responseSender, 'sendValidationResults').resolves();

    await handler(message, context);

    const blockerSummaryCall = context.log.info.getCalls().find(
      (call) => call.args[0].includes('Blocker summary:'),
    );
    expect(blockerSummaryCall).to.exist;
    const summary = JSON.parse(blockerSummaryCall.args[0].split('Blocker summary: ')[1]);
    expect(summary).to.deep.equal({
      'http-error': 1,
      'redirect-chain': 2,
      noindex: 1,
    });
  });
});

