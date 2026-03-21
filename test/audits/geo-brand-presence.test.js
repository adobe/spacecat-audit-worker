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
import {
  keywordPromptsImportStep,
  loadPromptsAndSendDetection,
  WEB_SEARCH_PROVIDERS,
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
    fakeConfigS3Response(fakeAiTopicsConfig());

    getPresignedUrl.resolves('https://example.com/presigned-url');

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
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

    fakeConfigS3Response(fakeAiTopicsConfig());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
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
    // Mock empty config (no human or AI prompts)
    fakeConfigS3Response(llmoConfig.defaultConfig());

    getPresignedUrl.resolves('https://example.com/presigned-url');

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: { year: 2025, week: 33 },
      },
    }, getPresignedUrl);

    // Should NOT send message when no prompts are available
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('should skip sending message to Mystique in step 1 when no web search providers configured', async () => {
    // Set aiPlatform to undefined to simulate empty provider scenario
    audit.getAuditResult = () => ({ aiPlatform: undefined });

    fakeConfigS3Response(fakeAiTopicsConfig());
    getPresignedUrl.resolves('https://example.com/presigned-url');

    // Temporarily empty the providers array
    const originalProviders = [...WEB_SEARCH_PROVIDERS];
    WEB_SEARCH_PROVIDERS.splice(0, WEB_SEARCH_PROVIDERS.length);

    try {
      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
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

  it('should continue with config prompts when import fails (success is false)', async () => {
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

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        success: false,
        calendarWeek: { year: 2025, week: 33 },
      },
    }, getPresignedUrl);

    // Should log warning and continue with config prompts
    expect(log.warn).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Import failed for site id %s (%s). Continuing with config prompts only.',
      site.getId(),
      site.getBaseURL(),
    );

    // Should still send detection message with human prompts
    expect(sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = sqs.sendMessage.firstCall.args;
    expect(message.type).to.equal('detect:geo-brand-presence');
  });

  it('should skip sending message when import fails and no config prompts available', async () => {
    // Empty config - no prompts
    fakeConfigS3Response(llmoConfig.defaultConfig());

    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        success: false,
        calendarWeek: { year: 2025, week: 33 },
      },
    }, getPresignedUrl);

    // Should log warning about import failure
    expect(log.warn).to.have.been.calledWith(
      'GEO BRAND PRESENCE: Import failed for site id %s (%s). Continuing with config prompts only.',
      site.getId(),
      site.getBaseURL(),
    );

    // Should NOT send message when no prompts available
    expect(sqs.sendMessage).to.not.have.been.called;
  });

  it('should skip sending message to Mystique in step 1 when calendarWeek is invalid', async () => {
    await loadPromptsAndSendDetection({
      ...context,
      auditContext: {
        calendarWeek: null,
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

  // NEW TESTS: Deduplication Logic (Step 1)
  describe('Deduplication Logic', () => {
    it('should remove duplicate AI prompts within same region/topic in step 1', async () => {
      const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'adobe', region: ['us'] },
        },
        aiTopics: {
          'a1a1a1a1-1111-4111-a111-111111111111': {
            name: 'general',
            category: cat1,
            prompts: [
              { prompt: 'what is adobe?', regions: ['us'], origin: 'ai', source: 'drs' },
              { prompt: 'What is Adobe?', regions: ['us'], origin: 'ai', source: 'drs' }, // Duplicate (case insensitive)
              { prompt: 'adobe pricing', regions: ['us'], origin: 'ai', source: 'drs' }, // Different prompt
            ],
          },
        },
      });

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
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
      const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
      const topic1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const topic2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'adobe', region: ['us', 'uk'] },
        },
        aiTopics: {
          [topic1]: {
            name: 'general',
            category: cat1,
            prompts: [
              { prompt: 'what is adobe?', regions: ['us'], origin: 'ai', source: 'drs' },
              { prompt: 'what is adobe?', regions: ['uk'], origin: 'ai', source: 'drs' }, // Different region
            ],
          },
          [topic2]: {
            name: 'pricing',
            category: cat1,
            prompts: [
              { prompt: 'what is adobe?', regions: ['us'], origin: 'ai', source: 'drs' }, // Different topic
            ],
          },
        },
      });

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
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

    it('should skip prompts with no regions in step 1', async () => {
      const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
      const topic1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      fakeConfigS3Response({
        ...llmoConfig.defaultConfig(),
        categories: {
          [cat1]: { name: 'adobe', region: ['us'] },
        },
        aiTopics: {
          [topic1]: {
            name: 'general',
            category: cat1,
            prompts: [
              { prompt: 'valid prompt', regions: ['us'], origin: 'ai', source: 'drs' },
              { prompt: 'no regions prompt', regions: [], origin: 'ai', source: 'drs' }, // No regions
            ],
          },
        },
      });

      getPresignedUrl.resolves('https://example.com/presigned-url');

      await loadPromptsAndSendDetection({
        ...context,
        auditContext: {
          calendarWeek: { year: 2025, week: 33 },
        },
      }, getPresignedUrl);

      // Should only keep the prompt with regions
      expect(s3Client.send).calledWith(
        matchS3Cmd('PutObjectCommand', {
          Body: sinon.match((json) => {
            const data = JSON.parse(json);
            expect(data).to.have.lengthOf(1); // Only prompt with regions kept
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

  function fakeAiTopicsConfig() {
    const cat1 = '10606bf9-08bd-4276-9ba9-db2e7775e96a';
    const cat2 = '2a2f9b39-126b-411e-af0b-ad2a48dfd9b1';
    const cat3 = '3b3f9c49-236c-522f-bf1c-be3b59dfe0c2';
    return {
      ...llmoConfig.defaultConfig(),
      categories: {
        [cat1]: { name: 'adobe', region: ['us'] },
        [cat2]: { name: 'photoshop', region: ['us'] },
        [cat3]: { name: 'illustrator', region: ['us'] },
      },
      aiTopics: {
        'a1a1a1a1-1111-4111-a111-111111111111': {
          name: 'general',
          category: cat1,
          prompts: [
            { prompt: 'what is adobe?', regions: ['us'], origin: 'ai', source: 'drs' },
          ],
        },
        'b2b2b2b2-2222-4222-a222-222222222222': {
          name: 'pricing',
          category: cat1,
          prompts: [
            { prompt: 'adobe pricing', regions: ['us'], origin: 'ai', source: 'drs' },
          ],
        },
        'c3c3c3c3-3333-4333-a333-333333333333': {
          name: 'usage',
          category: cat2,
          prompts: [
            { prompt: 'how to use photoshop?', regions: ['us'], origin: 'ai', source: 'drs' },
          ],
        },
        'd4d4d4d4-4444-4444-a444-444444444444': {
          name: 'product comparison',
          category: cat3,
          prompts: [
            { prompt: 'is illustrator better than photoshop?', regions: ['us'], origin: 'ai', source: 'drs' },
          ],
        },
        'e5e5e5e5-5555-4555-a555-555555555555': {
          name: 'usage',
          category: cat3,
          prompts: [
            { prompt: 'where can i learn how to use illustrator?', regions: ['us'], origin: 'ai', source: 'drs' },
          ],
        },
      },
    };
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

