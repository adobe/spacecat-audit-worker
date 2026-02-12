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

import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { AuditBuilder } from '../../src/common/audit-builder.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const { AUDIT_STEP_DESTINATIONS } = AuditModel;

describe('Step-based Audit Tests', () => {
  const sandbox = sinon.createSandbox();
  const mockDate = '2024-03-12T15:24:51.231Z';
  const baseURL = 'https://space.cat';

  let clock;
  let context;
  let site;
  let configuration;
  let audit;

  beforeEach('setup', () => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });

    site = {
      getId: () => '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      getBaseURL: () => baseURL,
      getIsLive: () => true,
    };

    configuration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
      getHandlers: sandbox.stub().returns({
        'content-audit': {
          productCodes: ['ASO', 'LLMO'],
        },
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    context.dataAccess.Site.findById.resolves(site);
    context.dataAccess.Configuration.findLatest.resolves(configuration);

    // Mock TierClient for entitlement checks
    const mockTierClient = {
      checkValidEntitlement: sandbox.stub().resolves({ entitlement: true }),
    };
    sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

    context.env = {
      CONTENT_SCRAPER_QUEUE_URL: 'https://space.cat/content-scraper',
      IMPORT_WORKER_QUEUE_URL: 'https://space.cat/import-worker',
      AUDIT_JOBS_QUEUE_URL: 'https://space.cat/audit-jobs',
    };
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
  });

  describe('Step Configuration', () => {
    it('requires destination for non-final steps', () => {
      expect(() => new AuditBuilder()
        .addStep('first', () => {}, null)
        .addStep('second', () => {}, null)
        .build()).to.throw('Step first must specify a destination as it is not the last step');
    });

    it('validates destination exists', () => {
      expect(() => new AuditBuilder()
        .addStep('first', () => {}, 'invalid-destination')
        .build()).to.throw(/Invalid destination: invalid-destination/);
    });

    it('allows final step without destination', () => {
      expect(() => new AuditBuilder()
        .addStep('first', () => {}, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('final', () => {})
        .build()).not.to.throw();
    });

    it('returns null for next step when current step is last', () => {
      const newAudit = new AuditBuilder()
        .addStep('first', () => {}, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('last', () => {})
        .build();

      expect(newAudit.getNextStepName('last')).to.be.null;
    });

    it('returns next step name when available', () => {
      const newAudit = new AuditBuilder()
        .addStep('first', () => {}, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('second', () => {}, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
        .addStep('last', () => {})
        .build();

      expect(newAudit.getNextStepName('first')).to.equal('second');
      expect(newAudit.getNextStepName('second')).to.equal('last');
    });
  });

  describe('Step Execution', () => {
    const message = {
      type: 'content-audit',
      siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      auditContext: {},
    };

    beforeEach(() => {
      // Create a step-based audit
      audit = new AuditBuilder()
        .addStep('prepare', async () => ({
          auditResult: { status: 'preparing' },
          fullAuditRef: 's3://test/123',
          urls: [{ url: baseURL }],
          siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        }), AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('process', async () => ({
          type: 'content-import',
          siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        }), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
        .addStep('analyze', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();
    });

    it('skips execution when audit is disabled for site', async () => {
      // Configure audit to be disabled
      configuration.isHandlerEnabledForSite.returns(false);

      const result = await audit.run(message, context);

      // Verify audit was skipped
      expect(result.status).to.equal(200);
      expect(context.dataAccess.Audit.create).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
      expect(context.log.warn).to.have.been.calledWith('content-audit audits disabled for site 42322ae6-b8b1-4a61-9c88-25205fa65b07, skipping...');
    });

    it('executes first step and creates audit record', async () => {
      nock('https://space.cat')
        .get('/')
        .reply(200, 'Success');
      const createdAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      await audit.run(message, context);

      expect(context.dataAccess.Audit.create).to.have.been.calledWith({
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        isLive: true,
        auditedAt: mockDate,
        auditType: 'content-audit',
        auditResult: { status: 'preparing' },
        fullAuditRef: 's3://test/123',
        invocationId: 'some-id',
      });

      // Update verification to match actual implementation
      const expectedPayload = {
        urls: [{ url: baseURL }],
        jobId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        processingType: 'default',
        skipMessage: false,
        allowCache: true,
        options: {},
        completionQueueUrl: 'https://space.cat/audit-jobs',
        auditContext: {
          next: 'process',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
          auditType: 'content-audit',
          fullAuditRef: 's3://test/123',
        },
      };

      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'https://space.cat/content-scraper',
        expectedPayload,
      );
    });

    it('merges custom auditContext fields with framework fields', async () => {
      nock('https://space.cat')
        .get('/')
        .reply(200, 'Success');

      const customAudit = new AuditBuilder()
        .addStep('prepare', async () => ({
          auditResult: { status: 'preparing' },
          fullAuditRef: 's3://test/123',
          type: 'content-import',
          siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
          auditContext: {
            week: 35,
            year: 2025,
            customField: 'value',
          },
        }), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
        .addStep('analyze', async () => ({ status: 'complete' }))
        .build();

      const createdAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      await customAudit.run(message, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [, payload] = context.sqs.sendMessage.firstCall.args;
      expect(payload.auditContext).to.deep.equal({
        next: 'analyze',
        auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        auditType: 'content-audit',
        fullAuditRef: 's3://test/123',
        week: 35,
        year: 2025,
        customField: 'value',
      });
    });

    it('continues execution from specified step', async () => {
      nock('https://space.cat')
        .get('/')
        .reply(200, 'Success');

      const existingAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.findById.resolves(existingAudit);

      const continueMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'process',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        },
      };

      const result = await audit.run(continueMessage, context);

      expect(result.status).to.equal(200);
      expect(await result.json()).to.deep.equal({
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        type: 'content-import',
      });

      // Verify no new audit record is created
      expect(context.dataAccess.Audit.create).not.to.have.been.called;

      // Update verification to match actual implementation
      const expectedPayload = {
        type: 'content-import',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        pageUrl: undefined,
        startDate: undefined,
        endDate: undefined,
        urlConfigs: undefined,
        allowCache: true,
        auditContext: {
          next: 'analyze',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
          auditType: 'content-audit',
          fullAuditRef: 's3://test/123',
        },
      };

      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'https://space.cat/import-worker',
        expectedPayload,
      );
    });

    it('handles final step without sending messages', async () => {
      nock('https://space.cat')
        .get('/')
        .reply(200, 'Success');

      const existingAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.findById.resolves(existingAudit);

      const finalMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'analyze',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        },
      };

      const result = await audit.run(finalMessage, context);
      expect(result.status).to.equal(200);

      // Verify no new messages are sent
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('fails if step not found', async () => {
      const invalidMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'invalid-step',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        },
      };

      await expect(audit.run(invalidMessage, context))
        .to.be.rejectedWith('ontent-audit audit failed for site 42322ae6-b8b1-4a61-9c88-25205fa65b07 at step invalid-step. Reason: Step invalid-step not found for audit undefined');
    });

    it('fails when site is not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      await expect(audit.run(message, context))
        .to.be.rejectedWith('content-audit audit failed for site 42322ae6-b8b1-4a61-9c88-25205fa65b07 at step initial. Reason: Site with id 42322ae6-b8b1-4a61-9c88-25205fa65b07 not found');
    });

    it('fails when step configuration is invalid', async () => {
      // Create an audit with invalid step configuration
      const invalidAudit = new AuditBuilder()
        .addStep('prepare', async () => ({}), null) // Missing destination
        .build();

      await expect(invalidAudit.chainStep(
        { name: 'prepare' }, // Missing destination
        {},
        context,
      )).to.be.rejectedWith('Invalid step configuration: missing destination');
    });

    it('fails when step destination configuration is invalid', async () => {
      // Create a step with invalid destination config
      const step = {
        name: 'test',
        destination: 'non-existent-destination',
      };

      await expect(audit.chainStep(step, {}, context))
        .to.be.rejectedWith('Invalid destination configuration for step test');
    });

    it('handles SCRAPE_CLIENT destination by creating scrape job', async () => {
      // Mock HTTP request for URL resolution
      nock('https://space.cat')
        .get('/')
        .reply(200, 'Success');

      // Mock ScrapeClient
      const mockScrapeClient = {
        createScrapeJob: sandbox.stub().resolves({ id: 'scrape-job-123' }),
      };
      sandbox.stub(ScrapeClient, 'createFrom').returns(mockScrapeClient);

      // Create an audit with SCRAPE_CLIENT destination
      const scrapeAudit = new AuditBuilder()
        .addStep('scrape-step', async () => ({
          urls: [{ url: baseURL }],
          siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        }), AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
        .addStep('final', async () => ({ status: 'complete' }))
        .build();

      const existingAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.findById.resolves(existingAudit);

      const scrapeMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'scrape-step',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        },
      };

      const result = await scrapeAudit.run(scrapeMessage, context);

      expect(result.status).to.equal(200);

      // Verify ScrapeClient was created and used
      expect(ScrapeClient.createFrom).to.have.been.calledOnce;
      expect(mockScrapeClient.createScrapeJob).to.have.been.calledOnce;

      // Verify no SQS message was sent (since SCRAPE_CLIENT uses different flow)
      expect(context.sqs.sendMessage).not.to.have.been.called;

      // Verify log messages
      expect(context.log.debug).to.have.been.calledWith(sinon.match(/Creating new scrapeJob with the ScrapeClient/));
      expect(context.log.info).to.have.been.calledWith('Created scrapeJob with id: scrape-job-123');
    });

    it('loads scrape result paths when scrapeJobId is provided', async () => {
      // Mock HTTP request for URL resolution
      nock('https://space.cat')
        .get('/')
        .reply(200, 'Success');

      // Mock ScrapeClient - getScrapeResultPaths returns a Map of URL to Path pairs
      const mockScrapeResultPaths = new Map([
        ['https://space.cat/', 's3://bucket/path1.json'],
        ['https://space.cat/page1', 's3://bucket/path2.json'],
        ['https://space.cat/page2', 's3://bucket/path3.json'],
      ]);
      const mockScrapeClient = {
        getScrapeResultPaths: sandbox.stub().resolves(mockScrapeResultPaths),
        getScrapeJobUrlResults: sandbox.stub().resolves([
          {
            url: 'https://space.cat/',
            status: 'COMPLETE',
          },
          {
            url: 'https://space.cat/page1',
            status: 'COMPLETE',
          },
          {
            url: 'https://space.cat/page2',
            status: 'COMPLETE',
          },
        ]),
      };
      sandbox.stub(ScrapeClient, 'createFrom').returns(mockScrapeClient);

      // Create a simple audit for testing scrape result loading
      let capturedScrapeResultPaths;
      let capturedScrapeJobId;
      const scrapeResultAudit = new AuditBuilder()
        .addStep('process-scrape', async (stepContext) => {
          // Capture the scrapeResultPaths and scrapeJobId for verification outside the step
          capturedScrapeResultPaths = stepContext.scrapeResultPaths;
          capturedScrapeJobId = stepContext.scrapeJobId;
          return { status: 'processed' };
        })
        .build();

      const existingAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
        getAuditedAt: () => mockDate,
      };
      context.dataAccess.Audit.findById.resolves(existingAudit);

      const messageWithScrapeJobId = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'process-scrape',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
          scrapeJobId: 'scrape-job-456',
        },
      };

      const result = await scrapeResultAudit.run(messageWithScrapeJobId, context);

      expect(result.status).to.equal(200);

      // Verify ScrapeClient was created and getScrapeResultPaths was called
      expect(ScrapeClient.createFrom).to.have.been.calledOnce;
      expect(mockScrapeClient.getScrapeResultPaths).to.have.been.calledWith('scrape-job-456');

      // Verify the step received the scrapeJobId (line 168 in step-audit.js)
      expect(capturedScrapeJobId).to.equal('scrape-job-456');

      // Verify the step received the scrape result paths correctly (lines 169-171)
      expect(capturedScrapeResultPaths).to.be.instanceOf(Map);
      expect(capturedScrapeResultPaths.size).to.equal(3);
      expect(capturedScrapeResultPaths.get('https://space.cat/')).to.equal('s3://bucket/path1.json');
      expect(capturedScrapeResultPaths.get('https://space.cat/page1')).to.equal('s3://bucket/path2.json');
      expect(capturedScrapeResultPaths.get('https://space.cat/page2')).to.equal('s3://bucket/path3.json');
    });
  });

  describe('SQS Abort Signal Handling', () => {
    beforeEach(() => {
      // Reset warn stub to ensure clean state for these tests
      context.log.warn.resetHistory();

      // Ensure configuration allows all audit types
      configuration.isHandlerEnabledForSite.returns(true);
      configuration.getHandlers.returns({
        'content-audit': { productCodes: ['ASO', 'LLMO'] },
        cwv: { productCodes: ['ASO', 'LLMO'] },
        'meta-tags': { productCodes: ['ASO', 'LLMO'] },
        'broken-backlinks': { productCodes: ['ASO', 'LLMO'] },
        sitemap: { productCodes: ['ASO', 'LLMO'] },
      });
    });

    it('aborts audit when receiving abort signal in message', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Create a simple audit for testing abort handling (step should not execute due to abort)
      const scrapeResultAudit = new AuditBuilder()
        .addStep('process', async () => ({
          status: 'should-not-reach',
          findings: ['should-not-reach'],
        }))
        .build();

      const messageWithAbort = {
        type: 'cwv',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'abort-job-123',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 10,
            totalUrlsCount: 10,
            blockedUrls: [
              { url: 'https://example.com/page1', blockerType: 'cloudflare', httpStatus: 403 },
              { url: 'https://example.com/page2', blockerType: 'cloudflare', httpStatus: 403 },
              { url: 'https://example.com/page3', blockerType: 'imperva', httpStatus: 403 },
            ],
            byBlockerType: { cloudflare: 8, imperva: 2 },
            byHttpStatus: { 403: 10 },
            auditType: 'cwv',
            siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
            siteUrl: 'https://example.com',
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithAbort, context);

      // Should return ok status (audit aborted early)
      expect(result.status).to.equal(200);

      // Verify [BOT-BLOCKED] log with detailed info including jobId
      // There are two [BOT-BLOCKED] logs: one from step-audit.js and one from handleAbort
      // Find the one from handleAbort (contains "Audit aborted for jobId")
      expect(context.log.warn).to.have.been.calledWithMatch(/\[BOT-BLOCKED\] Audit aborted for jobId=abort-job-123/);
      const botBlockedCall = context.log.warn.args.find((call) => call[0] && call[0].includes('Audit aborted for jobId=abort-job-123'));
      expect(botBlockedCall).to.exist;
      const botBlockedLog = botBlockedCall[0];
      expect(botBlockedLog).to.include('Audit aborted for jobId=abort-job-123');
      expect(botBlockedLog).to.include('type=cwv');
      expect(botBlockedLog).to.include('site=https://space.cat');
      expect(botBlockedLog).to.match(/HTTP Status: \[403: 10\]/);
      expect(botBlockedLog).to.match(/Blocker Types: \[.*cloudflare: 8.*imperva: 2.*\]/);
      expect(botBlockedLog).to.include('10/10 URLs blocked');
      expect(botBlockedLog).to.include('https://example.com/page1');
      expect(botBlockedLog).to.include('https://example.com/page2');
      expect(botBlockedLog).to.include('https://example.com/page3');
    });

    it('continues normal audit when no abort signal present', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Mock audit creation
      const createdAudit = {
        getId: () => 'audit-normal-123',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/normal',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      // Create a simple audit for testing normal flow (final step returns status directly)
      const scrapeResultAudit = new AuditBuilder()
        .addStep('initial', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();

      const normalMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'normal-job-456',
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(normalMessage, context);

      // Should execute normally without abort
      expect(result.status).to.equal(200);
      expect(context.log.warn).to.not.have.been.calledWithMatch(/\[AUDIT-ABORTED\]/);
      expect(context.log.warn).to.not.have.been.calledWithMatch(/\[BOT-BLOCKED\]/);
    });

    it('handles generic abort reasons other than bot-protection', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Mock audit creation for normal flow
      const createdAudit = {
        getId: () => 'audit-generic-123',
        getAuditType: () => 'meta-tags',
        getFullAuditRef: () => 's3://test/generic',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      // Create a simple audit for testing generic abort (should continue processing)
      const scrapeResultAudit = new AuditBuilder()
        .addStep('initial', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();

      const messageWithGenericAbort = {
        type: 'meta-tags',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'generic-abort-789',
        abort: {
          reason: 'rate-limited',
          details: {
            message: 'Rate limit exceeded',
            retryAfter: 3600,
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithGenericAbort, context);

      // Generic aborts are not handled yet - audit should continue processing
      expect(result.status).to.equal(200);

      // Verify no bot-protection specific logs for generic abort
      expect(context.log.warn).to.not.have.been.calledWithMatch(/\[BOT-BLOCKED\]/);
    });

    it('includes all blocked URLs in log message', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Create a simple audit for testing many URLs (step should not execute due to abort)
      const scrapeResultAudit = new AuditBuilder()
        .addStep('process', async () => ({
          status: 'should-not-reach',
          findings: ['should-not-reach'],
        }))
        .build();

      const longBlockedUrls = Array.from({ length: 50 }, (_, i) => ({
        url: `https://example.com/page${i + 1}`,
        blockerType: 'cloudflare',
        httpStatus: 403,
      }));

      const messageWithManyUrls = {
        type: 'broken-backlinks',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'many-urls-job',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 50,
            totalUrlsCount: 50,
            blockedUrls: longBlockedUrls,
            byBlockerType: { cloudflare: 50 },
            byHttpStatus: { 403: 50 },
            auditType: 'broken-backlinks',
            siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
            siteUrl: 'https://example.com',
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithManyUrls, context);

      // Should abort and return ok status
      expect(result.status).to.equal(200);

      // Verify [BOT-BLOCKED] log was called
      // There are two [BOT-BLOCKED] logs: one from step-audit.js and one from handleAbort
      // Find the one from handleAbort (contains "Audit aborted for jobId")
      expect(context.log.warn).to.have.been.calledWithMatch(/\[BOT-BLOCKED\] Audit aborted for jobId=many-urls-job/);
      expect(context.log.warn).to.have.been.calledWithMatch(/50\/50 URLs blocked/);

      // Verify all URLs are in the log
      const botBlockedCall = context.log.warn.args.find((call) => call && call[0] && call[0].includes('Audit aborted for jobId=many-urls-job'));
      expect(botBlockedCall).to.exist;
      const botBlockedLog = botBlockedCall[0];
      expect(botBlockedLog).to.include('Audit aborted for jobId=many-urls-job');
      expect(botBlockedLog).to.include('type=broken-backlinks');
      expect(botBlockedLog).to.include('site=https://space.cat');
      expect(botBlockedLog).to.match(/HTTP Status: \[403: 50\]/);
      expect(botBlockedLog).to.match(/Blocker Types: \[cloudflare: 50\]/);
      expect(botBlockedLog).to.include('50/50 URLs blocked');
      // Check first and last URL
      expect(botBlockedLog).to.include('https://example.com/page1');
      expect(botBlockedLog).to.include('https://example.com/page50');
    });

    it('handles abort with multiple blocker types and status codes', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Create a simple audit for testing mixed blockers (step should not execute due to abort)
      const scrapeResultAudit = new AuditBuilder()
        .addStep('process', async () => ({
          status: 'should-not-reach',
          findings: ['should-not-reach'],
        }))
        .build();

      const messageWithMixedBlockers = {
        type: 'sitemap',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'mixed-blockers-job',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 10,
            totalUrlsCount: 10,
            blockedUrls: [
              { url: 'https://example.com/cf1', blockerType: 'cloudflare', httpStatus: 403 },
              { url: 'https://example.com/cf2', blockerType: 'cloudflare', httpStatus: 403 },
              { url: 'https://example.com/im1', blockerType: 'imperva', httpStatus: 403 },
              { url: 'https://example.com/ak1', blockerType: 'akamai', httpStatus: 429 },
              { url: 'https://example.com/ak2', blockerType: 'akamai', httpStatus: 503 },
            ],
            byBlockerType: { cloudflare: 2, imperva: 1, akamai: 7 },
            byHttpStatus: { 403: 3, 429: 1, 503: 6 },
            auditType: 'sitemap',
            siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
            siteUrl: 'https://example.com',
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithMixedBlockers, context);

      // Should abort and return ok status
      expect(result.status).to.equal(200);

      // Verify [BOT-BLOCKED] log was called
      // There are two [BOT-BLOCKED] logs: one from step-audit.js and one from handleAbort
      // Find the one from handleAbort (contains "Audit aborted for jobId")
      expect(context.log.warn).to.have.been.calledWithMatch(/\[BOT-BLOCKED\] Audit aborted for jobId=mixed-blockers-job/);

      // Verify status details in log
      const botBlockedCall = context.log.warn.args.find((call) => call && call[0] && call[0].includes('Audit aborted for jobId=mixed-blockers-job'));
      expect(botBlockedCall).to.exist;
      const botBlockedLog = botBlockedCall[0];
      expect(botBlockedLog).to.include('Audit aborted for jobId=mixed-blockers-job');
      expect(botBlockedLog).to.include('type=sitemap');
      expect(botBlockedLog).to.include('site=https://space.cat');
      expect(botBlockedLog).to.match(/HTTP Status: \[.*403: 3.*429: 1.*503: 6.*\]/);
      expect(botBlockedLog).to.match(/Blocker Types: \[.*cloudflare: 2.*imperva: 1.*akamai: 7.*\]/);
      expect(botBlockedLog).to.include('10/10 URLs blocked');
    });

    it('handles abort with missing details fields (fallback to empty/none)', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Create a simple audit for testing missing fields
      const scrapeResultAudit = new AuditBuilder()
        .addStep('process', async () => ({
          status: 'should-not-reach',
          findings: ['should-not-reach'],
        }))
        .build();

      const messageWithMissingFields = {
        type: 'cwv',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'missing-fields-job',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 10,
            totalUrlsCount: 10,
            // Missing: byBlockerType, byHttpStatus, blockedUrls
            auditType: 'cwv',
            siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
            siteUrl: 'https://example.com',
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithMissingFields, context);

      // Should abort and return ok status
      expect(result.status).to.equal(200);

      // Verify [BOT-BLOCKED] log was called
      // There are two [BOT-BLOCKED] logs: one from step-audit.js and one from handleAbort
      // Find the one from handleAbort (contains "Bot Protected URLs")
      expect(context.log.warn).to.have.been.calledWithMatch(/\[BOT-BLOCKED\]/);

      // Verify fallback handling
      const botBlockedCall = context.log.warn.args.find((call) => call && call[0] && call[0].includes('Bot Protected URLs'));
      expect(botBlockedCall).to.exist;
      const botBlockedLog = botBlockedCall[0];

      // Should use 'none' for missing blockedUrls
      expect(botBlockedLog).to.include('Bot Protected URLs: [none]');

      // Should have empty HTTP Status and Blocker Types
      expect(botBlockedLog).to.include('HTTP Status: []');
      expect(botBlockedLog).to.include('Blocker Types: []');
    });

    it('handles bot-protection abort with null details (fallback to empty object)', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      const messageWithNullDetails = {
        type: 'cwv',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'null-details-job',
        abort: {
          reason: 'bot-protection',
          details: null, // Explicitly null to trigger || {} fallback
        },
        auditContext: {},
      };

      // Mock audit creation for normal flow (null details means no counts, so audit continues)
      const createdAudit = {
        getId: () => 'audit-null-details-123',
        getAuditType: () => 'cwv',
        getFullAuditRef: () => 's3://test/null-details',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      // Update audit to have a step that can complete
      const scrapeResultAuditWithStep = new AuditBuilder()
        .addStep('initial', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();

      const result = await scrapeResultAuditWithStep.run(messageWithNullDetails, context);

      // Null details means no counts, so audit should continue (not abort)
      expect(result.status).to.equal(200);
      // Verify no abort was triggered (no skipped flag, no BOT-BLOCKED log)
      expect(context.log.warn).to.not.have.been.calledWithMatch(/\[BOT-BLOCKED\]/);
    });

    it('handles errors during abort processing and rethrows', async () => {
      // Create a site object that throws an error when getBaseURL is called
      const errorSite = {
        getId: () => '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        getBaseURL: () => {
          throw new Error('Site URL retrieval failed');
        },
        getIsLive: () => true,
      };

      // Override Site.findById to return the error-throwing site
      context.dataAccess.Site.findById.resolves(errorSite);

      // Mock site URL resolution request (even though it won't reach this in handleAbort)
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Create a simple audit for testing error handling
      const scrapeResultAudit = new AuditBuilder()
        .addStep('process', async () => ({
          status: 'should-not-reach',
          findings: ['should-not-reach'],
        }))
        .build();

      const messageWithAbort = {
        type: 'cwv',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'error-handling-job',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 3,
            totalUrlsCount: 5,
            byBlockerType: { cloudflare: 3 },
            byHttpStatus: { 403: 3 },
            blockedUrls: [
              { url: 'https://example.com/page1', blockerType: 'cloudflare', httpStatus: 403 },
            ],
          },
        },
        auditContext: {},
      };

      // Should throw the error from site.getBaseURL during handleAbort
      await expect(scrapeResultAudit.run(messageWithAbort, context))
        .to.be.rejectedWith('Site URL retrieval failed');
    });

    it('handles handleAbort with null details (covers line 61 of bot-detection.js)', async () => {
      // Import handleAbort directly to test the || {} fallback on line 61
      const { handleAbort } = await import('../../src/common/bot-detection.js');

      const mockSite = {
        getBaseURL: () => 'https://example.com',
      };

      const mockLog = {
        warn: sinon.stub(),
      };

      const abortWithNullDetails = {
        reason: 'bot-protection',
        details: null, // This will trigger || {} fallback on line 61
      };

      const result = handleAbort(
        abortWithNullDetails,
        'test-job-123',
        'cwv',
        mockSite,
        'test-site-456',
        mockLog,
      );

      // Should return ok response
      expect(result.status).to.equal(200);
      const resultBody = await result.json();
      expect(resultBody.skipped).to.be.true;
      expect(resultBody.reason).to.equal('bot-protection');

      // Should log with empty arrays for HTTP Status and Blocker Types
      expect(mockLog.warn).to.have.been.calledOnce;
      const logCall = mockLog.warn.firstCall.args[0];
      expect(logCall).to.include('[BOT-BLOCKED]');
      expect(logCall).to.include('HTTP Status: []');
      expect(logCall).to.include('Blocker Types: []');
      expect(logCall).to.include('Bot Protected URLs: [none]');
    });

    it('continues audit processing when some URLs are blocked (covers line 128)', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Mock audit creation for normal flow (audit should continue)
      const createdAudit = {
        getId: () => 'audit-partial-123',
        getAuditType: () => 'cwv',
        getFullAuditRef: () => 's3://test/partial',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      // Create a simple audit for testing partial block (should continue processing)
      const scrapeResultAudit = new AuditBuilder()
        .addStep('initial', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();

      const messageWithPartialBlock = {
        type: 'cwv',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'partial-block-job',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 3,
            totalUrlsCount: 10,
            blockedUrls: [
              { url: 'https://example.com/page1', blockerType: 'cloudflare', httpStatus: 403 },
              { url: 'https://example.com/page2', blockerType: 'imperva', httpStatus: 403 },
              { url: 'https://example.com/page3', blockerType: 'akamai', httpStatus: 403 },
            ],
            byBlockerType: { cloudflare: 1, imperva: 1, akamai: 1 },
            byHttpStatus: { 403: 3 },
            auditType: 'cwv',
            siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
            siteUrl: 'https://example.com',
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithPartialBlock, context);

      // Should continue processing (not abort) since only 3/10 URLs blocked
      expect(result.status).to.equal(200);

      // Verify [BOT-BLOCKED] info log was called (line 136-141)
      expect(context.log.info).to.have.been.calledWithMatch(
        /\[BOT-BLOCKED\] Some URLs blocked \(3\/10\), but continuing audit processing for cwv audit on https:\/\/space\.cat as 7 URLs were not blocked by bot protection, jobId=partial-block-job, Blocked URLs: \[.*\]/,
      );

      // Verify the blocked URLs list is included (line 128 creates this list)
      const infoCall = context.log.info.args.find(
        (call) => call && call[0] && call[0].includes('Some URLs blocked (3/10)'),
      );
      expect(infoCall).to.exist;
      const infoLog = infoCall[0];
      expect(infoLog).to.include('https://example.com/page1');
      expect(infoLog).to.include('https://example.com/page2');
      expect(infoLog).to.include('https://example.com/page3');

      // Verify no abort was triggered (no warn log for abort)
      expect(context.log.warn).to.not.have.been.calledWithMatch(/All URLs blocked/);
    });

    it('handles partial block with string URLs in blockedUrls array (covers line 128)', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Mock audit creation for normal flow
      const createdAudit = {
        getId: () => 'audit-string-urls-123',
        getAuditType: () => 'meta-tags',
        getFullAuditRef: () => 's3://test/string-urls',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      // Create a simple audit for testing string URLs
      const scrapeResultAudit = new AuditBuilder()
        .addStep('initial', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();

      const messageWithStringUrls = {
        type: 'meta-tags',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'string-urls-job',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 2,
            totalUrlsCount: 5,
            // blockedUrls as strings instead of objects
            blockedUrls: [
              'https://example.com/page1',
              'https://example.com/page2',
            ],
            byBlockerType: { cloudflare: 2 },
            byHttpStatus: { 403: 2 },
            auditType: 'meta-tags',
            siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
            siteUrl: 'https://example.com',
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithStringUrls, context);

      // Should continue processing
      expect(result.status).to.equal(200);

      // Verify info log includes the string URLs (line 128 handles both string and object URLs)
      const infoCall = context.log.info.args.find(
        (call) => call && call[0] && call[0].includes('Some URLs blocked (2/5)'),
      );
      expect(infoCall).to.exist;
      const infoLog = infoCall[0];
      expect(infoLog).to.include('https://example.com/page1');
      expect(infoLog).to.include('https://example.com/page2');
    });

    it('handles partial block with empty blockedUrls array (covers line 128 fallback)', async () => {
      // Mock site URL
      nock('https://space.cat')
        .get('/')
        .reply(200);

      // Mock audit creation for normal flow
      const createdAudit = {
        getId: () => 'audit-empty-urls-123',
        getAuditType: () => 'broken-backlinks',
        getFullAuditRef: () => 's3://test/empty-urls',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      // Create a simple audit for testing empty URLs
      const scrapeResultAudit = new AuditBuilder()
        .addStep('initial', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();

      const messageWithEmptyUrls = {
        type: 'broken-backlinks',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        jobId: 'empty-urls-job',
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 2,
            totalUrlsCount: 5,
            blockedUrls: [], // Empty array
            byBlockerType: { cloudflare: 2 },
            byHttpStatus: { 403: 2 },
            auditType: 'broken-backlinks',
            siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
            siteUrl: 'https://example.com',
          },
        },
        auditContext: {},
      };

      const result = await scrapeResultAudit.run(messageWithEmptyUrls, context);

      // Should continue processing
      expect(result.status).to.equal(200);

      // Verify info log includes 'none' for empty blockedUrls (line 128 fallback)
      const infoCall = context.log.info.args.find(
        (call) => call && call[0] && call[0].includes('Some URLs blocked (2/5)'),
      );
      expect(infoCall).to.exist;
      const infoLog = infoCall[0];
      expect(infoLog).to.include('Blocked URLs: [none]');
    });
  });
});
