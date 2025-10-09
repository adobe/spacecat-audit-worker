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
import { keywordPromptsImportStep, sendToMystique, WEB_SEARCH_PROVIDERS } from '../../src/geo-brand-presence/handler.js';

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
  let getPresignedUrl;

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
      getAuditResult: () => ({ aiPlatform: 'chatgpt' }),
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
    getPresignedUrl = sandbox.stub();
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
      auditResult: { keywordQuestions: [], aiPlatform: undefined },
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
      auditResult: { keywordQuestions: [], aiPlatform: undefined },
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
      auditResult: { keywordQuestions: [], aiPlatform: undefined },
      fullAuditRef: finalUrl,
    });
  });

  it('parses JSON data with valid endDate and aiPlatform', async () => {
    const finalUrl = 'https://adobe.com';
    const jsonData = JSON.stringify({
      endDate: '2025-09-15',
      aiPlatform: 'gemini',
    });
    const ctx = { ...context, finalUrl, data: jsonData };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: '2025-09-15',
      auditResult: { keywordQuestions: [], aiPlatform: 'gemini' },
      fullAuditRef: finalUrl,
    });
    expect(log.info).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s',
      finalUrl,
      '2025-09-15',
      'gemini',
    );
  });

  it('handles JSON parsing failure and falls back to legacy date parsing', async () => {
    const finalUrl = 'https://adobe.com';
    const invalidJson = '{ invalid json data';
    const ctx = { ...context, finalUrl, data: invalidJson };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: undefined,
      auditResult: { keywordQuestions: [], aiPlatform: undefined },
      fullAuditRef: finalUrl,
    });
    expect(log.warn).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Could not parse data as JSON or date string: %s',
      invalidJson,
    );
    expect(log.info).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s',
      finalUrl,
      undefined,
      undefined,
    );
  });

  it('should send message to Mystique using aiPlatform when provided', async () => {
    // Mock S3 client method used by getStoredMetrics (AWS SDK v3 style)
    fakeS3Response(fakeData());

    getPresignedUrl.resolves('https://example.com/presigned-url');

    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);
    // When aiPlatform is provided (chatgpt), only one message is sent per opportunity type
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [brandPresenceQueue, brandPresenceMessage] = sqs.sendMessage.firstCall.args;
    expect(brandPresenceQueue).to.equal('spacecat-to-mystique');
    expect(brandPresenceMessage).to.include({
      type: 'detect:geo-brand-presence',
      siteId: site.getId(),
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
    });
    expect(brandPresenceMessage.data).deep.equal({
      web_search_provider: 'chatgpt',
      url: 'https://example.com/presigned-url',
    });
  });

  it('should fall back to all providers when aiPlatform is invalid', async () => {
    // Set aiPlatform to an invalid value
    audit.getAuditResult = () => ({ aiPlatform: 'invalid-provider' });
    
    fakeS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Should send messages for all providers since 'invalid-provider' is not in WEB_SEARCH_PROVIDERS
    expect(sqs.sendMessage).to.have.callCount(WEB_SEARCH_PROVIDERS.length);
  });

  // TODO(aurelio): check that we write the right file to s3
  it('should send messages to Mystique for all web search providers when no aiPlatform is provided', async () => {
    // Remove aiPlatform from audit result
    audit.getAuditResult = () => ({});
    
    fakeS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Should send messages equal to the number of configured providers
    expect(sqs.sendMessage).to.have.callCount(WEB_SEARCH_PROVIDERS.length);
    
    // Verify each message has the correct provider
    WEB_SEARCH_PROVIDERS.forEach((provider, index) => {
      const [queue, message] = sqs.sendMessage.getCall(index).args;
      expect(queue).to.equal('spacecat-to-mystique');
      expect(message).to.include({
        type: 'detect:geo-brand-presence',
        siteId: site.getId(),
        url: site.getBaseURL(),
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
      });
      expect(message.data).deep.equal({
        web_search_provider: provider,
        url: 'https://example.com/presigned-url',
      });
    });
  });

  it('should skip sending message to Mystique when no keywordQuestions', async () => {
    fakeS3Response([]);
    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('should skip sending message to Mystique when aiPlatform is undefined (simulating empty providers)', async () => {
    // Set aiPlatform to undefined to simulate empty provider scenario
    audit.getAuditResult = () => ({ aiPlatform: undefined });
    
    fakeS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    // Temporarily empty the providers array
    const originalProviders = [...WEB_SEARCH_PROVIDERS];
    WEB_SEARCH_PROVIDERS.splice(0, WEB_SEARCH_PROVIDERS.length);

    try {
      await sendToMystique({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(
        'GEO BRAND PRESENCE: No web search providers configured for site id %s (%s), skipping message to mystique',
        site.getId(),
        site.getBaseURL(),
      );
    } finally {
      // Restore original providers
      WEB_SEARCH_PROVIDERS.push(...originalProviders);
    }
  });

  it('should skip sending message to Mystique when success is false', async () => {
    await sendToMystique({
      ...context,
      auditContext: {
        success: false,
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    expect(sqs.sendMessage).to.not.have.been.called;
    expect(log.error).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Received the following errors for site id %s (%s). Cannot send data to Mystique',
      site.getId(),
      site.getBaseURL(),
      sinon.match.object,
    );
  });

  it('should skip sending message to Mystique when calendarWeek is invalid', async () => {
    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: null,
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    expect(sqs.sendMessage).to.not.have.been.called;
    expect(log.error).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Invalid date context for site id %s (%s). Cannot send data to Mystique',
      site.getId(),
      site.getBaseURL(),
      sinon.match.object,
    );
  });

  it('should skip sending message to Mystique when calendarWeek is missing week', async () => {
    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    expect(sqs.sendMessage).to.not.have.been.called;
    expect(log.error).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Invalid date context for site id %s (%s). Cannot send data to Mystique',
      site.getId(),
      site.getBaseURL(),
      sinon.match.object,
    );
  });

  it('should skip sending message to Mystique when parquetFiles is invalid', async () => {
    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: 'not-an-array',
      },
    }, getPresignedUrl);

    expect(sqs.sendMessage).to.not.have.been.called;
    expect(log.error).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Invalid parquetFiles in auditContext for site id %s (%s). Cannot send data to Mystique',
      site.getId(),
      site.getBaseURL(),
      sinon.match.object,
    );
  });

  it('should skip sending message to Mystique when parquetFiles contains non-strings', async () => {
    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['valid.parquet', 123, 'another.parquet'],
      },
    }, getPresignedUrl);

    expect(sqs.sendMessage).to.not.have.been.called;
    expect(log.error).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Invalid parquetFiles in auditContext for site id %s (%s). Cannot send data to Mystique',
      site.getId(),
      site.getBaseURL(),
      sinon.match.object,
    );
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
