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
import { keywordQuestionsImportStep, sendToMystique } from '../../src/geo-brand-presence/handler.js';

use(sinonChai);

describe('Geo Brand Presence Handler', () => {
  let context;
  let sandbox;
  let site;
  let audit;
  let log;
  let sqs;
  let env;
  let s3Client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    site = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-id-123',
      getDeliveryType: () => 'geo_edge',
    };
    audit = {
      getId: () => 'audit-id-456',
      getAuditType: () => 'geo-brand-presence',
      getFullAuditRef: () => 'https://adobe.com',
    };
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    sqs = {
      sendMessage: sandbox.stub().resolves({}),
    };
    env = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
      S3_IMPORTER_BUCKET_NAME: 'bucket',
    };
    s3Client = {};
    context = {
      log,
      sqs,
      env,
      site,
      audit,
      s3Client,
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should run the keywordQuestions Import step', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl };
    const result = await keywordQuestionsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'organic-keywords-questions',
      siteId: site.getId(),
      auditResult: { keywordQuestions: [] },
      fullAuditRef: finalUrl,
    });
  });

  it('should send message to Mystique when keywordQuestions are found', async () => {
    // Mock S3 client method used by getStoredMetrics (AWS SDK v3 style)
    context.s3Client.send = sinon.stub().resolves({
      Body: {
        async transformToString() {
          return JSON.stringify([
            {
              keyword: 'adobe',
              questions: ['what is adobe?', 'adobe pricing'],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:00:00Z',
              volume: 1000,
            },
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              importTime: '2024-05-01T00:00:00Z',
              volume: 2000,
            },
            {
              keyword: 'photoshop',
              questions: ['how to use photoshop?'],
              url: 'https://adobe.com/page2',
              importTime: '2024-06-02T00:00:00Z',
              volume: 5000,
            },
            // This entry should be filtered out (no questions)
            {
              keyword: 'illustrator',
              questions: [],
              url: 'https://adobe.com/page3',
              importTime: '2024-06-03T00:00:00Z',
              volume: 3000,
            },
          ]);
        },
      },
    });

    await sendToMystique(context);
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [queue, message] = sqs.sendMessage.firstCall.args;
    expect(queue).to.equal('spacecat-to-mystique');
    expect(message).to.include({
      type: 'detect:geo-brand-presence',
      siteId: site.getId(),
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
    });
    expect(message.data.keywordQuestions).to.deep.equal([
      {
        keyword: 'adobe',
        q: ['what is adobe?', 'adobe pricing'],
        pageUrl: 'https://adobe.com/page1',
        importTime: '2024-06-01T00:00:00Z',
        volume: 1000,
      },
      {
        keyword: 'photoshop',
        q: ['how to use photoshop?'],
        pageUrl: 'https://adobe.com/page2',
        importTime: '2024-06-02T00:00:00Z',
        volume: 5000,
      },
    ]);
  });

  it('should skip sending message to Mystique when no keywordQuestions', async () => {
    context.s3Client.send = sinon.stub().resolves({
      Body: {
        async transformToString() {
          return JSON.stringify([
            {
              keyword: 'adobe',
              questions: [],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:00:00Z',
              volume: 1000,
            },
            {
              keyword: 'photoshop',
              questions: undefined,
              url: 'https://adobe.com/page2',
              importTime: '2024-06-02T00:00:00Z',
              volume: 2000,
            },
          ]);
        },
      },
    });
    await sendToMystique(context);
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('prefers the later importTime if it comes first', async () => {
    context.s3Client.send = sinon.stub().resolves({
      Body: {
        async transformToString() {
          return JSON.stringify([
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:01:00Z',
              volume: 1234,
            },
            {
              keyword: 'photoshop',
              questions: ['how to use photoshop?'],
              url: 'https://adobe.com/page2',
              importTime: '2024-06-02T00:00:00Z',
              volume: 4000,
            },
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:00:00Z',
              volume: 5678.0,
            },
          ]);
        },
      },
    });

    await sendToMystique(context);
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.data.keywordQuestions).to.deep.equal([
      {
        keyword: 'adobe',
        q: ['what is adobe?'],
        pageUrl: 'https://adobe.com/page1',
        importTime: '2024-06-01T00:01:00Z',
        volume: 1234,
      },
      {
        keyword: 'photoshop',
        q: ['how to use photoshop?'],
        pageUrl: 'https://adobe.com/page2',
        importTime: '2024-06-02T00:00:00Z',
        volume: 4000,
      },
    ]);
  });

  it('prefers the later importTime if it comes later', async () => {
    context.s3Client.send = sinon.stub().resolves({
      Body: {
        async transformToString() {
          return JSON.stringify([
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:00:00Z',
              volume: 1234,
            },
            {
              keyword: 'photoshop',
              questions: ['how to use photoshop?'],
              url: 'https://adobe.com/page2',
              importTime: '2024-06-02T00:00:00Z',
              volume: 4000,
            },
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:01:00Z',
              volume: 5678,
            },
          ]);
        },
      },
    });

    await sendToMystique(context);
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.data.keywordQuestions).to.deep.equal([
      {
        keyword: 'adobe',
        q: ['what is adobe?'],
        pageUrl: 'https://adobe.com/page1',
        importTime: '2024-06-01T00:01:00Z',
        volume: 5678,
      },
      {
        keyword: 'photoshop',
        q: ['how to use photoshop?'],
        pageUrl: 'https://adobe.com/page2',
        importTime: '2024-06-02T00:00:00Z',
        volume: 4000,
      },
    ]);
  });

  it('does not replace an earlier importTime if the later record has no importTime', async () => {
    context.s3Client.send = sinon.stub().resolves({
      Body: {
        async transformToString() {
          return JSON.stringify([
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:00:00Z',
              volume: 1234,
            },
            {
              keyword: 'photoshop',
              questions: ['how to use photoshop?'],
              url: 'https://adobe.com/page2',
              importTime: '2024-06-02T00:00:00Z',
              volume: 4000,
            },
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              // no importTime
              volume: 5678,
            },
          ]);
        },
      },
    });

    await sendToMystique(context);
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.data.keywordQuestions).to.deep.equal([
      {
        keyword: 'adobe',
        q: ['what is adobe?'],
        pageUrl: 'https://adobe.com/page1',
        importTime: '2024-06-01T00:00:00Z',
        volume: 1234,
      },
      {
        keyword: 'photoshop',
        q: ['how to use photoshop?'],
        pageUrl: 'https://adobe.com/page2',
        importTime: '2024-06-02T00:00:00Z',
        volume: 4000,
      },
    ]);
  });

  it('replaces a record without importTime if a later record has one', async () => {
    context.s3Client.send = sinon.stub().resolves({
      Body: {
        async transformToString() {
          return JSON.stringify([
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              // no importTime
              volume: 1234,
            },
            {
              keyword: 'photoshop',
              questions: ['how to use photoshop?'],
              url: 'https://adobe.com/page2',
              importTime: '2024-06-02T00:00:00Z',
              volume: 4000,
            },
            {
              keyword: 'adobe',
              questions: ['what is adobe?'],
              url: 'https://adobe.com/page1',
              importTime: '2024-06-01T00:00:00Z',
              volume: 5678,
            },
          ]);
        },
      },
    });

    await sendToMystique(context);
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.data.keywordQuestions).to.deep.equal([
      {
        keyword: 'adobe',
        q: ['what is adobe?'],
        pageUrl: 'https://adobe.com/page1',
        importTime: '2024-06-01T00:00:00Z',
        volume: 5678,
      },
      {
        keyword: 'photoshop',
        q: ['how to use photoshop?'],
        pageUrl: 'https://adobe.com/page2',
        importTime: '2024-06-02T00:00:00Z',
        volume: 4000,
      },
    ]);
  });
});
