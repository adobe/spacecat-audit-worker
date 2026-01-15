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
import {
  keywordPromptsImportStep,
  loadPromptsAndSendDetection,
  WEB_SEARCH_PROVIDERS,
  isAiPromptDeleted,
} from '../../src/geo-brand-presence/handler.js';
import { receiveCategorization } from '../../src/geo-brand-presence/categorization-response-handler.js';
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
      setAuditResult: sandbox.stub(),
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
      'GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s, referenceDate: %s',
      finalUrl,
      '2025-09-15',
      'gemini',
      undefined,
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
      'GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s, referenceDate: %s',
      finalUrl,
      undefined,
      undefined,
      undefined,
    );
  });

  it('should send detection message to Mystique in step 1', async () => {
    // Mock S3 client method used by getStoredMetrics (AWS SDK v3 style)
    fakeParquetS3Response(fakeData());

    getPresignedUrl.resolves('https://example.com/presigned-url');

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Step 1 sends detection message for the configured provider (chatgpt)
    expect(sqs.sendMessage).to.have.been.calledOnce;

    // Should be detection message (not categorization - that happens in Mystique)
    const [detectionQueue, detectionMessage] = sqs.sendMessage.firstCall.args;
    expect(detectionQueue).to.equal('spacecat-to-mystique');
    expect(detectionMessage).to.include({
      type: 'detect:geo-brand-presence',
      siteId: site.getId(),
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
    });
    expect(detectionMessage.data).to.include({
      configVersion: '1.0.0',
      config_version: '1.0.0',
      url: 'https://example.com/presigned-url',
      web_search_provider: 'chatgpt',
    });
  });

  it('should fall back to all providers when aiPlatform is invalid in step 1', async () => {
    // Set aiPlatform to an invalid value
    audit.getAuditResult = () => ({ aiPlatform: 'invalid-provider' });

    fakeParquetS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Step 1 sends detection messages for ALL providers (fallback behavior)
    expect(sqs.sendMessage).to.have.callCount(WEB_SEARCH_PROVIDERS.length);

    // Verify all providers got detection messages
    const calls = sqs.sendMessage.getCalls();
    const sentProviders = calls.map(call => call.args[1].data.web_search_provider);
    expect(sentProviders).to.have.length(WEB_SEARCH_PROVIDERS.length);
  });

  // Removed: "Step 2" no longer exists - detection messages are sent in step 1
  // receiveCategorization now only processes categorization status and writes to parquet

  it('sends customer defined prompts from the config to mystique in step 1', async () => {
    const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
    const cat2 = '2a2f9b39-126b-411e-af0b-ad2a48dfd9b1';

    // Mock parquet data with no AI prompts (only human prompts from config)
    fakeParquetS3Response([]);

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
            { prompt: 'custom prompt 1', regions: ['de'], origin: 'human', source: 'config' },
            { prompt: 'custom prompt 2', regions: ['it'], origin: 'human', source: 'config' },
            { prompt: 'custom prompt 3', regions: ['ch', 'fr'], origin: 'human', source: 'config' },
          ],
        },
        '49db7cbc-326f-437f-bedc-e4b7b33ac220': {
          name: 'Topic 2',
          category: cat2,
          prompts: [
            { prompt: 'custom prompt 4', regions: ['es'], origin: 'human', source: 'config' },
          ],
        },
      },
    });

    getPresignedUrl.resolves('https://example.com/presigned-url');

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Verify detection message was sent with human prompts
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.type).to.equal('detect:geo-brand-presence');

    // Verify presigned URL was generated with combined prompts (human only in this case)
    expect(getPresignedUrl).to.have.been.calledOnce;
  });

  it.skip('should split customer prompts with multiple regions into separate items in step 2', async () => {
    const cat1 = 'ecfc4ebe-8841-4d10-a52f-1ab79bbc77a9'; // Acrobat
    const cat2 = '49d70928-c542-45ba-bbfb-528c69cfdbe7'; // Firefly
    const cat3 = 'bae2762a-fca8-4a05-97d4-0cbd4adb1ef4'; // Photoshop

    // Mock audit result for step 2
    audit.getAuditResult = () => ({
      aiPlatform: 'chatgpt',
      providersToUse: ['chatgpt'],
      dateContext: { year: 2025, week: 33 },
      configVersion: '1.0.0',
      parquetFiles: ['some/parquet/file/data.parquet'],
    });

    // Mock fetch for empty categorized prompts from callback
    sinon.stub(global, 'fetch').resolves({
      ok: true,
      json: sinon.stub().resolves({ prompts: [] }),
    });

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

    // Mock S3 PutObjectCommand for aggregates write
    s3Client.send
      .withArgs(matchS3Cmd('PutObjectCommand', { Key: sinon.match(/^aggregates[/]/) }))
      .resolves({});

    await receiveCategorization({
      ...context,
      data: { url: 'https://example.com/categorized-prompts.json' },
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    global.fetch.restore();

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

  it.skip('should download and process already-categorized prompts from callback in step 2', async () => {
    // Mock audit result for step 2
    audit.getAuditResult = () => ({
      aiPlatform: 'chatgpt',
      providersToUse: ['chatgpt'],
      dateContext: { year: 2025, week: 33 },
      configVersion: '1.0.0',
      parquetFiles: ['some/parquet/file/data.parquet'],
    });

    const alreadyCategorizedPrompts = [
      {
        topic: 'pdf editor',
        prompt: 'What is the best PDF editor?',
        region: 'us',
        category: 'Product Comparison',
        origin: 'AI',
      },
      {
        topic: 'pdf converter',
        prompt: 'How to convert PDF to Word?',
        region: 'uk',
        category: 'How-to',
        origin: 'AI',
      },
    ];

    // Mock fetch to return already-categorized prompts
    sinon.stub(global, 'fetch').resolves({
      ok: true,
      json: sinon.stub().resolves({ prompts: alreadyCategorizedPrompts }),
    });

    const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
    fakeConfigS3Response({
      ...llmoConfig.defaultConfig(),
      categories: {
        [cat1]: { name: 'Category 1', region: ['us'] },
      },
      topics: {
        'a3c8d1e2-4f5b-6c7d-8e9f-0a1b2c3d4e5f': {
          name: 'Human Topic 1',
          category: cat1,
          prompts: [
            { prompt: 'human prompt 1', regions: ['us'], origin: 'human', source: 'config' },
          ],
        },
      },
    });

    getPresignedUrl.resolves('https://example.com/presigned-url');

    // Mock S3 PutObjectCommand for aggregates write
    s3Client.send
      .withArgs(matchS3Cmd('PutObjectCommand', { Key: sinon.match(/^aggregates[/]/) }))
      .resolves({});

    await receiveCategorization({
      ...context,
      data: { categorizedPromptsUrl: 'https://example.com/categorized-prompts.json' },
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Verify fetch was called with correct URL (before restoring)
    expect(global.fetch).to.have.been.calledWith('https://example.com/categorized-prompts.json');

    global.fetch.restore();

    // Verify aggregates write was called (categorized prompts should be written)
    const aggregatesCall = s3Client.send.getCalls().find(call =>
      call.args[0].input?.Key?.startsWith('aggregates/')
    );
    expect(aggregatesCall).to.exist;

    // Verify detection message was sent with combined prompts (AI + human)
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.type).to.equal('detect:geo-brand-presence');
  });

  it.skip('should handle empty categorized prompts list in step 2 callback', async () => {
    // Mock audit result for step 2
    audit.getAuditResult = () => ({
      aiPlatform: 'chatgpt',
      providersToUse: ['chatgpt'],
      dateContext: { year: 2025, week: 33 },
      configVersion: '1.0.0',
      parquetFiles: ['some/parquet/file/data.parquet'],
    });

    // Mock fetch to return empty categorized prompts
    sinon.stub(global, 'fetch').resolves({
      ok: true,
      json: sinon.stub().resolves({ prompts: [] }),
    });

    const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
    fakeConfigS3Response({
      ...llmoConfig.defaultConfig(),
      categories: {
        [cat1]: { name: 'Category 1', region: ['us'] },
      },
      topics: {
        'a3c8d1e2-4f5b-6c7d-8e9f-0a1b2c3d4e5f': {
          name: 'Human Topic 1',
          category: cat1,
          prompts: [
            { prompt: 'human prompt 1', regions: ['us'], origin: 'human', source: 'config' },
          ],
        },
      },
    });

    getPresignedUrl.resolves('https://example.com/presigned-url');

    // Mock S3 PutObjectCommand for aggregates write (should NOT be called for empty list)
    s3Client.send
      .withArgs(matchS3Cmd('PutObjectCommand', { Key: sinon.match(/^aggregates[/]/) }))
      .resolves({});

    await receiveCategorization({
      ...context,
      data: { categorizedPromptsUrl: 'https://example.com/categorized-prompts.json' },
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    global.fetch.restore();

    // Verify detection still runs with only human prompts
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.type).to.equal('detect:geo-brand-presence');

    // Verify aggregates write was NOT called (no AI prompts)
    const aggregatesCall = s3Client.send.getCalls().find(call =>
      call.args[0].input?.Key?.startsWith('aggregates/')
    );
    expect(aggregatesCall).to.not.exist;
  });

  it('should return no_url status when URL is missing', async () => {
    const result = await receiveCategorization({
      ...context,
      data: {}, // Missing URL
    }, getPresignedUrl);

    expect(result.status).to.equal('no_url');
    expect(result.message).to.include('No URL provided');
  });

  it.skip('should return error when fetch of categorized prompts fails in step 2', async () => {
    // Mock audit result for step 2
    audit.getAuditResult = () => ({
      aiPlatform: 'chatgpt',
      providersToUse: ['chatgpt'],
      dateContext: { year: 2025, week: 33 },
      configVersion: '1.0.0',
      parquetFiles: ['some/parquet/file/data.parquet'],
    });

    // Mock fetch to fail
    sinon.stub(global, 'fetch').resolves({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await receiveCategorization({
      ...context,
      data: { categorizedPromptsUrl: 'https://example.com/categorized-prompts.json' },
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    global.fetch.restore();

    expect(result.status).to.equal('error');
    expect(result.message).to.include('Failed to download categorized prompts');
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('should NOT send detection message when no prompts available', async () => {
    fakeParquetS3Response([]);
    
    // Mock empty config (no human prompts)
    fakeConfigS3Response(llmoConfig.defaultConfig());
    
    getPresignedUrl.resolves('https://example.com/presigned-url');

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
        parquetFiles: ['some/parquet/file/data.parquet'],
      },
    }, getPresignedUrl);

    // Should NOT send message when no prompts are available
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('should skip sending message to Mystique in step 1 when no web search providers configured', async () => {
    // Set aiPlatform to undefined to simulate empty provider scenario
    audit.getAuditResult = () => ({ aiPlatform: undefined });

    fakeParquetS3Response(fakeData());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    // Temporarily empty the providers array
    const originalProviders = [...WEB_SEARCH_PROVIDERS];
    WEB_SEARCH_PROVIDERS.splice(0, WEB_SEARCH_PROVIDERS.length);

    try {
      await loadPromptsAndSendDetection({
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

  it('should skip sending message to Mystique in step 1 when success is false', async () => {
    await loadPromptsAndSendDetection({
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

  it('should skip sending message to Mystique in step 1 when calendarWeek is invalid', async () => {
    await loadPromptsAndSendDetection({
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

  it('should skip sending message to Mystique in step 1 when calendarWeek is missing week', async () => {
    await loadPromptsAndSendDetection({
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

  it('should skip sending message to Mystique in step 1 when parquetFiles is invalid', async () => {
    await loadPromptsAndSendDetection({
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

  it('should skip sending message to Mystique in step 1 when parquetFiles contains non-strings', async () => {
    await loadPromptsAndSendDetection({
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

  // Unit tests for isAiPromptDeleted helper function
  // This function only checks AI prompts (origin='ai') and matches on prompt + region only
  describe('isAiPromptDeleted', () => {
    it('should return true when AI prompt matches a deleted entry by prompt and region', () => {
      const deletedPrompts = {
        '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
          prompt: 'What is the best cereal for breakfast?',
          regions: ['ca'],
          origin: 'ai',
          source: 'ahrefs',
          topic: 'Cereal Brands',
          category: 'Breakfast Cereals',
        },
      };

      const result = isAiPromptDeleted(
        'What is the best cereal for breakfast?',
        'ca',
        deletedPrompts,
      );

      expect(result).to.be.true;
    });

    it('should return false when prompt text differs', () => {
      const deletedPrompts = {
        '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
          prompt: 'Deleted AI prompt text',
          regions: ['us'],
          origin: 'ai',
          topic: 'Test Topic',
          category: 'Test Category',
        },
      };

      const result = isAiPromptDeleted(
        'Different prompt text',
        'us',
        deletedPrompts,
      );

      expect(result).to.be.false;
    });

    it('should return false when region is not in deleted regions', () => {
      const deletedPrompts = {
        '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
          prompt: 'Test AI prompt',
          regions: ['us'],
          origin: 'ai',
          topic: 'Test Topic',
          category: 'Test Category',
        },
      };

      const result = isAiPromptDeleted(
        'Test AI prompt',
        'ca', // Different region
        deletedPrompts,
      );

      expect(result).to.be.false;
    });

    it('should ignore topic when matching AI prompts', () => {
      const deletedPrompts = {
        '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
          prompt: 'Test AI prompt',
          regions: ['us'],
          origin: 'ai',
          topic: 'Original Topic from Mystique',
          category: 'Test Category',
        },
      };

      // Should match because we only check prompt + region for AI prompts
      const result = isAiPromptDeleted(
        'Test AI prompt',
        'us',
        deletedPrompts,
      );

      expect(result).to.be.true;
    });

    it('should ignore category when matching AI prompts', () => {
      const deletedPrompts = {
        '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
          prompt: 'Test AI prompt',
          regions: ['us'],
          origin: 'ai',
          topic: 'Test Topic',
          category: 'Mystique Assigned Category',
        },
      };

      // Should match because we only check prompt + region for AI prompts
      // The parquet prompt would have empty category, but we don't check it
      const result = isAiPromptDeleted(
        'Test AI prompt',
        'us',
        deletedPrompts,
      );

      expect(result).to.be.true;
    });

    it('should NOT match human-origin deleted prompts', () => {
      const deletedPrompts = {
        '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
          prompt: 'Human prompt text',
          regions: ['us'],
          origin: 'human', // Human prompt, not AI
          source: 'config',
          topic: 'Test Topic',
          category: 'Test Category',
        },
      };

      // Should return false because origin is 'human', not 'ai'
      const result = isAiPromptDeleted(
        'Human prompt text',
        'us',
        deletedPrompts,
      );

      expect(result).to.be.false;
    });

    it('should return false when deletedPrompts is empty', () => {
      const result = isAiPromptDeleted(
        'Test prompt',
        'us',
        {},
      );

      expect(result).to.be.false;
    });

    it('should match when AI prompt is deleted in multiple regions', () => {
      const deletedPrompts = {
        '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
          prompt: 'Test AI prompt',
          regions: ['us', 'ca', 'uk'],
          origin: 'ai',
          topic: 'Test Topic',
          category: 'Test Category',
        },
      };

      expect(isAiPromptDeleted('Test AI prompt', 'us', deletedPrompts)).to.be.true;
      expect(isAiPromptDeleted('Test AI prompt', 'ca', deletedPrompts)).to.be.true;
      expect(isAiPromptDeleted('Test AI prompt', 'uk', deletedPrompts)).to.be.true;
      expect(isAiPromptDeleted('Test AI prompt', 'de', deletedPrompts)).to.be.false;
    });

    it('should match against multiple deleted AI prompts', () => {
      const deletedPrompts = {
        'uuid-1': {
          prompt: 'First deleted AI prompt',
          regions: ['us'],
          origin: 'ai',
          topic: 'Topic A',
          category: 'Category A',
        },
        'uuid-2': {
          prompt: 'Second deleted AI prompt',
          regions: ['ca'],
          origin: 'ai',
          topic: 'Topic B',
          category: 'Category B',
        },
      };

      expect(isAiPromptDeleted('First deleted AI prompt', 'us', deletedPrompts)).to.be.true;
      expect(isAiPromptDeleted('Second deleted AI prompt', 'ca', deletedPrompts)).to.be.true;
      expect(isAiPromptDeleted('Non-deleted prompt', 'us', deletedPrompts)).to.be.false;
    });

    it('should only match AI prompts when mixed origins exist', () => {
      const deletedPrompts = {
        'uuid-ai': {
          prompt: 'Shared prompt text',
          regions: ['us'],
          origin: 'ai',
          topic: 'AI Topic',
          category: 'AI Category',
        },
        'uuid-human': {
          prompt: 'Shared prompt text',
          regions: ['ca'],
          origin: 'human',
          topic: 'Human Topic',
          category: 'Human Category',
        },
      };

      // Should match the AI deleted prompt for 'us'
      expect(isAiPromptDeleted('Shared prompt text', 'us', deletedPrompts)).to.be.true;
      // Should NOT match the human deleted prompt for 'ca'
      expect(isAiPromptDeleted('Shared prompt text', 'ca', deletedPrompts)).to.be.false;
    });
  });

  // Integration tests: Deleted AI prompts filtering in loadPromptsAndSendDetection
  // AI prompts are loaded from parquet files and filtered against deleted.prompts (origin='ai')
  // Matching is done on prompt + region only (ignoring category/topic) because parquet prompts
  // have empty category while deleted prompts have Mystique-assigned categories
  describe('Deleted AI Prompts Filtering', () => {
    it('should filter out deleted AI prompts when loading from parquet', async () => {
      // AI prompts from parquet - note category is empty string as per real parquet data
      fakeParquetS3Response([
        {
          prompt: 'What is the best cereal for breakfast?',
          region: 'ca',
          category: '', // Empty category in parquet
          topic: 'cereal',
          url: 'https://example.com',
          keyword: 'cereal',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'What is the best cereal for breakfast?',
          region: 'us',
          category: '',
          topic: 'cereal',
          url: 'https://example.com',
          keyword: 'cereal',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 1000,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'Which cereal has more fiber?',
          region: 'ca',
          category: '',
          topic: 'cereal',
          url: 'https://example.com',
          keyword: 'cereal',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 500,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'Which cereal has more fiber?',
          region: 'us',
          category: '',
          topic: 'cereal',
          url: 'https://example.com',
          keyword: 'cereal',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 500,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
      ]);

      const cat1 = '12280d61-2869-4c77-93da-a41b515ff59d';

      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Breakfast Cereals', region: ['ca', 'us'] },
        },
        topics: {},
        deleted: {
          prompts: {
            '3c73fca4-eb1a-4847-8a1b-457f5b771ccc': {
              prompt: 'What is the best cereal for breakfast?',
              regions: ['ca'], // Only deleted for 'ca'
              origin: 'ai',
              source: 'ahrefs',
              topic: 'Cereal Brands', // Mystique-assigned topic (different from parquet)
              category: 'Breakfast Cereals', // Mystique-assigned category (different from parquet)
            },
          },
        },
      });

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      // Verify the correct number of prompts are sent
      // Original: 4 AI prompts (2 prompts × 2 regions)
      // After filtering: 3 (removed 'What is the best cereal...' for 'ca')
      expect(s3Client.send).calledWith(
        matchS3Cmd('PutObjectCommand', {
          Body: sinon.match((json) => {
            const data = JSON.parse(json);
            expect(data).to.have.lengthOf(3);

            // The deleted prompt should only appear for 'us', not 'ca'
            const deletedPromptItems = data.filter(
              (p) => p.prompt === 'What is the best cereal for breakfast?',
            );
            expect(deletedPromptItems).to.have.lengthOf(1);
            expect(deletedPromptItems[0].region).to.equal('us');

            // The non-deleted prompt should appear for both regions
            const otherPromptItems = data.filter(
              (p) => p.prompt === 'Which cereal has more fiber?',
            );
            expect(otherPromptItems).to.have.lengthOf(2);
            expect(otherPromptItems.map((p) => p.region).sort()).to.deep.equal(['ca', 'us']);

            return true;
          }),
        }),
      );

      // Verify log message about filtered AI prompts
      expect(log.info).to.have.been.calledWith(
        'GEO BRAND PRESENCE: Filtered %d deleted AI prompts from parquet; AI prompts after filtering: %d (was %d) for site id %s (%s)',
        1,
        3,
        4,
        site.getId(),
        site.getBaseURL(),
      );
    });

    it('should not log filtered message when no AI prompts are deleted', async () => {
      fakeParquetS3Response([
        {
          prompt: 'Test AI prompt',
          region: 'us',
          category: '',
          topic: 'test',
          url: 'https://example.com',
          keyword: 'test',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 100,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
      ]);

      const cat1 = '12280d61-2869-4c77-93da-a41b515ff59d';

      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Test Category', region: ['us'] },
        },
        topics: {},
        deleted: {
          prompts: {}, // Empty deleted prompts
        },
      });

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      // Verify no log message about filtered AI prompts
      expect(log.info).to.not.have.been.calledWith(
        sinon.match('GEO BRAND PRESENCE: Filtered'),
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
      );
    });

    it('should filter all regions when AI prompt is deleted in all regions', async () => {
      fakeParquetS3Response([
        {
          prompt: 'Fully deleted AI prompt',
          region: 'ca',
          category: '',
          topic: 'test',
          url: 'https://example.com',
          keyword: 'test',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 100,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'Fully deleted AI prompt',
          region: 'us',
          category: '',
          topic: 'test',
          url: 'https://example.com',
          keyword: 'test',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 100,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
        {
          prompt: 'Keep this AI prompt',
          region: 'us',
          category: '',
          topic: 'test',
          url: 'https://example.com',
          keyword: 'test',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 200,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
      ]);

      const cat1 = '12280d61-2869-4c77-93da-a41b515ff59d';
      const deletedId = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';

      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Test Category', region: ['ca', 'us'] },
        },
        topics: {},
        deleted: {
          prompts: {
            [deletedId]: {
              prompt: 'Fully deleted AI prompt',
              regions: ['ca', 'us'], // Deleted in all regions
              origin: 'ai',
              source: 'ahrefs',
              topic: 'Mystique Topic',
              category: 'Mystique Category',
            },
          },
        },
      });

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      expect(s3Client.send).calledWith(
        matchS3Cmd('PutObjectCommand', {
          Body: sinon.match((json) => {
            const data = JSON.parse(json);
            // Only the non-deleted prompt should remain
            expect(data).to.have.lengthOf(1);
            expect(data[0].prompt).to.equal('Keep this AI prompt');
            return true;
          }),
        }),
      );

      // Verify 2 AI prompts were filtered (both regions of the deleted prompt)
      expect(log.info).to.have.been.calledWith(
        'GEO BRAND PRESENCE: Filtered %d deleted AI prompts from parquet; AI prompts after filtering: %d (was %d) for site id %s (%s)',
        2,
        1,
        3,
        site.getId(),
        site.getBaseURL(),
      );
    });

    it('should NOT filter human-origin deleted prompts from AI parquet data', async () => {
      // AI prompts from parquet
      fakeParquetS3Response([
        {
          prompt: 'Prompt that was deleted as human',
          region: 'us',
          category: '',
          topic: 'test',
          url: 'https://example.com',
          keyword: 'test',
          keywordImportTime: new Date('2024-05-01T00:00:00Z'),
          volume: 100,
          volumeImportTime: new Date('2025-08-13T14:00:00.000Z'),
          source: 'ahrefs',
        },
      ]);

      const cat1 = '12280d61-2869-4c77-93da-a41b515ff59d';

      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'Test Category', region: ['us'] },
        },
        topics: {},
        deleted: {
          prompts: {
            'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e': {
              prompt: 'Prompt that was deleted as human',
              regions: ['us'],
              origin: 'human', // Human-origin deleted prompt
              source: 'config',
              topic: 'Human Topic',
              category: 'Human Category',
            },
          },
        },
      });

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
          parquetFiles: ['some/parquet/file/data.parquet'],
        },
      }, getPresignedUrl);

      // The AI prompt should NOT be filtered because the deleted entry has origin='human'
      expect(s3Client.send).calledWith(
        matchS3Cmd('PutObjectCommand', {
          Body: sinon.match((json) => {
            const data = JSON.parse(json);
            expect(data).to.have.lengthOf(1);
            expect(data[0].prompt).to.equal('Prompt that was deleted as human');
            return true;
          }),
        }),
      );

      // No filtering should have occurred
      expect(log.info).to.not.have.been.calledWith(
        sinon.match('GEO BRAND PRESENCE: Filtered'),
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
      );
    });
  });

  // NEW TESTS: Deduplication Logic (Step 1)
  describe('Deduplication Logic', () => {
    it('should remove duplicate AI prompts within same region/topic in step 1', async () => {
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

      await loadPromptsAndSendDetection({
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

    it('should keep same prompts in different regions/topics in step 1', async () => {
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

      await loadPromptsAndSendDetection({
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

    it('should skip empty and invalid prompts in step 1', async () => {
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

      await loadPromptsAndSendDetection({
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

