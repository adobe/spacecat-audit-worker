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
import { keywordPromptsImportStep, sendToMystique } from '../../src/geo-brand-presence-daily/handler.js';

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

  it('should run the keywordPromptsImport step with cadence: daily', async () => {
    const finalUrl = 'https://adobe.com';
    const ctx = { ...context, finalUrl };
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
    const ctx = { ...context, finalUrl, data: '2025-10-01' };
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
    const ctx = { ...context, finalUrl, data: 'not a parseable date' };
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
    const ctx = { ...context, finalUrl, data: jsonData };
    const result = await keywordPromptsImportStep(ctx);
    expect(result).to.deep.equal({
      type: 'llmo-prompts-ahrefs',
      siteId: site.getId(),
      endDate: '2025-10-01',
      auditResult: { keywordQuestions: [], aiPlatform: 'gemini', cadence: 'daily' },
      fullAuditRef: finalUrl,
    });
    expect(log.info).to.have.been.calledWith(
      'GEO BRAND PRESENCE DAILY: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s',
      finalUrl,
      '2025-10-01',
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
      auditResult: { keywordQuestions: [], aiPlatform: undefined, cadence: 'daily' },
      fullAuditRef: finalUrl,
    });
    expect(log.error).to.have.been.calledWith(
      'GEO BRAND PRESENCE DAILY: failed to parse %s as JSON',
      invalidJson,
      sinon.match.instanceOf(Error),
    );
    expect(log.info).to.have.been.calledWith(
      'GEO BRAND PRESENCE DAILY: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s',
      finalUrl,
      undefined,
      undefined,
    );
  });

  it('should send daily message to Mystique with date field', async () => {
    // Mock S3 client method used by getStoredMetrics (AWS SDK v3 style)
    fakeS3Response(fakeData());

    getPresignedUrl.resolves('https://example.com/presigned-url');

    const referenceDate = new Date('2025-10-02T12:00:00Z'); // October 2, 2025

    await sendToMystique({
      ...context,
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
    expect(message.date).to.equal('2025-10-01'); // Yesterday from reference date
    expect(message.week).to.be.a('number');
    expect(message.year).to.be.a('number');
    expect(message.data).to.deep.equal({
      web_search_provider: 'chatgpt',
      url: 'https://example.com/presigned-url',
    });
  });

  it('should calculate correct ISO week for dates at year boundaries', async () => {
    fakeS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    // Test December 30, 2024 (Monday of Week 1, 2025)
    const referenceDate = new Date('2024-12-31T12:00:00Z');

    await sendToMystique({
      ...context,
      auditContext: {
        referenceDate,
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.date).to.equal('2024-12-30'); // Yesterday
    expect(message.week).to.equal(1); // ISO week 1
    expect(message.year).to.equal(2025); // ISO year 2025 (even though calendar year is 2024)
  });

  it('should skip sending message to Mystique when no keywordQuestions', async () => {
    fakeS3Response([]);
    await sendToMystique({
      ...context,
      auditContext: {
        referenceDate: new Date('2025-10-02T12:00:00Z'),
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('should use current date when referenceDate is not provided', async () => {
    fakeS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    await sendToMystique({
      ...context,
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
    
    expect(message.date).to.equal(expectedDate);
    expect(message.week).to.be.a('number');
    expect(message.year).to.be.a('number');
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


