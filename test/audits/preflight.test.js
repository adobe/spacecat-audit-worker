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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import nock from 'nock';
import AWSXray from 'aws-xray-sdk';
import { FirefallClient, GenvarClient } from '@adobe/spacecat-shared-gpt-client';
import {
  isValidUrls, preflightAudit, scrapePages, AUDIT_STEP_SUGGEST, AUDIT_STEP_IDENTIFY,
} from '../../src/preflight/handler.js';
import { runInternalLinkChecks } from '../../src/preflight/internal-links.js';
import { MockContextBuilder } from '../shared.js';
import suggestionData from '../fixtures/preflight/preflight-suggest.json' with { type: 'json' };
import identifyData from '../fixtures/preflight/preflight-identify.json' with { type: 'json' };

use(sinonChai);
use(chaiAsPromised);
describe('Preflight Audit', () => {
  it('should validate pages sent for auditing', () => {
    const urls = [
      'https://main--example--page.aem.page/page1',
    ];

    const result = isValidUrls(urls);
    expect(result).to.be.true;
  });

  describe('runInternalLinkChecks with nock', () => {
    let context;

    beforeEach(() => {
      context = {
        log: {
          warn: sinon.stub(),
          info: sinon.stub(),
        },
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('returns no broken links when all internal links are valid', async () => {
      nock('https://main--example--page.aem.page')
        .head('/foo')
        .reply(200)
        .head('/bar')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/foo">foo</a><a href="https://main--example--page.aem.page/bar">bar</a>' },
          finalUrl: 'https://main--example--page.aem.page/page1',
        },
      }];

      const result = await runInternalLinkChecks(scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
    });

    it('returns broken links for 404 responses', async () => {
      nock('https://main--example--page.aem.page')
        .head('/broken')
        .reply(404);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/broken">broken</a>' },
          finalUrl: 'https://main--example--page.aem.page/page1',
        },
      }];

      const result = await runInternalLinkChecks(scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([
        { pageUrl: 'https://main--example--page.aem.page/page1', href: 'https://main--example--page.aem.page/broken', status: 404 },
      ]);
    });

    it('handles fetch errors', async () => {
      nock('https://main--example--page.aem.page')
        .head('/fail')
        .replyWithError('network fail');

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/fail">fail</a>' },
          finalUrl: 'https://main--example--page.aem.page/page1',
        },
      }];

      const result = await runInternalLinkChecks(scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0]).to.include({
        pageUrl: 'https://main--example--page.aem.page/page1',
        href: 'https://main--example--page.aem.page/fail',
        status: null,
      });
      expect(result.auditResult.brokenInternalLinks[0].error).to.match(/network fail/);
    });
  });

  describe('isValidUrls', () => {
    it('returns true for a valid array of urls', () => {
      const urls = [
        'https://main--example--page.aem.page',
        'https://another.com/page',
      ];
      expect(isValidUrls(urls)).to.be.true;
    });

    it('returns false for an empty array', () => {
      expect(isValidUrls([])).to.be.false;
    });

    it('returns false if not all items are valid urls', () => {
      const urls = [
        'https://main--example--page.aem.page',
        'not-a-url',
      ];
      expect(isValidUrls(urls)).to.be.false;
    });

    it('returns false if input is not an array', () => {
      expect(isValidUrls(null)).to.be.false;
      expect(isValidUrls(undefined)).to.be.false;
      expect(isValidUrls('https://main--example--page.aem.page')).to.be.false;
      expect(isValidUrls({ url: 'https://main--example--page.aem.page' })).to.be.false;
    });
  });

  describe('scrapePages', () => {
    it('returns the correct object for valid input', async () => {
      const context = {
        site: { getId: () => 'site-123' },
        job: {
          getMetadata: () => ({
            payload: {
              step: AUDIT_STEP_IDENTIFY,
              urls: [
                'https://main--example--page.aem.page',
                'https://another.com/page',
              ],
            },
          }),
        },
      };
      const result = await scrapePages(context);
      expect(result).to.deep.equal({
        urls: [
          { url: 'https://main--example--page.aem.page' },
          { url: 'https://another.com/page' },
        ],
        siteId: 'site-123',
        type: 'preflight',
        allowCache: false,
        options: {
          enableAuthentication: true,
          screenshotTypes: [],
        },
      });
    });

    it('throws an error if urls are invalid', async () => {
      const context = {
        site: { getId: () => 'site-123' },
        job: {
          getMetadata: () => ({
            payload: {
              step: AUDIT_STEP_IDENTIFY,
              urls: [
                'not-a-url',
                'https://main--example--page.aem.page',
              ],
            },
          }),
        },
      };
      await expect(scrapePages(context)).to.be.rejectedWith('[preflight-audit] site: site-123. Invalid urls provided for scraping');
    });
  });

  describe('preflightAudit', () => {
    let context;
    let site;
    let job;
    let s3Client;
    let secretsClient;
    let configuration;
    let firefallClient;
    let genvarClient;

    const sandbox = sinon.createSandbox();

    beforeEach(() => {
      site = {
        getId: () => 'site-123',
        getBaseURL: () => 'https://main--example--page.aem.page',
      };
      s3Client = {
        send: sinon.stub(),
      };
      secretsClient = {
        send: sinon.stub().resolves(
          {
            SecretString: JSON.stringify({ PAGE_AUTH_TOKEN: 'token' }),
          },
        ),
      };
      job = {
        getMetadata: () => ({
          payload: {
            step: AUDIT_STEP_IDENTIFY,
            urls: ['https://main--example--page.aem.page/page1'],
          },
        }),
        getStatus: sinon.stub().returns('IN_PROGRESS'),
        getId: () => 'job-123',
        setStatus: sinon.stub(),
        setResultType: sinon.stub(),
        setResult: sinon.stub(),
        setEndedAt: sinon.stub(),
        setError: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      firefallClient = {
        fetchChatCompletion: sandbox.stub(),
      };
      genvarClient = {
        generateSuggestions: sandbox.stub(),
      };
      sinon.stub(AWSXray, 'captureAWSv3Client').returns(secretsClient);
      sandbox.stub(FirefallClient, 'createFrom').returns(firefallClient);
      sandbox.stub(GenvarClient, 'createFrom').returns(genvarClient);
      context = new MockContextBuilder()
        .withSandbox(sinon.createSandbox())
        .withOverrides({
          job,
          site,
          s3Client,
          func: {
            version: 'test',
          },
        })
        .build();

      // Mock AsyncJob.findById to return a fresh job entity for intermediate saves and final save
      context.dataAccess.AsyncJob.findById = sinon.stub().callsFake(() => Promise.resolve({
        getId: () => 'job-123',
        setResult: sinon.stub(),
        setStatus: sinon.stub(),
        setResultType: sinon.stub(),
        setEndedAt: sinon.stub(),
        setError: sinon.stub(),
        save: sinon.stub().resolves(),
      }));

      configuration = {
        isHandlerEnabledForSite: sinon.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      // Setup S3 client mocks
      s3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'scrapes/site-123/page1/scrape.json' },
        ],
      });
      const head = '<head><link rel="canonical" href="https://example.com/wrong-canonical"/></head>';
      const body = `<body>${'a'.repeat(10)}lorem ipsum<a href="broken"></a><a href="http://test.com"></a><h1>First H1</h1><h1>Second H1</h1></body>`;
      const html = `<!DOCTYPE html> <html lang="en">${head}${body}</html>`;
      s3Client.send.onCall(1).resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: { rawBody: html },
            finalUrl: 'https://main--example--page.aem.page/page1',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['First H1', 'First H1'],
            },
          })),
        },
      });
      s3Client.send.onCall(2).resolves({
        Contents: [
          { Key: 'scrapes/site-123/page1/scrape.json' },
        ],
        IsTruncated: false,
        NextContinuationToken: 'token',
      });
      s3Client.send.onCall(4).resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              rawBody: '<a href="/foo">foo</a>',
              tags: {
                title: 'Page 1 Title',
                description: 'Page 1 Description',
                h1: ['Page 1 H1', 'Page 1 H1'],
              },
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          })),
        },
      });

      nock('https://main--example--page.aem.page')
        .get('/page1')
        .reply(200, html, { 'Content-Type': 'text/html' });

      nock('https://main--example--page.aem.page')
        .head('/broken')
        .reply(404);
    });

    afterEach(() => {
      sinon.restore();
      sandbox.restore();
    });

    it('completes successfully on the happy path for the suggest step', async () => {
      job.getMetadata = () => ({
        payload: {
          step: AUDIT_STEP_SUGGEST,
          urls: ['https://main--example--page.aem.page/page1'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(false);
      genvarClient.generateSuggestions.resolves({
        '/page1': {
          h1: {
            aiRationale: 'The H1 tag is catchy and broad...',
            aiSuggestion: 'Our Story: Innovating Comfort for Every Home',
          },
          title: {
            aiRationale: 'The title is catchy and broad...',
            aiSuggestion: 'Our Story: Innovating Comfort for Every Home',
          },
        },
      });

      await preflightAudit(context);

      expect(configuration.isHandlerEnabledForSite).not.to.have.been.called;
      expect(genvarClient.generateSuggestions).to.have.been.called;

      // Verify that AsyncJob.findById was called for the final save
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;

      // Get the last call to AsyncJob.findById (which is the final save)
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      expect(finalJobEntity.setStatus).to.have.been.calledWith('COMPLETED');
      expect(finalJobEntity.setResultType).to.have.been.called;
      expect(finalJobEntity.setEndedAt).to.have.been.called;
      expect(finalJobEntity.save).to.have.been.called;

      // Verify that setResult was called with the expected data structure
      expect(finalJobEntity.setResult).to.have.been.called;
      const actualResult = finalJobEntity.setResult.getCall(0).args[0];
      // Verify the structure matches the expected data (excluding profiling which is dynamic)
      expect(actualResult).to.deep.equal(suggestionData.map((expected) => ({
        ...expected,
        profiling: actualResult[0].profiling, // Use actual profiling data
      })));
    });

    it('completes successfully on the happy path for the identify step', async () => {
      s3Client.send.onCall(1).resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: { rawBody: '' },
            finalUrl: 'https://main--example--page.aem.page/page1',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: [],
            },
          })),
        },
      });
      job.getMetadata = () => ({
        payload: {
          step: AUDIT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/page1'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(false);

      await preflightAudit(context);

      expect(configuration.isHandlerEnabledForSite).not.to.have.been.called;
      expect(genvarClient.generateSuggestions).not.to.have.been.called;

      // Verify that AsyncJob.findById was called for the final save
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;

      // Get the last call to AsyncJob.findById (which is the final save)
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      expect(finalJobEntity.setStatus).to.have.been.calledWith('COMPLETED');
      expect(finalJobEntity.setResultType).to.have.been.called;
      expect(finalJobEntity.setEndedAt).to.have.been.called;
      expect(finalJobEntity.save).to.have.been.called;

      // Verify that setResult was called with the expected data structure
      expect(finalJobEntity.setResult).to.have.been.called;
      const actualResult = finalJobEntity.setResult.getCall(0).args[0];
      // Verify the structure matches the expected data (excluding profiling which is dynamic)
      expect(actualResult).to.deep.equal(identifyData.map((expected) => ({
        ...expected,
        profiling: actualResult[0].profiling, // Use actual profiling data
      })));
    });

    it('throws if job is not in progress', async () => {
      job.getStatus.returns('COMPLETED');
      await expect(preflightAudit(context)).to.be.rejectedWith('[preflight-audit] site: site-123. Job not in progress for jobId: job-123. Status: COMPLETED');
    });

    it('throws if the provided urls are invalid', async () => {
      job.getMetadata = () => ({
        payload: {
          step: AUDIT_STEP_IDENTIFY,
          urls: ['not-a-url'],
        },
      });

      await expect(preflightAudit(context)).to.be.rejectedWith('[preflight-audit] site: site-123. Invalid URL provided: not-a-url');
    });

    it('sets status to FAILED if an error occurs', async () => {
      job.getMetadata = () => ({
        payload: {
          step: AUDIT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/page1'],
        },
      });
      s3Client.send.onCall(0).rejects(new Error('S3 error'));

      await expect(preflightAudit(context)).to.be.rejectedWith('S3 error');

      // Verify that AsyncJob.findById was called for the error handling
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;

      // Get the last call to AsyncJob.findById (which is the final save)
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      expect(finalJobEntity.setStatus).to.have.been.calledWith('FAILED');
      expect(finalJobEntity.save).to.have.been.called;
    });

    it('logs timing information for each sub-audit', async () => {
      await preflightAudit(context);

      // Verify that AsyncJob.findById was called for the final save
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;

      // Get the last call to AsyncJob.findById (which is the final save)
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      // Get the result that was set on the job entity
      expect(finalJobEntity.setResult).to.have.been.called;
      const result = finalJobEntity.setResult.getCall(0).args[0];

      // Verify that each page result has profiling data
      result.forEach((pageResult) => {
        expect(pageResult).to.have.property('profiling');
        expect(pageResult.profiling).to.have.property('total');
        expect(pageResult.profiling).to.have.property('startTime');
        expect(pageResult.profiling).to.have.property('endTime');
        expect(pageResult.profiling).to.have.property('breakdown');

        // Verify breakdown structure
        const { breakdown } = pageResult.profiling;
        const expectedChecks = ['canonical', 'links', 'metatags', 'dom'];

        expect(breakdown).to.be.an('array');
        expect(breakdown).to.have.lengthOf(expectedChecks.length);

        breakdown.forEach((check, index) => {
          expect(check).to.have.property('name', expectedChecks[index]);
          expect(check).to.have.property('duration');
          expect(check).to.have.property('startTime');
          expect(check).to.have.property('endTime');
        });
      });
    });

    it('saves intermediate results after each audit step', async () => {
      await preflightAudit(context);

      // Verify that AsyncJob.findById was called for each intermediate save and final save
      // (total of 5 times: 4 intermediate + 1 final)
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;
      expect(context.dataAccess.AsyncJob.findById.callCount).to.equal(5);
    });

    it('handles errors during intermediate saves gracefully', async () => {
      // Mock AsyncJob.findById to return job entities that fail on save for intermediate saves
      let findByIdCallCount = 0;

      context.dataAccess.AsyncJob.findById = sinon.stub().callsFake(() => {
        findByIdCallCount += 1;
        return Promise.resolve({
          getId: () => 'job-123',
          setResult: sinon.stub(),
          setStatus: sinon.stub(),
          setResultType: sinon.stub(),
          setEndedAt: sinon.stub(),
          setError: sinon.stub(),
          save: sinon.stub().callsFake(async () => {
            // Only fail intermediate saves (first 4 calls are intermediate saves)
            if (findByIdCallCount <= 4) {
              throw new Error('Connection timeout to database');
            }
            return Promise.resolve();
          }),
        });
      });

      await preflightAudit(context);

      // Verify that warn was called for failed intermediate saves
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to save intermediate results: Connection timeout to database/),
      );

      // Verify that the audit completed successfully despite intermediate save failures
      // The final save should have been successful (call #5)
      expect(context.dataAccess.AsyncJob.findById.callCount).to.be.greaterThan(4);
    });
  });
});
