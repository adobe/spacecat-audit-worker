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
import { llmoConfig } from '@adobe/spacecat-shared-utils';

use(sinonChai);

describe('Geo Brand Presence Daily Handler', () => {
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
      getAuditType: () => 'geo-brand-presence-daily',
      getFullAuditRef: () => 'https://adobe.com',
      getAuditResult: () => ({ aiPlatform: 'chatgpt', cadence: 'daily' }),
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
      .withArgs(matchS3Cmd('PutObjectCommand', { Key: sinon.match(/^temp[/]audit-geo-brand-presence-daily[/]/) }))
      .resolves({});
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should run the keywordPromptsImport step with cadence: daily', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl, brandPresenceCadence: 'daily' };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: undefined,
      auditResult: { keywordQuestions: [], aiPlatform: undefined, cadence: 'daily' },
      fullAuditRef: finalUrl,
    });
  });

  it('passes on a string date in ctx.data', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl, data: '2025-10-01', brandPresenceCadence: 'daily' };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: '2025-10-01',
      auditResult: { keywordQuestions: [], aiPlatform: undefined, cadence: 'daily' },
      fullAuditRef: finalUrl,
    });
  });

  it('ignores non-date values in ctx.data', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl, data: 'not a parseable date', brandPresenceCadence: 'daily' };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: undefined,
      auditResult: { keywordQuestions: [], aiPlatform: undefined, cadence: 'daily' },
      fullAuditRef: finalUrl,
    });
  });

  it('parses JSON data with valid endDate and aiPlatform', async () => {
    const finalUrl = 'https://adobe.com';
    const jsonData = JSON.stringify({
      endDate: '2025-10-01',
      aiPlatform: 'gemini',
    });
    const ctx = { ...context, finalUrl, data: jsonData, brandPresenceCadence: 'daily' };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: '2025-10-01',
      auditResult: { keywordQuestions: [], aiPlatform: 'gemini', cadence: 'daily' },
      fullAuditRef: finalUrl,
    });
    expect(log.debug).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s',
      finalUrl,
      '2025-10-01',
      'gemini',
    );
  });

  it('handles JSON parsing failure and falls back to legacy date parsing', async () => {
    const finalUrl = 'https://adobe.com';
    const invalidJson = '{ invalid json data';
    const ctx = { ...context, finalUrl, data: invalidJson, brandPresenceCadence: 'daily' };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: undefined,
      auditResult: { keywordQuestions: [], aiPlatform: undefined, cadence: 'daily' },
      fullAuditRef: finalUrl,
    });
    expect(log.warn).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Could not parse data as JSON or date string: %s',
      invalidJson,
    );
    expect(log.debug).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s',
      finalUrl,
      undefined,
      undefined,
    );
  });

  it('should send daily message to Mystique with date field', async () => {
    // Mock S3 client method used by getStoredMetrics (AWS SDK v3 style)
    fakeParquetS3Response(fakeData());

    getPresignedUrl.resolves('https://example.com/presigned-url');

    const referenceDate = new Date('2025-10-02T12:00:00Z'); // October 2, 2025

    await sendToMystique({
      ...context,
      brandPresenceCadence: 'daily',
      auditContext: {
        referenceDate,
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [queue, message] = sqs.sendMessage.firstCall.args;
    expect(queue).to.equal('spacecat-to-mystique');
    expect(message).to.include({
      type: 'detect:geo-brand-presence-daily',
      siteId: site.getId(),
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
    });

    // Verify daily-specific fields
    expect(message.week).to.be.a('number');
    expect(message.year).to.be.a('number');
    expect(message.data).to.deep.equal({
      config_version: null,
      configVersion: null,
      web_search_provider: 'chatgpt',
      url: 'https://example.com/presigned-url',
      date: '2025-10-01', // Yesterday from reference date
    });
  });

  it('should calculate correct ISO week for dates at year boundaries', async () => {
    fakeParquetS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    // Test December 30, 2024 (Monday of Week 1, 2025)
    const referenceDate = new Date('2024-12-31T12:00:00Z');

    await sendToMystique({
      ...context,
      brandPresenceCadence: 'daily',
      auditContext: {
        referenceDate,
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.data.date).to.equal('2024-12-30'); // Yesterday
    expect(message.week).to.equal(1); // ISO week 1
    expect(message.year).to.equal(2025); // ISO year 2025 (even though calendar year is 2024)
  });

  it('should skip sending message to Mystique when no keywordQuestions', async () => {
    fakeParquetS3Response([]);
    await sendToMystique({
      ...context,
      brandPresenceCadence: 'daily',
      auditContext: {
        referenceDate: new Date('2025-10-02T12:00:00Z'),
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('should use current date when referenceDate is not provided', async () => {
    fakeParquetS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    await sendToMystique({
      ...context,
      brandPresenceCadence: 'daily',
      auditContext: {
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;

    // Verify date is yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expectedDate = yesterday.toISOString().split('T')[0];

    expect(message.data.date).to.equal(expectedDate);
    expect(message.week).to.be.a('number');
    expect(message.year).to.be.a('number');
  });

  it('should send messages for all providers when aiPlatform is not specified', async () => {
    // Remove aiPlatform from audit result
    audit.getAuditResult = () => ({ cadence: 'daily' });

    fakeParquetS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    const referenceDate = new Date('2025-10-02T12:00:00Z');

    await sendToMystique({
      ...context,
      brandPresenceCadence: 'daily',
      auditContext: {
        referenceDate,
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Import WEB_SEARCH_PROVIDERS to get the count
    const { WEB_SEARCH_PROVIDERS } = await import('../../src/geo-brand-presence/handler.js');

    // Should send one message per provider
    expect(sqs.sendMessage).to.have.callCount(WEB_SEARCH_PROVIDERS.length);

    // Verify each message has the correct provider and daily-specific fields
    const providers = new Set();
    for (let i = 0; i < sqs.sendMessage.callCount; i += 1) {
      const [queue, message] = sqs.sendMessage.getCall(i).args;
      expect(queue).to.equal('spacecat-to-mystique');
      expect(message.type).to.equal('detect:geo-brand-presence-daily');
      expect(message.data.date).to.equal('2025-10-01');
      expect(message.data.configVersion).to.equal(null);
      expect(message.data.web_search_provider).to.be.a('string');
      providers.add(message.data.web_search_provider);
    }

    // Verify all unique providers were used
    expect(providers.size).to.equal(WEB_SEARCH_PROVIDERS.length);
  });

  it('should send only one message per provider when aiPlatform is specified for daily', async () => {
    // aiPlatform is already set to 'chatgpt' in beforeEach
    fakeParquetS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    const referenceDate = new Date('2025-10-02T12:00:00Z');

    await sendToMystique({
      ...context,
      brandPresenceCadence: 'daily',
      auditContext: {
        referenceDate,
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Should send only one message since aiPlatform is 'chatgpt'
    expect(sqs.sendMessage).to.have.been.calledOnce;

    const [queue, message] = sqs.sendMessage.firstCall.args;
    expect(queue).to.equal('spacecat-to-mystique');
    expect(message.type).to.equal('detect:geo-brand-presence-daily');
    expect(message.data).to.deep.equal({
      configVersion: null,
      web_search_provider: 'chatgpt',
      config_version: null,
      url: 'https://example.com/presigned-url',
      date: '2025-10-01',
    });
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
        volumeImportTime: new Date('2025-10-01T14:00:00.000Z'),
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
        volumeImportTime: new Date('2025-10-01T14:00:00.000Z'),
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
        volumeImportTime: new Date('2025-10-01T14:00:00.000Z'),
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
