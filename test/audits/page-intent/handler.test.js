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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Page Intent Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockPageIntent;
  let mockS3Client;
  let mockAthenaClient;
  let getStaticContentStub;
  let getObjectFromKeyStub;
  let promptStub;
  let handlerModule;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const importerBucket = 'test-importer-bucket';
  const scraperBucket = 'test-scraper-bucket';

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(async () => {
    // Mock site
    mockSite = {
      getSiteId: sandbox.stub().returns(siteId),
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().returns(baseURL),
      getPageIntents: sandbox.stub().resolves([]),
      getConfig: sandbox.stub().returns({
        getFetchConfig: sandbox.stub().returns({}),
      }),
    };

    // Mock audit
    mockAudit = {
      getFullAuditRef: sandbox.stub().returns(`${baseURL}/audit-ref`),
    };

    // Mock PageIntent model
    mockPageIntent = {
      create: sandbox.stub().resolves(),
    };

    // Mock S3 client
    mockS3Client = {
      getObject: sandbox.stub(),
    };

    // Mock Athena client
    mockAthenaClient = {
      query: sandbox.stub().resolves([]),
    };

    // Stubs for utility functions
    getStaticContentStub = sandbox.stub().resolves('SELECT * FROM table');
    getObjectFromKeyStub = sandbox.stub().resolves(null);
    promptStub = sandbox.stub().resolves({
      content: '{\"pageIntent\":\"INFORMATIONAL\",\"topic\":\"test\"}',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    });

    // Setup context
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        audit: mockAudit,
        finalUrl: baseURL,
        s3Client: mockS3Client,
        scrapeResultPaths: new Map(),
        env: {
          S3_IMPORTER_BUCKET_NAME: importerBucket,
          S3_SCRAPER_BUCKET_NAME: scraperBucket,
        },
        dataAccess: {
          PageIntent: mockPageIntent,
        },
      })
      .build();

    // Load module with mocked dependencies
    handlerModule = await esmock('../../../src/page-intent/handler.js', {
      '@adobe/spacecat-shared-utils': {
        getStaticContent: getStaticContentStub,
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: {
          fromContext: sandbox.stub().returns(mockAthenaClient),
        },
      },
      '../../../src/utils/s3-utils.js': {
        getObjectFromKey: getObjectFromKeyStub,
      },
      '../../../src/llmo-customer-analysis/utils.js': {
        prompt: promptStub,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getPathsOfLastWeek', () => {
    it('should query Athena for referral traffic paths', async () => {
      mockAthenaClient.query.resolves([
        { path: '/page1' },
        { path: '/page2' },
      ]);

      const result = await handlerModule.getPathsOfLastWeek(context);

      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(result).to.have.property('urls');
      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls[0]).to.deep.equal({ url: `${baseURL}/page1` });
      expect(result.urls[1]).to.deep.equal({ url: `${baseURL}/page2` });
    });

    it('should filter out existing page intents', async () => {
      mockSite.getPageIntents.resolves([
        { getUrl: () => `${baseURL}/page1` },
        { getUrl: () => `${baseURL}/page3` },
      ]);

      mockAthenaClient.query.resolves([
        { path: '/page1' },
        { path: '/page2' },
        { path: '/page3' },
        { path: '/page4' },
      ]);

      const result = await handlerModule.getPathsOfLastWeek(context);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls[0].url).to.equal(`${baseURL}/page2`);
      expect(result.urls[1].url).to.equal(`${baseURL}/page4`);
    });

    it('should limit results to PAGE_INTENT_BATCH_SIZE', async () => {
      const paths = Array.from({ length: 20 }, (_, i) => ({ path: `/page${i}` }));
      mockAthenaClient.query.resolves(paths);

      const result = await handlerModule.getPathsOfLastWeek(context);

      // PAGE_INTENT_BATCH_SIZE = 10
      expect(result.urls).to.have.lengthOf(10);
    });

    it('should return correct audit result structure', async () => {
      mockAthenaClient.query.resolves([
        { path: '/page1' },
        { path: '/page2' },
      ]);

      const result = await handlerModule.getPathsOfLastWeek(context);

      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('urls');
      expect(result).to.have.property('processingType', 'minimal-content');
      expect(result).to.have.property('siteId', siteId);
      expect(result.auditResult).to.have.property('missingPageIntents', 2);
    });

    it('should handle empty Athena results with early termination', async () => {
      mockAthenaClient.query.resolves([]);

      const result = await handlerModule.getPathsOfLastWeek(context);

      expect(result.auditResult.missingPageIntents).to.equal(0);
      expect(result.fullAuditRef).to.equal('NOTHING TO PROCESS');
      expect(result.urls).to.deep.equal([{ url: baseURL }]);
      expect(result.processingType).to.equal('minimal-content');
      expect(result.siteId).to.equal(siteId);
    });

    it('should handle all pages already having page intents with early termination', async () => {
      mockSite.getPageIntents.resolves([
        { getUrl: () => `${baseURL}/page1` },
        { getUrl: () => `${baseURL}/page2` },
      ]);

      mockAthenaClient.query.resolves([
        { path: '/page1' },
        { path: '/page2' },
      ]);

      const result = await handlerModule.getPathsOfLastWeek(context);

      expect(result.auditResult.missingPageIntents).to.equal(0);
      expect(result.fullAuditRef).to.equal('NOTHING TO PROCESS');
      expect(result.urls).to.deep.equal([{ url: baseURL }]);
      expect(result.processingType).to.equal('minimal-content');
      expect(result.siteId).to.equal(siteId);
    });

    it('should handle existing page intents with invalid URLs', async () => {
      mockSite.getPageIntents.resolves([
        { getUrl: () => 'invalid-url-without-protocol' },
        { getUrl: () => `${baseURL}/page1` },
      ]);

      mockAthenaClient.query.resolves([
        { path: '/page1' },
        { path: '/page2' },
        { path: 'invalid-url-without-protocol' },
      ]);

      const result = await handlerModule.getPathsOfLastWeek(context);

      // /page1 and invalid-url-without-protocol are filtered out as existing
      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0].url).to.equal(`${baseURL}/page2`);
    });
  });

  describe('generatePageIntent', () => {
    beforeEach(() => {
      context.scrapeResultPaths = new Map([
        [`${baseURL}/page1`, 's3-key-1'],
        [`${baseURL}/page2`, 's3-key-2'],
      ]);
    });

    it('should process pages sequentially', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content for page',
        },
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(getObjectFromKeyStub).to.have.been.calledTwice;
      expect(promptStub).to.have.been.calledTwice;
      expect(mockPageIntent.create).to.have.been.calledTwice;
      expect(result.auditResult.successfulPages).to.equal(2);
      expect(result.auditResult.failedPages).to.equal(0);
    });

    it('should track token usage across all prompts', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content for page',
        },
      });

      promptStub.onFirstCall().resolves({
        content: '{"pageIntent":"INFORMATIONAL","topic":"test"}',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      });

      promptStub.onSecondCall().resolves({
        content: '{"pageIntent":"COMMERCIAL","topic":"product"}',
        usage: {
          prompt_tokens: 120,
          completion_tokens: 60,
          total_tokens: 180,
        },
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(result.auditResult).to.have.property('tokenUsage');
      expect(result.auditResult.tokenUsage.totalPromptTokens).to.equal(220);
      expect(result.auditResult.tokenUsage.totalCompletionTokens).to.equal(110);
      expect(result.auditResult.tokenUsage.totalTokens).to.equal(330);
      expect(result.auditResult.tokenUsage.promptCount).to.equal(2);
    });

    it('should handle missing usage information gracefully', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content for page',
        },
      });

      promptStub.resolves({
        content: '{"pageIntent":"INFORMATIONAL","topic":"test"}',
        usage: null,
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(result.auditResult).to.have.property('tokenUsage');
      expect(result.auditResult.tokenUsage.totalTokens).to.equal(0);
      expect(result.auditResult.tokenUsage.promptCount).to.equal(0);
    });

    it('should analyze pages with no scrape data using URL alone', async () => {
      getObjectFromKeyStub.onFirstCall().resolves(null);
      getObjectFromKeyStub.onSecondCall().resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      const result = await handlerModule.generatePageIntent(context);

      // LLM should be called for both pages (one with null content, one with content)
      expect(promptStub).to.have.been.calledTwice;
      expect(mockPageIntent.create).to.have.been.calledTwice;
      expect(result.auditResult.successfulPages).to.equal(2);
      expect(result.auditResult.failedPages).to.equal(0);
    });

    it('should analyze pages with no minimal content using URL alone', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          // minimalContent is missing
        },
      });

      const result = await handlerModule.generatePageIntent(context);

      // esM should still be called even without content
      expect(promptStub).to.have.been.calledTwice;
      expect(mockPageIntent.create).to.have.been.calledTwice;
      expect(result.auditResult.successfulPages).to.equal(2);
      expect(result.auditResult.failedPages).to.equal(0);
    });

    it('should create PageIntent records with correct data', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: '{"pageIntent":"COMMERCIAL","topic":"Product Reviews"}',
      });

      await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.have.been.calledWith(
        sinon.match({
          siteId,
          url: `${baseURL}/page1`,
          pageIntent: 'COMMERCIAL',
          topic: 'Product Reviews',
        }),
      );
    });

    it('should reject invalid page intents', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: '{"pageIntent":"INVALID_INTENT","topic":"Test"}',
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.not.have.been.called;
      expect(result.auditResult.failedPages).to.equal(2);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Invalid or null page intent/),
      );
    });

    it('should reject null page intents', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: '{"pageIntent":null,"topic":"Test"}',
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.not.have.been.called;
      expect(result.auditResult.failedPages).to.equal(2);
    });

    it('should handle LLM errors gracefully', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.rejects(new Error('LLM API error'));

      const result = await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.not.have.been.called;
      expect(result.auditResult.failedPages).to.equal(2);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to process/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should handle malformed JSON from LLM', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: 'not valid json',
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.not.have.been.called;
      expect(result.auditResult.failedPages).to.equal(2);
    });

    it('should handle markdown-wrapped JSON responses (```json)', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: '```json\n{"pageIntent":"INFORMATIONAL","topic":"Test Topic"}\n```',
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.have.been.calledTwice;
      expect(mockPageIntent.create).to.have.been.calledWith(
        sinon.match({
          pageIntent: 'INFORMATIONAL',
          topic: 'Test Topic',
        }),
      );
      expect(result.auditResult.successfulPages).to.equal(2);
    });

    it('should handle markdown-wrapped JSON responses (```)', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: '```\n{"pageIntent":"COMMERCIAL","topic":"Product"}\n```',
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.have.been.calledTwice;
      expect(mockPageIntent.create).to.have.been.calledWith(
        sinon.match({
          pageIntent: 'COMMERCIAL',
          topic: 'Product',
        }),
      );
      expect(result.auditResult.successfulPages).to.equal(2);
    });

    it('should handle plain JSON responses without markdown', async () => {
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: '{"pageIntent":"TRANSACTIONAL","topic":"Shopping"}',
      });

      const result = await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.have.been.calledTwice;
      expect(mockPageIntent.create).to.have.been.calledWith(
        sinon.match({
          pageIntent: 'TRANSACTIONAL',
          topic: 'Shopping',
        }),
      );
      expect(result.auditResult.successfulPages).to.equal(2);
    });

    it('should accept all valid page intent types', async () => {
      const validIntents = ['INFORMATIONAL', 'NAVIGATIONAL', 'COMMERCIAL', 'TRANSACTIONAL'];

      for (const intent of validIntents) {
        mockPageIntent.create.resetHistory();
        getObjectFromKeyStub.resolves({
          scrapeResult: {
            minimalContent: 'Test content',
          },
        });

        promptStub.resolves({
          content: `{"pageIntent":"${intent}","topic":"Test"}`,
        });

        context.scrapeResultPaths = new Map([[`${baseURL}/page`, 's3-key']]);

        await handlerModule.generatePageIntent(context);

        expect(mockPageIntent.create).to.have.been.calledWith(
          sinon.match({
            pageIntent: intent,
          }),
        );
      }
    });

    it('should handle empty scrapeResultPaths', async () => {
      context.scrapeResultPaths = new Map();

      const result = await handlerModule.generatePageIntent(context);

      expect(result.auditResult.successfulPages).to.equal(0);
      expect(result.auditResult.failedPages).to.equal(0);
    });

    it('should return early when fullAuditRef is NOTHING_TO_PROCESS', async () => {
      mockAudit.getFullAuditRef.returns('NOTHING TO PROCESS');

      context.scrapeResultPaths = new Map([
        [`${baseURL}/page1`, 's3-key-1'],
        [`${baseURL}/page2`, 's3-key-2'],
      ]);

      const result = await handlerModule.generatePageIntent(context);

      expect(getObjectFromKeyStub).to.not.have.been.called;
      expect(promptStub).to.not.have.been.called;
      expect(mockPageIntent.create).to.not.have.been.called;

      expect(result).to.deep.equal({
        auditResult: {
          result: 'NOTHING TO PROCESS',
        },
        fullAuditRef: 'NOTHING TO PROCESS',
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing topic in LLM response', async () => {
      context.scrapeResultPaths = new Map([
        [`${baseURL}/page1`, 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: 'Test content',
        },
      });

      promptStub.resolves({
        content: '{"pageIntent":"INFORMATIONAL"}',
      });

      await handlerModule.generatePageIntent(context);

      expect(mockPageIntent.create).to.have.been.calledWith(
        sinon.match({
          pageIntent: 'INFORMATIONAL',
          topic: '',
        }),
      );
    });

    it('should handle very long minimal content', async () => {
      context.scrapeResultPaths = new Map([
        [`${baseURL}/page1`, 's3-key-1'],
      ]);

      const longContent = 'a'.repeat(50000);
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          minimalContent: longContent,
        },
      });

      await handlerModule.generatePageIntent(context);

      // Verify that the prompt was called with truncated content
      const promptCall = promptStub.getCall(0);
      expect(promptCall.args[1]).to.include('a'.repeat(10000));
      expect(promptCall.args[1]).to.include('[content truncated]');
      expect(promptCall.args[1]).not.to.include('a'.repeat(50000));
    });
  });

  describe('Module Export', () => {
    it('should export an audit builder with correct structure', async () => {
      const defaultExport = handlerModule.default;

      expect(defaultExport).to.be.an('object');
      expect(defaultExport).to.have.property('steps');
      expect(defaultExport.steps).to.be.an('object');
      expect(Object.keys(defaultExport.steps)).to.have.lengthOf(2);
      expect(defaultExport.steps).to.have.property('extract-urls');
      expect(defaultExport.steps).to.have.property('generate-intent');
    });
  });
});
