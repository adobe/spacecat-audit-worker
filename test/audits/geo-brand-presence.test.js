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
    expect(log.debug).to.have.been.calledWith(
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
    expect(log.debug).to.have.been.calledWith(
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
      configVersion: null,
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
        configVersion: null,
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

    // custom prompt 3 has regions ['ch', 'fr'] so it should be split into 2 items
    // Total: 1 (de) + 1 (it) + 2 (ch, fr) + 1 (es) = 5 customer prompts
    expect(s3Client.send).calledWith(
        matchS3Cmd('PutObjectCommand', {
          Body: sinon.match((json) => {
            const data = JSON.parse(json);
            const customerPrompts = data.filter(p => p.source === 'human');

            // Should have 5 customer prompt items (custom prompt 3 was split)
            expect(customerPrompts).to.have.lengthOf(5);

            // Check individual prompts
            const prompt1 = customerPrompts.find(p => p.prompt === 'custom prompt 1');
            expect(prompt1).to.exist;
            expect(prompt1.region).to.equal('de');
            expect(prompt1.market).to.equal('de');

            const prompt2 = customerPrompts.find(p => p.prompt === 'custom prompt 2');
            expect(prompt2).to.exist;
            expect(prompt2.region).to.equal('it');
            expect(prompt2.market).to.equal('it');

            // Check custom prompt 3 is split into ch and fr
            const prompt3Ch = customerPrompts.find(p => p.prompt === 'custom prompt 3' && p.region === 'ch');
            expect(prompt3Ch).to.exist;
            expect(prompt3Ch.market).to.equal('ch,fr');

            const prompt3Fr = customerPrompts.find(p => p.prompt === 'custom prompt 3' && p.region === 'fr');
            expect(prompt3Fr).to.exist;
            expect(prompt3Fr.market).to.equal('ch,fr');

            const prompt4 = customerPrompts.find(p => p.prompt === 'custom prompt 4');
            expect(prompt4).to.exist;
            expect(prompt4.region).to.equal('es');
            expect(prompt4.market).to.equal('es');

            return true;
          })
        })
    );


    console.log(...s3Client.send.args)
  });

  it('should split customer prompts with multiple regions into separate items', async () => {
    const cat1 = 'ecfc4ebe-8841-4d10-a52f-1ab79bbc77a9'; // Acrobat
    const cat2 = '49d70928-c542-45ba-bbfb-528c69cfdbe7'; // Firefly
    const cat3 = 'bae2762a-fca8-4a05-97d4-0cbd4adb1ef4'; // Photoshop

    fakeParquetS3Response(fakeData());
    fakeConfigS3Response({
      ...llmoConfig.defaultConfig(),
      categories: {
        [cat1]: { name: 'Acrobat', region: ['us', 'jp', 'br', 'in', 'gb', 'de'] },
        [cat2]: { name: 'Firefly', region: ['us', 'in', 'br', 'jp', 'de', 'gb'] },
        [cat3]: { name: 'Photoshop', region: ['jp'] },
      },
      topics: {
        'b7fdf770-4dca-41fd-9af7-e9c30f42f0ce': {
          name: 'Generic QUestion',
          category: cat1,
          prompts: [
            { prompt: 'What is Acrobat ?', regions: ['gb', 'us'], origin: 'human', source: 'config' },
            { prompt: 'Wie sagt man Acrobat auf deutsch ?', regions: ['de'], origin: 'human', source: 'config' },
          ],
        },
        '3de2e5fd-cfdd-480e-b10a-bffbe2fcdde3': {
          name: 'General Question',
          category: cat2,
          prompts: [
            { prompt: 'What is Firefly', regions: ['gb', 'us'], origin: 'human', source: 'config' },
            { prompt: 'Was ist Firefly', regions: ['de'], origin: 'human', source: 'config' },
          ],
        },
        '82cc9206-82ce-471d-ab78-43e01c1a9350': {
          name: 'General Prompt',
          category: cat3,
          prompts: [
            { prompt: 'Photoshopとは何ですか？', regions: ['jp'], origin: 'human', source: 'config' },
          ],
        },
      },
    });

    getPresignedUrl.resolves('https://example.com/presigned-url');

    await sendToMystique({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Verify that:
    // - "What is Acrobat ?" with regions ['gb', 'us'] creates 2 items (one for gb, one for us)
    // - "Wie sagt man Acrobat auf deutsch ?" with regions ['de'] creates 1 item
    // - "What is Firefly" with regions ['gb', 'us'] creates 2 items
    // - "Was ist Firefly" with regions ['de'] creates 1 item
    // - "Photoshopとは何ですか？" with regions ['jp'] creates 1 item
    // Total: 2 + 1 + 2 + 1 + 1 = 7 customer prompts

    expect(s3Client.send).calledWith(
        matchS3Cmd('PutObjectCommand', {
          Body: sinon.match((json) => {
            const data = JSON.parse(json);
            const customerPrompts = data.filter(p => p.source === 'human');

            // Should have 7 customer prompt items total
            expect(customerPrompts).to.have.lengthOf(7);

            // Check "What is Acrobat ?" split into gb and us
            const acrobatGb = customerPrompts.find(p => p.prompt === 'What is Acrobat ?' && p.region === 'gb');
            expect(acrobatGb).to.exist;
            expect(acrobatGb.market).to.equal('gb,us'); // market should have original list
            expect(acrobatGb.category).to.equal('Acrobat');
            expect(acrobatGb.topic).to.equal('Generic QUestion');

            const acrobatUs = customerPrompts.find(p => p.prompt === 'What is Acrobat ?' && p.region === 'us');
            expect(acrobatUs).to.exist;
            expect(acrobatUs.market).to.equal('gb,us'); // market should have original list
            expect(acrobatUs.category).to.equal('Acrobat');

            // Check "Wie sagt man Acrobat auf deutsch ?" stays as single item
            const acrobatDe = customerPrompts.filter(p => p.prompt === 'Wie sagt man Acrobat auf deutsch ?');
            expect(acrobatDe).to.have.lengthOf(1);
            expect(acrobatDe[0].region).to.equal('de');
            expect(acrobatDe[0].market).to.equal('de');

            // Check "What is Firefly" split into gb and us
            const fireflyGb = customerPrompts.find(p => p.prompt === 'What is Firefly' && p.region === 'gb');
            expect(fireflyGb).to.exist;
            expect(fireflyGb.market).to.equal('gb,us');
            expect(fireflyGb.category).to.equal('Firefly');

            const fireflyUs = customerPrompts.find(p => p.prompt === 'What is Firefly' && p.region === 'us');
            expect(fireflyUs).to.exist;
            expect(fireflyUs.market).to.equal('gb,us');

            // Check "Was ist Firefly" stays as single item
            const fireflyDe = customerPrompts.filter(p => p.prompt === 'Was ist Firefly');
            expect(fireflyDe).to.have.lengthOf(1);
            expect(fireflyDe[0].region).to.equal('de');
            expect(fireflyDe[0].market).to.equal('de');

            // Check Photoshop prompt stays as single item
            const photoshopJp = customerPrompts.filter(p => p.prompt === 'Photoshopとは何ですか？');
            expect(photoshopJp).to.have.lengthOf(1);
            expect(photoshopJp[0].region).to.equal('jp');
            expect(photoshopJp[0].market).to.equal('jp');

            return true;
          })
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

  // NEW TESTS: Deduplication Logic
  describe('Deduplication Logic', () => {
    it('should remove duplicate AI prompts within same region/topic', async () => {
      const duplicateData = [
        {
          prompt: 'what is adobe?',
          region: 'us',
          topic: 'general',
          category: 'adobe',
          url: 'https://adobe.com/page1',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'What is Adobe?', // Duplicate (case insensitive)
          region: 'US', // Same region (case insensitive)
          topic: 'General', // Same topic (case insensitive)
          category: 'adobe',
          url: 'https://adobe.com/page2',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 2000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'adobe pricing', // Different prompt, same region/topic
          region: 'us',
          topic: 'general',
          category: 'adobe',
          url: 'https://adobe.com/page3',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1500,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
      ];

      fakeParquetS3Response(duplicateData);
      fakeConfigS3Response(); // Empty config

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await sendToMystique({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      // Should only have 2 prompts (duplicate removed, different prompt kept)
      expect(s3Client.send).calledWith(
          matchS3Cmd('PutObjectCommand', {
            Body: sinon.match((json) => {
              const data = JSON.parse(json);
              expect(data).to.have.lengthOf(2); // 1 duplicate removed
              expect(data.map(p => p.prompt)).to.include('what is adobe?');
              expect(data.map(p => p.prompt)).to.include('adobe pricing');
              return true;
            })
          })
      );
    });

    it('should keep same prompts in different regions/topics', async () => {
      const samePromptDifferentContext = [
        {
          prompt: 'what is adobe?',
          region: 'us',
          topic: 'general',
          category: 'adobe',
          url: 'https://adobe.com/page1',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'what is adobe?', // Same prompt
          region: 'uk', // Different region
          topic: 'general',
          category: 'adobe',
          url: 'https://adobe.com/page2',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 2000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'what is adobe?', // Same prompt
          region: 'us',
          topic: 'pricing', // Different topic
          category: 'adobe',
          url: 'https://adobe.com/page3',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1500,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
      ];

      fakeParquetS3Response(samePromptDifferentContext);
      fakeConfigS3Response(); // Empty config

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await sendToMystique({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      // Should keep all 3 prompts (different region/topic combinations)
      expect(s3Client.send).calledWith(
          matchS3Cmd('PutObjectCommand', {
            Body: sinon.match((json) => {
              const data = JSON.parse(json);
              expect(data).to.have.lengthOf(3); // All kept due to different contexts
              return true;
            })
          })
      );
    });

    it('should skip empty and invalid prompts', async () => {
      const mixedData = [
        {
          prompt: 'valid prompt',
          region: 'us',
          topic: 'general',
          category: 'adobe',
          url: 'https://adobe.com/page1',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: '', // Empty prompt (should be skipped)
          region: 'us',
          topic: 'general',
          category: 'adobe',
          url: 'https://adobe.com/page2',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 2000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: '   ', // Whitespace only (should be skipped)
          region: 'us',
          topic: 'general',
          category: 'adobe',
          url: 'https://adobe.com/page3',
          keyword: 'adobe',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1500,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
      ];

      fakeParquetS3Response(mixedData);
      fakeConfigS3Response(); // Empty config

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await sendToMystique({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      // Should only keep the valid prompt
      expect(s3Client.send).calledWith(
          matchS3Cmd('PutObjectCommand', {
            Body: sinon.match((json) => {
              const data = JSON.parse(json);
              expect(data).to.have.lengthOf(1); // Only valid prompt kept
              expect(data[0].prompt).to.equal('valid prompt');
              return true;
            })
          })
      );
    });
  });

  // NEW TESTS: 200-Limit Customer Priority Logic
  describe('200-Limit Customer Priority Logic', () => {
    it('should prioritize customer prompts when total exceeds 200', async () => {
      // Create 150 AI prompts
      const aiPrompts = Array.from({ length: 150 }, (_, i) => ({
        prompt: `ai prompt ${i + 1}`,
        region: 'us',
        topic: 'general',
        category: 'adobe',
        url: `https://adobe.com/page${i + 1}`,
        keyword: 'adobe',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 1000 + i,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      }));

      const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';

      fakeParquetS3Response(aiPrompts);
      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Category 1', region: ['us'] },
        },
        topics: {
          'f1a9605a-5a05-49e7-8760-b40ca2426380': {
            name: 'Topic 1',
            category: cat1,
            prompts: Array.from({ length: 75 }, (_, i) => ({
              prompt: `customer prompt ${i + 1}`,
              regions: ['us'],
              origin: 'human',
              source: 'config'
            })),
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

      // Total: 150 AI + 75 Customer = 225, should be trimmed to 200
      // Expected: 125 AI prompts + 75 Customer prompts = 200 total
      expect(s3Client.send).calledWith(
          matchS3Cmd('PutObjectCommand', {
            Body: sinon.match((json) => {
              const data = JSON.parse(json);
              expect(data).to.have.lengthOf(200); // Exactly 200 prompts

              // Should have all 75 customer prompts
              const customerPrompts = data.filter(p => p.source === 'human');
              expect(customerPrompts).to.have.lengthOf(75);

              // Should have 125 AI prompts
              const aiPromptsInResult = data.filter(p => p.source === 'ahrefs');
              expect(aiPromptsInResult).to.have.lengthOf(125);

              return true;
            })
          })
      );
    });

    it('should use only customer prompts when customer count >= 200', async () => {
      // Create 50 AI prompts
      const aiPrompts = Array.from({ length: 50 }, (_, i) => ({
        prompt: `ai prompt ${i + 1}`,
        region: 'us',
        topic: 'general',
        category: 'adobe',
        url: `https://adobe.com/page${i + 1}`,
        keyword: 'adobe',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 1000 + i,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      }));

      const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';

      fakeParquetS3Response(aiPrompts);
      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Category 1', region: ['us'] },
        },
        topics: {
          'f1a9605a-5a05-49e7-8760-b40ca2426380': {
            name: 'Topic 1',
            category: cat1,
            prompts: Array.from({ length: 250 }, (_, i) => ({
              prompt: `customer prompt ${i + 1}`,
              regions: ['us'],
              origin: 'human',
              source: 'config'
            })),
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

      // Should use only first 200 customer prompts, ignore all AI prompts
      expect(s3Client.send).calledWith(
          matchS3Cmd('PutObjectCommand', {
            Body: sinon.match((json) => {
              const data = JSON.parse(json);
              expect(data).to.have.lengthOf(200); // Exactly 200 prompts

              // Should have NO AI prompts
              const aiPromptsInResult = data.filter(p => p.source === 'ahrefs');
              expect(aiPromptsInResult).to.have.lengthOf(0);

              // Should have exactly 200 customer prompts
              const customerPrompts = data.filter(p => p.source === 'human');
              expect(customerPrompts).to.have.lengthOf(200);

              return true;
            })
          })
      );
    });

    it('should use all prompts when total <= 200', async () => {
      // Create 50 AI prompts
      const aiPrompts = Array.from({ length: 50 }, (_, i) => ({
        prompt: `ai prompt ${i + 1}`,
        region: 'us',
        topic: 'general',
        category: 'adobe',
        url: `https://adobe.com/page${i + 1}`,
        keyword: 'adobe',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 1000 + i,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      }));

      const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';

      fakeParquetS3Response(aiPrompts);
      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Category 1', region: ['us'] },
        },
        topics: {
          'f1a9605a-5a05-49e7-8760-b40ca2426380': {
            name: 'Topic 1',
            category: cat1,
            prompts: Array.from({ length: 25 }, (_, i) => ({
              prompt: `customer prompt ${i + 1}`,
              regions: ['us'],
              origin: 'human',
              source: 'config'
            })),
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

      // Total: 50 AI + 25 Customer = 75 < 200, should keep all
      expect(s3Client.send).calledWith(
          matchS3Cmd('PutObjectCommand', {
            Body: sinon.match((json) => {
              const data = JSON.parse(json);
              expect(data).to.have.lengthOf(75); // All prompts kept

              // Should have all 50 AI prompts
              const aiPromptsInResult = data.filter(p => p.source === 'ahrefs');
              expect(aiPromptsInResult).to.have.lengthOf(50);

              // Should have all 25 customer prompts
              const customerPrompts = data.filter(p => p.source === 'human');
              expect(customerPrompts).to.have.lengthOf(25);

              return true;
            })
          })
      );
    });

    it('should respect EXCLUDE_FROM_HARD_LIMIT sites', async () => {
      // Override site ID to use excluded Adobe site
      const excludedSite = {
        getBaseURL: () => 'https://adobe.com',
        getId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3', // adobe.com (excluded)
        getDeliveryType: () => 'geo_edge',
      };

      // Create 300 AI prompts
      const aiPrompts = Array.from({ length: 300 }, (_, i) => ({
        prompt: `ai prompt ${i + 1}`,
        region: 'us',
        topic: 'general',
        category: 'adobe',
        url: `https://adobe.com/page${i + 1}`,
        keyword: 'adobe',
        keywordImportTime: new Date('2024-05-01T00:00:00Z'),
        volume: 1000 + i,
        volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
        source: 'ahrefs',
      }));

      const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';

      // Setup parquet mock
      fakeParquetS3Response(aiPrompts);

      // Setup config mock specifically for the excluded site ID - need to reset and add both mocks
      s3Client.send.reset(); // Reset all previous stubs

      // Re-add the parquet mock
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
      for (const x of aiPrompts) {
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

      // Setup config mock for the excluded site ID
      s3Client.send.withArgs(
          matchS3Cmd(
              'GetObjectCommand',
              { Key: llmoConfig.llmoConfigPath(excludedSite.getId()) },
          ),
      ).resolves({
        Body: {
          async transformToString() {
            return JSON.stringify({
              ...llmoConfig.defaultConfig(),
              categories: {
                [cat1]: { name: 'Category 1', region: ['us'] },
              },
              topics: {
                'f1a9605a-5a05-49e7-8760-b40ca2426380': {
                  name: 'Topic 1',
                  category: cat1,
                  prompts: Array.from({ length: 100 }, (_, i) => ({
                    prompt: `customer prompt ${i + 1}`,
                    regions: ['us'],
                    origin: 'human',
                    source: 'config'
                  })),
                },
              }
            });
          },
        },
      });

      // Add PutObjectCommand mock
      s3Client.send
          .withArgs(matchS3Cmd('PutObjectCommand', { Key: sinon.match(/^temp[/]audit-geo-brand-presence[/]/) }))
          .resolves({});

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await sendToMystique({
        ...context,
        site: excludedSite, // Use excluded site
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      // Should keep ALL prompts (no 200 limit for excluded sites)
      expect(s3Client.send).calledWith(
          matchS3Cmd('PutObjectCommand', {
            Body: sinon.match((json) => {
              const data = JSON.parse(json);
              expect(data).to.have.lengthOf(400); // 300 AI + 100 customer = 400 total

              // Should have all 300 AI prompts
              const aiPromptsInResult = data.filter(p => p.source === 'ahrefs');
              expect(aiPromptsInResult).to.have.lengthOf(300);

              // Should have all 100 customer prompts
              const customerPrompts = data.filter(p => p.source === 'human');
              expect(customerPrompts).to.have.lengthOf(100);

              return true;
            })
          })
      );
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

