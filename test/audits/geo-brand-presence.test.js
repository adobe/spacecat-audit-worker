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
import { llmoConfig } from '@adobe/spacecat-shared-utils';

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
      send: sinon.stub()
        .callsFake((cmd) => {
          const { name } = cmd.constructor;
          const input = JSON.stringify(cmd.input, null, 2).replace(/\n[ ]*/g, ' ');
          throw new Error(`no stubbed response for ${name} ${input}`)
        }),
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

    fakeConfigS3Response();

    s3Client.send
      .withArgs(matchS3Cmd('PutObjectCommand', { Key: sinon.match(/^temp[/]audit-geo-brand-presence[/]/) }))
      .resolves({});
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
    fakeParquetS3Response(fakeData());

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
      configVersion: '1.0.0',
      web_search_provider: 'chatgpt',
      url: 'https://example.com/presigned-url',
    });
  });

  it('should fall back to all providers when aiPlatform is invalid', async () => {
    // Set aiPlatform to an invalid value
    audit.getAuditResult = () => ({ aiPlatform: 'invalid-provider' });

    fakeParquetS3Response(fakeData());
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

    fakeParquetS3Response(fakeData());
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
        configVersion: '1.0.0',
        web_search_provider: provider,
        url: 'https://example.com/presigned-url',
      });
    });
  });

  it('sends customer defined prompts from the config to mystique', async () => {
    const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
    const cat2 = '2a2f9b39-126b-411e-af0b-ad2a48dfd9b1';

    fakeParquetS3Response(fakeData());
    fakeConfigS3Response({
      ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Category 1', region: ['ch', 'de', 'fr', 'it'] },
          [cat2]: { name: 'Category 2', region: 'es' },
        },
        topics: {
        'f1a9605a-5a05-49e7-8760-b40ca2426380': {
          name: 'Topic 1',
          category: cat1,
          prompts: [
            {prompt: 'custom prompt 1', regions: ['de'], origin: 'human', source: 'config' },
            {prompt: 'custom prompt 2', regions: ['it'], origin: 'human', source: 'config' },
            {prompt: 'custom prompt 3', regions: ['ch', 'fr'], origin: 'human', source: 'config' },
          ],
        },
        '49db7cbc-326f-437f-bedc-e4b7b33ac220': {
          name: 'Topic 2',
          category: cat2,
          prompts: [
            {prompt: 'custom prompt 4', regions: ['es'], origin: 'human', source: 'config' },
          ],
        },
      }
    });

    getPresignedUrl.resolves('https://example.com/presigned-url');

    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    expect(s3Client.send).calledWith(
        matchS3Cmd('PutObjectCommand', {
          Body: sinon.match((json) =>
            sinon.match([
              customPrompt({ prompt: 'custom prompt 1', region: 'de', category: 'Category 1', topic: 'Topic 1' }),
              customPrompt({ prompt: 'custom prompt 2', region: 'it', category: 'Category 1', topic: 'Topic 1' }),
              customPrompt({ prompt: 'custom prompt 3', region: 'ch,fr', category: 'Category 1', topic: 'Topic 1' }),
              customPrompt({ prompt: 'custom prompt 4', region: 'es', category: 'Category 2', topic: 'Topic 2' }),
            ]).test(JSON.parse(json).slice(-4)))
        })
      );
  });

  it('should skip sending message to Mystique when no keywordQuestions', async () => {
    fakeParquetS3Response([]);
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

    fakeParquetS3Response(fakeData());
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
      'GEO BRAND PRESENCE: Invalid calendarWeek in auditContext for site id %s (%s). Cannot send data to Mystique',
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
      'GEO BRAND PRESENCE: Invalid calendarWeek in auditContext for site id %s (%s). Cannot send data to Mystique',
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

  /**
   * Mocks the S3 GetObjectCommand response for the LLMO config file
   * @param {import('@adobe/spacecat-shared-utils/src/schemas.js').LLMOConfig} [config]
   */
  function fakeConfigS3Response(config = llmoConfig.defaultConfig()) {
    s3Client.send.withArgs(
      matchS3Cmd(
        'GetObjectCommand',
        { Key: llmoConfig.llmoConfigPath(site.getId()) },
      ),
    ).resolves({
      Body: {
        async transformToString() {
          return JSON.stringify(config);
        },
      },
      VersionId: '1.0.0', // This is where the version comes from in llmoConfig.readConfig()
    });
  }

  function fakeParquetS3Response(response) {
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

    s3Client.send.withArgs(
      matchS3Cmd(
        'GetObjectCommand',
        { Key: sinon.match(/[/]data[.]parquet$/) },
      ),
    ).resolves({
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

/**
 * @param {"GetObjectCommand" | "PutObjectCommand"} name
 * @param {Record<string, any>} input
 */
function matchS3Cmd(name, input) {
  return sinon.match({
    constructor: sinon.match({ name }),
    input: sinon.match(input),
  });
}

function customPrompt({ prompt, region, category, topic }) {
  return {
    prompt,
    region,
    category,
    topic,
    url: '',
    keyword: '',
    keywordImportTime: -1,
    volume: -1,
    volumeImportTime: -1,
    source: 'human',
    market: region,
    origin: 'human'
  };
}

/**
 * @param {sinon.SinonSpy} spy
 * @param {sinon.SinonMatcher} matcher
 * @returns {undefined | sinon.SinonSpyCall}
 */
function findCall(spy, matcher) {
  for (let i = 0; i < spy.callCount; i += 1) {
    const call = spy.getCall(i);
    if (matcher.test(call)) {
      return call;
    }
  }
  return undefined;
}
