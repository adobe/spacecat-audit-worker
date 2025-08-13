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
/* eslint-disable no-use-before-define */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { keywordPromptsImportStep, sendToMystique } from '../../src/geo-brand-presence/handler.js';

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
    log = sinon.stub({ ...console });
    sqs = {
      sendMessage: sandbox.stub().resolves({}),
    };
    env = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
      S3_IMPORTER_BUCKET_NAME: 'bucket',
    };
    s3Client = {
      send: sinon.stub().throws(new Error('no stubbed response')),
    };
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

  it('should run the keywordPromptsImport step', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: undefined,
      auditResult: { keywordQuestions: [] },
      fullAuditRef: finalUrl,
    });
  });

  it('passes on a string date in ctx.data', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl, data: '2025-08-13' };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: '2025-08-13',
      auditResult: { keywordQuestions: [] },
      fullAuditRef: finalUrl,
    });
  });

  it('ignores non-date values in in ctx.data', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl, data: 'not a parseable date' };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: undefined,
      auditResult: { keywordQuestions: [] },
      fullAuditRef: finalUrl,
    });
  });

  it('should send message to Mystique for all opportunity types when keywordQuestions are found', async () => {
    // Mock S3 client method used by getStoredMetrics (AWS SDK v3 style)
    fakeS3Response(fakeData());

    await sendToMystique({ ...context, auditContext: { parquetFiles: ['some/parquet/file/data.parquet'] } });
    // two messages are sent to Mystique, one for brand presence and one for faq
    expect(sqs.sendMessage).to.have.been.calledTwice;
    const [brandPresenceQueue, brandPresenceMessage] = sqs.sendMessage.firstCall.args;
    expect(brandPresenceQueue).to.equal('spacecat-to-mystique');
    expect(brandPresenceMessage).to.include({
      type: 'detect:geo-brand-presence',
      siteId: site.getId(),
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
    });

    const expectedPrompts = fakeData((x) => ({ ...x, market: x.region, origin: x.source }));
    expect(brandPresenceMessage.data.prompts).to.deep.equal(expectedPrompts);

    const [faqQueue, faqMessage] = sqs.sendMessage.secondCall.args;
    expect(faqQueue).to.equal('spacecat-to-mystique');
    expect(faqMessage).to.include({
      type: 'guidance:geo-faq',
      siteId: site.getId(),
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
    });
    expect(faqMessage.data.prompts).to.deep.equal(expectedPrompts);
  });

  it('should skip sending message to Mystique when no keywordQuestions', async () => {
    fakeS3Response([]);
    await sendToMystique({ ...context, auditContext: { parquetFiles: ['some/parquet/file/data.parquet'] } });
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  function fakeS3Response(response) {
    const columnData = {
      prompt: { data: [], name: 'prompt', type: 'STRING' },
      region: { data: [], name: 'region', type: 'STRING' },
      category: { data: [], name: 'category', type: 'STRING' },
      topic: { data: [], name: 'topic', type: 'STRING' },
      url: { data: [], name: 'url', type: 'STRING' },
      keyword: { data: [], name: 'keyword', type: 'STRING' },
      keywordImportTime: { data: [], name: 'keywordImportTime', type: 'TIMESTAMP' },
      volume: { data: [], name: 'volume', type: 'INT32' },
      volumeImportTime: { data: [], name: 'volumeImportTime', type: 'TIMESTAMP' },
      source: { data: [], name: 'source', type: 'STRING' },
    };
    const keys = Object.keys(columnData);
    for (const x of response) {
      for (const key of keys) {
        columnData[key].data.push(x[key]);
      }
    }

    const buffer = parquetWriteBuffer({ columnData: Object.values(columnData) });

    s3Client.send.resolves({
      Body: {
        async transformToByteArray() {
          return new Uint8Array(buffer);
        },
      },
    });
  }

  function fakeData(mapFn) {
    const data = [
      {
        prompt: 'what is adobe?',
        region: 'us',
        category: 'adobe',
        topic: 'general',
        url: 'https://adobe.com/page1',
        keyword: 'adobe',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 1000,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      },
      {
        prompt: 'adobe pricing',
        region: 'us',
        category: 'adobe',
        topic: 'pricing',
        url: 'https://adobe.com/page1',
        keyword: 'adobe',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 1000,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      },
      {
        prompt: 'how to use photoshop?',
        region: 'us',
        category: 'photoshop',
        topic: 'usage',
        url: 'https://adobe.com/page2',
        keyword: 'photoshop',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 5000,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      },
      {
        prompt: 'is illustrator better than photoshop?',
        region: 'us',
        category: 'illustrator',
        topic: 'product comparison',
        url: 'https://adobe.com/page3',
        keyword: 'illustrator',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 3000,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      },
      {
        prompt: 'where can i learn how to use illustrator?',
        region: 'us',
        category: 'illustrator',
        topic: 'usage',
        url: 'https://adobe.com/page3',
        keyword: 'illustrator',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 3000,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      },
    ];

    return mapFn ? data.map(mapFn) : data;
  }
});
