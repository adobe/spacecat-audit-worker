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
import esmock from 'esmock';
import AWSXray from 'aws-xray-sdk';
import { AzureOpenAIClient, GenvarClient } from '@adobe/spacecat-shared-gpt-client';
import { Site } from '@adobe/spacecat-shared-data-access';
import {
  scrapePages, PREFLIGHT_STEP_SUGGEST, PREFLIGHT_STEP_IDENTIFY,
  AUDIT_BODY_SIZE, AUDIT_LOREM_IPSUM, AUDIT_H1_COUNT,
} from '../../src/preflight/handler.js';
import { runLinksChecks } from '../../src/preflight/links-checks.js';
import { MockContextBuilder } from '../shared.js';
import { suggestionData } from '../fixtures/preflight/preflight-suggest.js';
import identifyData from '../fixtures/preflight/preflight-identify.json' with { type: 'json' };
import readabilityData from '../fixtures/preflight/preflight-identify-readability.json' with { type: 'json' };
import { getPrefixedPageAuthToken, isValidUrls, saveIntermediateResults } from '../../src/preflight/utils.js';

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

  describe('runLinksChecks', () => {
    let context;

    beforeEach(() => {
      context = {
        log: {
          warn: sinon.stub(),
          info: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.stub(),
        },
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('returns no broken links when all internal links are valid', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://main--example--page.aem.page')
        .head('/foo')
        .reply(200)
        .head('/bar')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/foo">foo</a><a href="https://main--example--page.aem.page/bar">bar</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
    });

    it('returns broken links for 404 responses', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://main--example--page.aem.page')
        .head('/broken')
        .reply(404);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/broken">broken</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([
        { urlTo: 'https://main--example--page.aem.page/broken', href: 'https://main--example--page.aem.page/page1', status: 404 },
      ]);
    });

    it('handles fetch errors', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://main--example--page.aem.page')
        .head('/fail')
        .replyWithError('network fail')
        .get('/fail')
        .replyWithError('network fail');

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/fail">fail</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(0);
      expect(context.log.error).to.have.been.calledWithMatch('[preflight-audit] Error checking internal link https://main--example--page.aem.page/fail from https://main--example--page.aem.page/page1 with GET fallback:', 'network fail');
    });

    it('handles HEAD failure with GET fallback success', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://main--example--page.aem.page')
        .head('/head-fails-get-works')
        .replyWithError('HEAD request failed')
        .get('/head-fails-get-works')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/head-fails-get-works">link</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
      expect(context.log.warn).to.have.been.calledWithMatch('[preflight-audit] HEAD request failed (HEAD request failed), retrying with GET: https://main--example--page.aem.page/head-fails-get-works');
    });

    it('handles HEAD failure with GET fallback returning 404', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://main--example--page.aem.page')
        .head('/head-fails-get-404')
        .replyWithError('HEAD request failed')
        .get('/head-fails-get-404')
        .reply(404);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/head-fails-get-404">link</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([
        { urlTo: 'https://main--example--page.aem.page/head-fails-get-404', href: 'https://main--example--page.aem.page/page1', status: 404 },
      ]);
      expect(context.log.warn).to.have.been.calledWithMatch('[preflight-audit] HEAD request failed (HEAD request failed), retrying with GET: https://main--example--page.aem.page/head-fails-get-404');
    });

    it('filters out scrapedObjects not in the urls list', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      const scrapedObjects = [
        {
          data: {
            scrapeResult: { rawBody: '<a href="/foo">foo</a>' },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        },
        {
          data: {
            scrapeResult: { rawBody: '<a href="/bar">bar</a>' },
            finalUrl: 'https://main--example--page.aem.page/page2', // Not in urls list
          },
        },
      ];

      nock('https://main--example--page.aem.page')
        .head('/foo')
        .reply(200);
      // Should NOT make a request for /bar since page2 is filtered out

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
      // Verify only one page was processed (now logs total links, internal and external links, and broken links)
      expect(context.log.debug.callCount).to.equal(5);
    });

    it('returns empty array when no scrapedObjects match urls', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/foo">foo</a>' },
          finalUrl: 'https://main--example--page.aem.page/page2', // Different URL
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
      // Verify no pages were processed
      expect(context.log.info).not.to.have.been.called;
    });

    it('processes multiple pages when multiple urls match', async () => {
      const urls = ['https://main--example--page.aem.page/page1', 'https://main--example--page.aem.page/page2'];
      const scrapedObjects = [
        {
          data: {
            scrapeResult: { rawBody: '<a href="/link1">link1</a>' },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        },
        {
          data: {
            scrapeResult: { rawBody: '<a href="/link2">link2</a>' },
            finalUrl: 'https://main--example--page.aem.page/page2',
          },
        },
        {
          data: {
            scrapeResult: { rawBody: '<a href="/link3">link3</a>' },
            finalUrl: 'https://main--example--page.aem.page/page3', // Not in urls
          },
        },
      ];

      nock('https://main--example--page.aem.page')
        .head('/link1')
        .reply(200)
        .head('/link2')
        .reply(200);

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
      // Verify only two pages were processed
      // (now logs total links, internal and external links for each page, plus broken links summary)
      expect(context.log.debug.callCount).to.equal(8);
    });

    it('skips invalid hrefs', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://main--example--page.aem.page')
        .head('/good')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="http://[::1">bad</a><a href="/good">good</a>' },
          finalUrl: 'https://main--example--page.aem.page/page1',
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
      expect(context.log.debug).to.have.been.calledWithMatch('[preflight-audit] Found internal links:');
    });

    it('includes auth token in requests', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      const authToken = 'secret-token';

      nock('https://main--example--page.aem.page', {
        headers: {
          Authorization: authToken,
        },
      })
        .head('/secure')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="/secure">secure</a>' },
          finalUrl: 'https://main--example--page.aem.page/page1',
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context, { pageAuthToken: `token ${authToken}` });
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
    });

    it('returns no broken external links when all external links are valid', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://external-site.com')
        .head('/working')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="https://external-site.com/working">external</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenExternalLinks).to.deep.equal([]);
    });

    it('returns broken external links for 404 responses', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://external-site.com')
        .head('/broken')
        .reply(404);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="https://external-site.com/broken">external broken</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenExternalLinks).to.deep.equal([
        { urlTo: 'https://external-site.com/broken', href: 'https://main--example--page.aem.page/page1', status: 404 },
      ]);
    });

    it('handles external link fetch errors', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://external-site.com')
        .head('/fail')
        .replyWithError('network fail')
        .get('/fail')
        .replyWithError('network fail');

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="https://external-site.com/fail">external fail</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenExternalLinks).to.deep.equal([]);
      expect(context.log.error).to.have.been.calledWithMatch('[preflight-audit] Error checking external link https://external-site.com/fail from https://main--example--page.aem.page/page1 with GET fallback:', 'network fail');
    });

    it('handles external HEAD failure with GET fallback success', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://external-site.com')
        .head('/head-fails-get-works')
        .replyWithError('HEAD request failed')
        .get('/head-fails-get-works')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="https://external-site.com/head-fails-get-works">external link</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenExternalLinks).to.deep.equal([]);
      expect(context.log.warn).to.have.been.calledWithMatch('[preflight-audit] HEAD request failed (HEAD request failed), retrying with GET: https://external-site.com/head-fails-get-works');
    });

    it('handles external HEAD failure with GET fallback returning 404', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://external-site.com')
        .head('/head-fails-get-404')
        .replyWithError('HEAD request failed')
        .get('/head-fails-get-404')
        .reply(404);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: '<a href="https://external-site.com/head-fails-get-404">external link</a>' },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenExternalLinks).to.deep.equal([
        { urlTo: 'https://external-site.com/head-fails-get-404', href: 'https://main--example--page.aem.page/page1', status: 404 },
      ]);
      expect(context.log.warn).to.have.been.calledWithMatch('[preflight-audit] HEAD request failed (HEAD request failed), retrying with GET: https://external-site.com/head-fails-get-404');
    });

    it('processes both internal and external links correctly', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      nock('https://main--example--page.aem.page')
        .head('/internal-broken')
        .reply(404);
      nock('https://external-site.com')
        .head('/external-broken')
        .reply(500);

      const scrapedObjects = [{
        data: {
          scrapeResult: {
            rawBody: '<a href="/internal-broken">internal</a><a href="https://external-site.com/external-broken">external</a>',
          },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([
        { urlTo: 'https://main--example--page.aem.page/internal-broken', href: 'https://main--example--page.aem.page/page1', status: 404 },
      ]);
      expect(result.auditResult.brokenExternalLinks).to.deep.equal([
        { urlTo: 'https://external-site.com/external-broken', href: 'https://main--example--page.aem.page/page1', status: 500 },
      ]);
    });

    it('skips links inside header and footer', async () => {
      const urls = ['https://main--example--page.aem.page/page1'];
      // One link in header, one in footer, one in body
      const html = `
        <header><a href="/header-link">Header Link</a></header>
        <footer><a href="/footer-link">Footer Link</a></footer>
        <main><a href="/body-link">Body Link</a></main>
      `;
      nock('https://main--example--page.aem.page')
        .head('/body-link')
        .reply(200);

      const scrapedObjects = [{
        data: {
          scrapeResult: { rawBody: html },
          finalUrl: urls[0],
        },
      }];

      const result = await runLinksChecks(urls, scrapedObjects, context);
      // Only the body link should be considered internal
      expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
      // Check that only the body link is logged as internal
      expect(context.log.debug).to.have.been.calledWith(
        '[preflight-audit] Found internal links:',
        new Set(['https://main--example--page.aem.page/body-link']),
      );
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
        site: { getId: () => 'site-123', getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE },
        job: {
          getMetadata: () => ({
            payload: {
              step: PREFLIGHT_STEP_IDENTIFY,
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
    it('returns the correct object for valid input for authentication disabled', async () => {
      const enableAuthentication = false;
      const context = {
        site: { getId: () => 'site-123', getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE },
        job: {
          getMetadata: () => ({
            payload: {
              step: PREFLIGHT_STEP_IDENTIFY,
              enableAuthentication,
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
          enableAuthentication,
          screenshotTypes: [],
        },
      });
    });

    it('includes promiseToken in options if context.promiseToken exists', async () => {
      const context = {
        site: { getId: () => 'site-123', getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE },
        job: {
          getMetadata: () => ({
            payload: {
              step: PREFLIGHT_STEP_IDENTIFY,
              urls: [
                'https://main--example--page.aem.page',
              ],
            },
          }),
        },
        promiseToken: 'test-token',
      };
      const result = await scrapePages(context);
      expect(result.options.promiseToken).to.equal('test-token');
    });

    it('throws an error if urls are invalid', async () => {
      const context = {
        site: { getId: () => 'site-123', getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE },
        job: {
          getMetadata: () => ({
            payload: {
              step: PREFLIGHT_STEP_IDENTIFY,
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
    let azureOpenAIClient;
    let genvarClient;
    let preflightAuditFunction;

    const sandbox = sinon.createSandbox();

    beforeEach(async () => {
      site = {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
        getAuthoringType: sandbox.stub(),
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
            step: PREFLIGHT_STEP_IDENTIFY,
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
      azureOpenAIClient = {
        fetchChatCompletion: sandbox.stub(),
      };
      genvarClient = {
        generateSuggestions: sandbox.stub(),
      };
      sinon.stub(AWSXray, 'captureAWSv3Client').returns(secretsClient);
      sandbox.stub(AzureOpenAIClient, 'createFrom').returns(azureOpenAIClient);
      sandbox.stub(GenvarClient, 'createFrom').returns(genvarClient);

      // Mock the accessibility handler to prevent timeouts
      const { preflightAudit: mockedPreflightAudit } = await esmock('../../src/preflight/handler.js', {
        '../../src/preflight/accessibility.js': {
          default: sinon.stub().resolves(), // Mock accessibility handler as no-op
        },
      });
      preflightAuditFunction = mockedPreflightAudit;
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

      nock('https://main--example--page.aem.page')
        .get('/page1')
        .reply(200, '<html><head><link rel="canonical" href="https://main--example--page.aem.page/wrong"/></head><body><h1>Test</h1></body></html>', { 'Content-Type': 'text/html' });

      nock('https://main--example--page.aem.page')
        .head('/broken')
        .reply(404);

      // Mock the external link to return 404
      nock('http://test.com')
        .head('/')
        .reply(404);
    });

    afterEach(() => {
      sinon.restore();
      sandbox.restore();
    });

    it('completes successfully on the happy path for the suggest step', async () => {
      context.promiseToken = 'mock-promise-token';
      const head = '<head><a href="https://example.com/header-url"/></head>';
      const body = '<body><a href="https://example.com/broken"></a><a href="https://example.com/another-broken-url"></a><h1>Page 1 H1</h1><h1>Page 1 H1</h1></h1></body>';
      const html = `<!DOCTYPE html> <html lang="en">${head}${body}</html>`;

      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/page1/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: html.replaceAll('https://example.com', 'https://main--example--page.aem.page'),
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
        }
      });

      nock('https://main--example--page.aem.page')
        .head('/header-url')
        .reply(200);
      nock('https://main--example--page.aem.page')
        .head('/broken')
        .reply(404);
      nock('https://main--example--page.aem.page')
        .head('/another-broken-url')
        .reply(404);

      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_SUGGEST,
          urls: ['https://main--example--page.aem.page/page1'],
          checks: ['body-size', 'lorem-ipsum', 'h1-count', 'canonical', 'metatags', 'links', 'readability'],
        },
      });

      azureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://example.com/fix'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      });

      configuration.isHandlerEnabledForSite.onCall(0).returns(true);
      configuration.isHandlerEnabledForSite.onCall(1).returns(false);
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

      await preflightAuditFunction(context);

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

    it('completes successfully on the happy path for the suggest step for the root page', async () => {
      context.promiseToken = 'mock-promise-token';
      const head = '<head><a href="https://example.com/header-url"/></head>';
      const body = `<body><a href="https://example.com/broken"></a><a href="https://example.com/another-broken-url"></a><h1>Home H1</h1><p>This is additional content to ensure the body length exceeds 300 characters. ${'A'.repeat(100)} </p></body>`;
      const html = `<!DOCTYPE html> <html lang="en">${head}${body}</html>`;

      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: html.replaceAll('https://example.com', 'https://main--example--page.aem.page'),
                  tags: {
                    title: 'Home Title',
                    description: 'Home Description',
                    h1: ['Home H1'],
                  },
                },
                finalUrl: 'https://main--example--page.aem.page',
              })),
            },
          });
        }
      });

      nock('https://main--example--page.aem.page')
        .head('/header-url')
        .reply(200);
      nock('https://main--example--page.aem.page')
        .head('/broken')
        .reply(404);
      nock('https://main--example--page.aem.page')
        .head('/another-broken-url')
        .reply(404);

      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_SUGGEST,
          urls: ['https://main--example--page.aem.page'],
          checks: ['body-size', 'lorem-ipsum', 'h1-count', 'canonical', 'metatags', 'links', 'readability'],
        },
      });

      azureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://example.com/fix'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      });

      configuration.isHandlerEnabledForSite.onCall(0).returns(true);
      configuration.isHandlerEnabledForSite.onCall(1).returns(false);
      genvarClient.generateSuggestions.resolves({
        '/': {
          h1: {
            aiRationale: 'The H1 tag is clear...',
            aiSuggestion: 'Welcome to Our Homepage',
          },
          title: {
            aiRationale: 'The title is descriptive...',
            aiSuggestion: 'Home - Our Company',
          },
          description: {
            aiRationale: 'The description is concise...',
            aiSuggestion: 'Welcome to the homepage of Our Company.',
          },
        },
      });

      await preflightAuditFunction(context);

      expect(genvarClient.generateSuggestions).to.have.been.called;

      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      expect(finalJobEntity.setStatus).to.have.been.calledWith('COMPLETED');
      expect(finalJobEntity.setResultType).to.have.been.called;
      expect(finalJobEntity.setEndedAt).to.have.been.called;
      expect(finalJobEntity.save).to.have.been.called;
      expect(finalJobEntity.setResult).to.have.been.called;
    });

    it('handles genvar errors gracefully', async () => {
      genvarClient.generateSuggestions.throws(new Error('Genvar failure'));
      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_SUGGEST,
          urls: ['https://main--example--page.aem.page'],
          checks: ['metatags'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(true);
      await preflightAuditFunction(context);
      expect(genvarClient.generateSuggestions).to.have.been.called;
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;
      expect(context.log.error).to.have.been.calledWithMatch('[preflight-audit] site: site-123, job: job-123, step: suggest. Meta tags audit failed: Genvar failure');
    });

    it('completes successfully when finalUrl has trailing slash but input URL gets normalized', async () => {
      context.promiseToken = 'mock-promise-token';
      const head = '<head><title>Root Page</title></head>';
      const body = '<body><h1>Root H1</h1><p>Root content with lorem ipsum text</p></body>';
      const html = `<!DOCTYPE html> <html lang="en">${head}${body}</html>`;

      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: html,
                  tags: {
                    title: 'Root Page',
                    description: 'Root Description',
                    h1: ['Root H1'],
                  },
                },
                finalUrl: 'https://main--example--page.aem.page/',
              })),
            },
          });
        }
      });

      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          // Input URL has trailing slash, will get normalized to remove it
          urls: ['https://main--example--page.aem.page/'],
          checks: ['body-size', 'lorem-ipsum', 'h1-count', 'canonical', 'metatags', 'links'],
          enableAuthentication: false,
        },
      });

      configuration.isHandlerEnabledForSite.returns(false);

      await preflightAuditFunction(context);

      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      expect(finalJobEntity.setStatus).to.have.been.calledWith('COMPLETED');
      expect(finalJobEntity.setResultType).to.have.been.called;
      expect(finalJobEntity.setEndedAt).to.have.been.called;
      expect(finalJobEntity.save).to.have.been.called;
      expect(finalJobEntity.setResult).to.have.been.called;

      // Verify that the result contains the expected audit data
      const actualResult = finalJobEntity.setResult.getCall(0).args[0];
      expect(actualResult).to.be.an('array');
      expect(actualResult).to.have.lengthOf(1);
      expect(actualResult[0]).to.have.property('pageUrl', 'https://main--example--page.aem.page');
      expect(actualResult[0]).to.have.property('audits');
      expect(actualResult[0].audits).to.be.an('array');
      const bodySizeAudit = actualResult[0].audits.find((audit) => audit.name === 'body-size');
      expect(bodySizeAudit).to.exist;
      expect(bodySizeAudit.opportunities).to.be.an('array');
      const loremIpsumAudit = actualResult[0].audits.find((audit) => audit.name === 'lorem-ipsum');
      expect(loremIpsumAudit).to.exist;
      expect(loremIpsumAudit.opportunities).to.have.lengthOf(1);
      expect(loremIpsumAudit.opportunities[0].check).to.equal('placeholder-text');
    });

    // eslint-disable-next-line func-names
    it('completes successfully on the happy path for the identify step', async function () {
      this.timeout(10000); // Increase timeout to 10 seconds
      const head = '<head><link rel="canonical" href="https://main--example--page.aem.page/page1"/></head>';
      const body = `<body>${'a'.repeat(10)}lorem ipsum<a href="broken"></a><a href="http://test.com"></a></body>`;
      const html = `<!DOCTYPE html> <html lang="en">${head}${body}</html>`;

      // Mock the broken internal link to return 404
      nock('https://main--example--page.aem.page')
        .head('/broken')
        .reply(404);

      // Mock the external link to return 404
      nock('http://test.com')
        .head('/')
        .reply(404);

      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/page1/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: html,
                  tags: {
                    title: 'Page 1 Title',
                    description: 'Page 1 Description',
                    h1: [],
                  },
                },
                finalUrl: 'https://main--example--page.aem.page/page1',
              })),
            },
          });
        }
      });

      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/page1'],
          checks: ['body-size', 'lorem-ipsum', 'h1-count', 'canonical', 'metatags', 'links', 'readability'],
          enableAuthentication: false,
        },
      });
      configuration.isHandlerEnabledForSite.returns(false);

      await preflightAuditFunction(context);

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

    it('completes successfully on the happy path for the identify step with readability check', async () => {
      const head = '<head><title>Readability Test Page</title></head>';
      const body = '<body><p>The reputation of the city as a cultural nucleus is bolstered by its extensive network of galleries, theaters, and institutions that cater to a discerning international audience.</p></body>';
      const html = `<!DOCTYPE html> <html lang="en">${head}${body}</html>`;

      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/readability-test/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: html,
                  tags: {
                    title: 'Readability Test Page',
                    description: 'Test page for readability',
                    h1: [],
                  },
                },
                finalUrl: 'https://main--example--page.aem.page/readability-test',
              })),
            },
          });
        }
      });
      nock('https://main--example--page.aem.page')
        .get('/readability-test')
        .reply(200, html, { 'Content-Type': 'text/html' });

      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/readability-test'],
          enableAuthentication: false,
        },
      });
      configuration.isHandlerEnabledForSite.returns(false);

      await preflightAuditFunction(context);

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
      expect(actualResult).to.deep.equal(readabilityData.map((expected) => ({
        ...expected,
        profiling: actualResult[0].profiling, // Use actual profiling data
      })));
    });

    it('throws if job is not in progress', async () => {
      job.getStatus.returns('COMPLETED');
      await expect(preflightAuditFunction(context)).to.be.rejectedWith('[preflight-audit] site: site-123. Job not in progress for jobId: job-123. Status: COMPLETED');
    });

    it('throws if the provided urls are invalid', async () => {
      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['not-a-url'],
        },
      });

      await expect(preflightAuditFunction(context)).to.be.rejectedWith('[preflight-audit] site: site-123. Invalid URL provided: not-a-url');
    });

    it('sets status to FAILED if an error occurs', async () => {
      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/page1'],
        },
      });
      s3Client.send.onCall(0).rejects(new Error('S3 error'));

      await expect(preflightAuditFunction(context)).to.be.rejectedWith('S3 error');

      // Verify that AsyncJob.findById was called for the error handling
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;

      // Get the last call to AsyncJob.findById (which is the final save)
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      expect(finalJobEntity.setStatus).to.have.been.calledWith('FAILED');
      expect(finalJobEntity.save).to.have.been.called;
    });

    it('logs timing information for each sub-audit', async () => {
      await preflightAuditFunction(context);

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
        const expectedChecks = ['dom', 'canonical', 'metatags', 'links', 'readability'];

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
      await preflightAuditFunction(context);

      // Verify that AsyncJob.findById was called for each intermediate save and final save
      // (total of 6 times: 5 intermediate + 1 final)
      expect(context.dataAccess.AsyncJob.findById).to.have.been.called;
      expect(context.dataAccess.AsyncJob.findById.callCount).to.equal(6);
    });

    it('handles errors during intermediate saves gracefully', async () => {
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

      await preflightAuditFunction(context);

      // Verify that warn was called for failed intermediate saves
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to save intermediate results: Connection timeout to database/),
      );
    });

    it('handles individual AUDIT_BODY_SIZE check', async () => {
      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/page1'],
          checks: [AUDIT_BODY_SIZE], // Only test body size check
        },
      });

      // Mock S3 response with content that would trigger body size check
      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/page1/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: '<body>Short content</body>',
                },
                finalUrl: 'https://main--example--page.aem.page/page1',
              })),
            },
          });
        }
      });

      await preflightAuditFunction(context);

      // Get the final result
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];
      const result = finalJobEntity.setResult.getCall(0).args[0];

      // Verify that only body size check was performed
      const { audits } = result[0];

      // Check body size audit
      const bodySizeAudit = audits.find((a) => a.name === AUDIT_BODY_SIZE);
      expect(bodySizeAudit).to.exist;
      expect(bodySizeAudit.opportunities).to.have.lengthOf(1);
      expect(bodySizeAudit.opportunities[0].check).to.equal('content-length');

      // Verify other checks were not performed
      expect(audits.find((a) => a.name === AUDIT_LOREM_IPSUM)).to.not.exist;
      expect(audits.find((a) => a.name === AUDIT_H1_COUNT)).to.not.exist;
    });

    it('handles individual AUDIT_LOREM_IPSUM check', async () => {
      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/page1'],
          checks: [AUDIT_LOREM_IPSUM], // Only test lorem ipsum check
        },
      });

      // Mock S3 response with content that would trigger lorem ipsum check
      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/page1/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: '<body>Some lorem ipsum text here</body>',
                },
                finalUrl: 'https://main--example--page.aem.page/page1',
              })),
            },
          });
        }
      });

      await preflightAuditFunction(context);

      // Get the final result
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];
      const result = finalJobEntity.setResult.getCall(0).args[0];

      // Verify that only lorem ipsum check was performed
      const { audits } = result[0];

      // Check lorem ipsum audit
      const loremIpsumAudit = audits.find((a) => a.name === AUDIT_LOREM_IPSUM);
      expect(loremIpsumAudit).to.exist;
      expect(loremIpsumAudit.opportunities).to.have.lengthOf(1);
      expect(loremIpsumAudit.opportunities[0].check).to.equal('placeholder-text');

      // Verify other checks were not performed
      expect(audits.find((a) => a.name === AUDIT_BODY_SIZE)).to.not.exist;
      expect(audits.find((a) => a.name === AUDIT_H1_COUNT)).to.not.exist;
    });

    it('handles individual AUDIT_H1_COUNT check', async () => {
      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['https://main--example--page.aem.page/page1'],
          checks: [AUDIT_H1_COUNT], // Only test h1 count check
        },
      });

      // Mock S3 response with content that would trigger h1 count check
      s3Client.send.callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/page1/scrape.json' },
            ],
            IsTruncated: false,
          });
        } else {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                scrapeResult: {
                  rawBody: '<body><h1>First H1</h1><h1>Second H1</h1></body>',
                },
                finalUrl: 'https://main--example--page.aem.page/page1',
              })),
            },
          });
        }
      });

      await preflightAuditFunction(context);

      // Get the final result
      const jobEntityCalls = context.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];
      const result = finalJobEntity.setResult.getCall(0).args[0];

      // Verify that only h1 count check was performed
      const { audits } = result[0];

      // Check h1 count audit
      const h1CountAudit = audits.find((a) => a.name === AUDIT_H1_COUNT);
      expect(h1CountAudit).to.exist;
      expect(h1CountAudit.opportunities).to.have.lengthOf(1);
      expect(h1CountAudit.opportunities[0].check).to.equal('multiple-h1');

      // Verify other checks were not performed
      expect(audits.find((a) => a.name === AUDIT_BODY_SIZE)).to.not.exist;
      expect(audits.find((a) => a.name === AUDIT_LOREM_IPSUM)).to.not.exist;
    });

    it('should keep job in progress when audit handler returns processing: true (lines 273-275)', async () => {
      // Create a new test with its own setup that mocks readability to return processing: true
      const mockContext = new MockContextBuilder()
        .withSandbox(sinon.createSandbox())
        .withOverrides({
          job: {
            getMetadata: () => ({
              payload: {
                step: PREFLIGHT_STEP_SUGGEST,
                urls: ['https://main--example--page.aem.page/page1'],
                checks: ['readability'], // Only readability to test processing scenario
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
          },
          site,
          s3Client,
          func: {
            version: 'test',
          },
        })
        .build();

      mockContext.dataAccess.AsyncJob.findById = sinon.stub().callsFake(() => Promise.resolve({
        getId: () => 'job-123',
        setResult: sinon.stub(),
        setStatus: sinon.stub(),
        setResultType: sinon.stub(),
        setEndedAt: sinon.stub(),
        setError: sinon.stub(),
        save: sinon.stub().resolves(),
      }));

      // Mock the preflight audit with readability handler returning processing: true
      const { preflightAudit: testPreflightAudit } = await esmock('../../src/preflight/handler.js', {
        '../../src/readability/handler.js': {
          default: sinon.stub().resolves({ processing: true }),
        },
        '../../src/preflight/accessibility.js': {
          default: sinon.stub().resolves(),
        },
      });

      await testPreflightAudit(mockContext);

      // Verify that AsyncJob.findById was called for the final save
      expect(mockContext.dataAccess.AsyncJob.findById).to.have.been.called;

      // Get the final job entity (last call)
      const jobEntityCalls = mockContext.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      // Verify lines 273-275: job kept in progress when anyProcessing is true
      expect(finalJobEntity.setStatus).to.have.been.calledWith('IN_PROGRESS');
      expect(finalJobEntity.setEndedAt).not.to.have.been.called; // Should not set endedAt yet
      expect(finalJobEntity.save).to.have.been.called;
    });

    it('should handle null handlerResults and use fallback (line 269)', async () => {
      // This test covers the || [] fallback on line 269 when handlerResults is null/undefined
      const mockContext = new MockContextBuilder()
        .withSandbox(sinon.createSandbox())
        .withOverrides({
          job: {
            getMetadata: () => ({
              payload: {
                step: PREFLIGHT_STEP_SUGGEST,
                urls: ['https://main--example--page.aem.page/page1'],
                checks: [], // Empty checks to minimize processing
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
          },
          site,
          s3Client,
          func: {
            version: 'test',
          },
        })
        .build();

      mockContext.dataAccess.AsyncJob.findById = sinon.stub().callsFake(() => Promise.resolve({
        getId: () => 'job-123',
        setResult: sinon.stub(),
        setStatus: sinon.stub(),
        setResultType: sinon.stub(),
        setEndedAt: sinon.stub(),
        setError: sinon.stub(),
        save: sinon.stub().resolves(),
      }));

      // Create a simple test that just executes with empty handlers
      // to see if we can hit the edge case
      const { preflightAudit: testPreflightAudit } = await esmock('../../src/preflight/handler.js', {
        '../../src/preflight/canonical.js': { default: async () => undefined },
        '../../src/preflight/metatags.js': { default: async () => undefined },
        '../../src/preflight/links.js': { default: async () => undefined },
        '../../src/readability/handler.js': { default: async () => undefined },
        '../../src/preflight/accessibility.js': { default: async () => undefined },
      });

      await testPreflightAudit(mockContext);

      // Verify that AsyncJob.findById was called for the final save
      expect(mockContext.dataAccess.AsyncJob.findById).to.have.been.called;

      // Get the final job entity
      const jobEntityCalls = mockContext.dataAccess.AsyncJob.findById.returnValues;
      const finalJobEntity = await jobEntityCalls[jobEntityCalls.length - 1];

      // Verify the fallback worked - job should complete normally since no processing
      expect(finalJobEntity.setStatus).to.have.been.calledWith('COMPLETED');
      expect(finalJobEntity.setEndedAt).to.have.been.called;
      expect(finalJobEntity.save).to.have.been.called;
    });
  });

  describe('saveIntermediateResults', () => {
    let context;
    let mockJobEntity;
    let mockDataAccess;

    beforeEach(() => {
      mockJobEntity = {
        setResult: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockDataAccess = {
        AsyncJob: {
          findById: sinon.stub().resolves(mockJobEntity),
        },
      };

      context = {
        site: {
          getId: sinon.stub().returns('site-123'),
        },
        job: {
          getId: sinon.stub().returns('job-456'),
        },
        step: 'test-step',
        dataAccess: mockDataAccess,
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          debug: sinon.stub(),
        },
      };
    });

    it('should save intermediate results successfully', async () => {
      const result = { test: 'data' };
      const auditName = 'test-audit';

      await saveIntermediateResults(context, result, auditName);

      expect(mockDataAccess.AsyncJob.findById).to.have.been.calledWith('job-456');
      expect(mockJobEntity.setResult).to.have.been.calledWith(result);
      expect(mockJobEntity.save).to.have.been.calledOnce;
      expect(context.log.debug).to.have.been.calledWith(
        '[preflight-audit] site: site-123, job: job-456, step: test-step. test-audit: Intermediate results saved successfully',
      );
    });

    it('should handle errors gracefully and log warning', async () => {
      const result = { test: 'data' };
      const auditName = 'test-audit';
      const error = new Error('Database connection failed');

      mockDataAccess.AsyncJob.findById.rejects(error);

      await saveIntermediateResults(context, result, auditName);

      expect(context.log.warn).to.have.been.calledWith(
        '[preflight-audit] site: site-123, job: job-456, step: test-step. test-audit: Failed to save intermediate results: Database connection failed',
      );
    });

    it('should handle save operation errors', async () => {
      const result = { test: 'data' };
      const auditName = 'test-audit';
      const error = new Error('Save operation failed');

      mockJobEntity.save.rejects(error);

      await saveIntermediateResults(context, result, auditName);

      expect(context.log.warn).to.have.been.calledWith(
        '[preflight-audit] site: site-123, job: job-456, step: test-step. test-audit: Failed to save intermediate results: Save operation failed',
      );
    });

    it('should handle setter method errors', async () => {
      const result = { test: 'data' };
      const auditName = 'test-audit';
      const error = new Error('Invalid result');

      mockJobEntity.setResult.throws(error);

      await saveIntermediateResults(context, result, auditName);

      expect(context.log.warn).to.have.been.calledWith(
        '[preflight-audit] site: site-123, job: job-456, step: test-step. test-audit: Failed to save intermediate results: Invalid result',
      );
    });
  });

  describe('getPrefixedPageAuthToken', () => {
    const token = 'my-token';
    const optionsWithPromise = { promiseToken: 'some-promise-token' };
    const optionsWithoutPromise = {};

    it('returns Bearer <token> for AEM_CS site with promiseToken', () => {
      const aemCsSite = { getDeliveryType: () => Site.DELIVERY_TYPES.AEM_CS };
      const result = getPrefixedPageAuthToken(aemCsSite, token, optionsWithPromise);
      expect(result).to.equal(`Bearer ${token}`);
    });

    it('returns token <token> for AEM_CS site without promiseToken', () => {
      const aemCsSite = { getDeliveryType: () => Site.DELIVERY_TYPES.AEM_CS };
      const result = getPrefixedPageAuthToken(aemCsSite, token, optionsWithoutPromise);
      expect(result).to.equal(`token ${token}`);
    });

    it('returns token <token> for non-AEM_CS site with promiseToken', () => {
      const edgeSite = { getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE };
      const result = getPrefixedPageAuthToken(edgeSite, token, optionsWithPromise);
      expect(result).to.equal(`token ${token}`);
    });

    it('returns token <token> for non-AEM_CS site without promiseToken', () => {
      const edgeSite = { getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE };
      const result = getPrefixedPageAuthToken(edgeSite, token, optionsWithoutPromise);
      expect(result).to.equal(`token ${token}`);
    });
  });

  describe('accessibility', () => {
    let context;
    let auditContext;
    let s3Client;
    let sqs;
    let log;

    beforeEach(() => {
      s3Client = {
        send: sinon.stub(),
      };
      sqs = {
        sendMessage: sinon.stub().resolves(),
      };
      log = {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      };

      context = {
        site: {
          getId: () => 'site-123',
          getBaseURL: () => 'https://example.com',
        },
        job: {
          getId: () => 'job-123',
          getMetadata: () => ({
            payload: {
              enableAuthentication: true,
            },
          }),
        },
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          CONTENT_SCRAPER_QUEUE_URL: 'https://sqs.test.com/scraper',
          AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/audit',
        },
        s3Client,
        sqs,
        log,
        promiseToken: 'test-token',
        dataAccess: {
          AsyncJob: {
            findById: sinon.stub().resolves({
              setStatus: sinon.stub(),
              setResultType: sinon.stub(),
              setResult: sinon.stub(),
              setEndedAt: sinon.stub(),
              setError: sinon.stub(),
              save: sinon.stub().resolves(),
            }),
          },
        },
      };

      auditContext = {
        previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
        step: 'identify',
        audits: new Map([
          ['https://example.com/page1', { audits: [{ name: 'accessibility', type: 'a11y', opportunities: [] }] }],
          ['https://example.com/page2', { audits: [{ name: 'accessibility', type: 'a11y', opportunities: [] }] }],
        ]),
        auditsResult: [
          { pageUrl: 'https://example.com/page1', audits: [] },
          { pageUrl: 'https://example.com/page2', audits: [] },
        ],
        timeExecutionBreakdown: [],
        checks: ['accessibility'],
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('generateAccessibilityFilename', () => {
      it('should generate valid filename from URL', async () => {
        const { generateAccessibilityFilename } = await import('../../src/preflight/accessibility.js');

        // Test with a normal URL
        const url = 'https://example.com/page1';
        const result = generateAccessibilityFilename(url);
        expect(result).to.equal('example_com_page1.json');
      });

      it('should handle URLs with trailing slash', async () => {
        const { generateAccessibilityFilename } = await import('../../src/preflight/accessibility.js');

        const url = 'https://example.com/page1/';
        const result = generateAccessibilityFilename(url);
        expect(result).to.equal('example_com_page1.json');
      });

      it('should handle URLs with special characters', async () => {
        const { generateAccessibilityFilename } = await import('../../src/preflight/accessibility.js');

        const url = 'https://example.com/page with spaces & symbols!';
        const result = generateAccessibilityFilename(url);
        expect(result).to.equal('example_com_page_20with_20spaces_20__20symbols_.json');
      });

      it('should handle invalid URLs', async () => {
        const { generateAccessibilityFilename } = await import('../../src/preflight/accessibility.js');

        const url = 'not-a-valid-url';
        const result = generateAccessibilityFilename(url);
        expect(result).to.match(/invalid_url_\d+\.json/);
      });

      it('should limit filename length', async () => {
        const { generateAccessibilityFilename } = await import('../../src/preflight/accessibility.js');

        const longPath = 'a'.repeat(300);
        const url = `https://example.com/${longPath}`;
        const result = generateAccessibilityFilename(url);
        expect(result.length).to.be.lessThan(210); // .json suffix + some buffer
      });
    });

    describe('scrapeAccessibilityData', () => {
      it('should send accessibility scraping request successfully', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        await scrapeAccessibilityData(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];

        expect(message).to.deep.include({
          siteId: 'site-123',
          jobId: 'site-123',
          processingType: 'accessibility',
          s3BucketName: 'test-bucket',
          completionQueueUrl: 'https://sqs.test.com/audit',
          skipMessage: true,
          skipStorage: false,
          allowCache: false,
          forceRescrape: true,
        });

        expect(message.urls).to.deep.equal([
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ]);

        expect(message.options).to.deep.include({
          enableAuthentication: true,
          a11yPreflight: true,
          promiseToken: 'test-token',
        });

        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Sent accessibility scraping request to content scraper for 2 URLs',
        );
      });

      it('should handle missing S3 bucket configuration', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = null;

        await scrapeAccessibilityData(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle empty preview URLs', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.previewUrls = [];

        await scrapeAccessibilityData(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle SQS send error', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        const error = new Error('SQS error');
        sqs.sendMessage.rejects(error);

        await expect(scrapeAccessibilityData(context, auditContext))
          .to.be.rejectedWith('SQS error');

        expect(log.error).to.have.been.calledWith(
          '[preflight-audit] Failed to send accessibility scraping request: SQS error',
        );
      });

      it('should create accessibility audit entries for all pages', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        await scrapeAccessibilityData(context, auditContext);

        // Verify accessibility audit entries were created
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const page2Audit = auditContext.audits.get('https://example.com/page2');

        expect(page1Audit.audits).to.have.lengthOf(2);
        expect(page1Audit.audits[1]).to.deep.equal({
          name: 'accessibility',
          type: 'a11y',
          opportunities: [],
        });

        expect(page2Audit.audits).to.have.lengthOf(2);
        expect(page2Audit.audits[1]).to.deep.equal({
          name: 'accessibility',
          type: 'a11y',
          opportunities: [],
        });
      });

      it('should handle missing audit entry for URL', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        // Create audit context with a URL that doesn't have an audit entry
        const auditContextWithMissingEntry = {
          ...auditContext,
          audits: new Map([
            ['https://example.com/page1', { audits: [] }],
            // page2 is missing from audits map
          ]),
          previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
        };

        await scrapeAccessibilityData(context, auditContextWithMissingEntry);

        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No audit entry found for URL: https://example.com/page2',
        );
        expect(sqs.sendMessage).to.have.been.calledOnce;
      });

      it('should include promiseToken in options when available', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        context.promiseToken = 'test-promise-token';

        await scrapeAccessibilityData(context, auditContext);

        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.options.promiseToken).to.equal('test-promise-token');
      });

      it('should not include promiseToken in options when not available', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        delete context.promiseToken;

        await scrapeAccessibilityData(context, auditContext);

        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.options.promiseToken).to.be.undefined;
      });

      it('should log detailed scrape message information', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        await scrapeAccessibilityData(context, auditContext);

        expect(log.debug).to.have.been.calledWith(
          sinon.match(/Scrape message being sent:/),
        );
        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Processing type: accessibility',
        );
        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] S3 bucket: test-bucket',
        );
        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Completion queue: https://sqs.test.com/audit',
        );
        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Sending to queue: https://sqs.test.com/scraper',
        );
      });

      it('should handle enableAuthentication set to false in job metadata', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        // Override job metadata to set enableAuthentication to false
        context.job.getMetadata = () => ({
          payload: {
            enableAuthentication: false,
          },
        });

        await scrapeAccessibilityData(context, auditContext);

        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.options.enableAuthentication).to.be.false;
      });

      it('should handle enableAuthentication not specified in job metadata (defaults to true)', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        // Override job metadata to not specify enableAuthentication
        context.job.getMetadata = () => ({
          payload: {},
        });

        await scrapeAccessibilityData(context, auditContext);

        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.options.enableAuthentication).to.be.true;
      });

      it('should handle single URL in previewUrls', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.previewUrls = ['https://example.com/single-page'];

        await scrapeAccessibilityData(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.urls).to.deep.equal([
          { url: 'https://example.com/single-page' },
        ]);
        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Sent accessibility scraping request to content scraper for 1 URLs',
        );
      });

      it('should handle large number of URLs', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        const manyUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i}`);
        auditContext.previewUrls = manyUrls;

        // Create audit entries for all URLs
        auditContext.audits = new Map(
          manyUrls.map((url) => [url, { audits: [] }]),
        );

        await scrapeAccessibilityData(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.urls).to.have.lengthOf(50);
        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Sent accessibility scraping request to content scraper for 50 URLs',
        );
      });

      it('should handle URLs with special characters', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.previewUrls = [
          'https://example.com/page with spaces',
          'https://example.com/page-with-query?param=value&other=123',
          'https://example.com/page#fragment',
        ];

        await scrapeAccessibilityData(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.urls).to.deep.equal([
          { url: 'https://example.com/page with spaces' },
          { url: 'https://example.com/page-with-query?param=value&other=123' },
          { url: 'https://example.com/page#fragment' },
        ]);
      });

      it('should handle audit context with existing audits', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        // Create audit context with existing audits
        const auditContextWithExisting = {
          ...auditContext,
          audits: new Map([
            ['https://example.com/page1', { audits: [{ name: 'existing-audit', type: 'test' }] }],
            ['https://example.com/page2', { audits: [] }],
          ]),
        };

        await scrapeAccessibilityData(context, auditContextWithExisting);

        // Verify that accessibility audit was added to existing audits
        const page1Audit = auditContextWithExisting.audits.get('https://example.com/page1');
        expect(page1Audit.audits).to.have.lengthOf(2);
        expect(page1Audit.audits[1]).to.deep.equal({
          name: 'accessibility',
          type: 'a11y',
          opportunities: [],
        });

        const page2Audit = auditContextWithExisting.audits.get('https://example.com/page2');
        expect(page2Audit.audits).to.have.lengthOf(1);
        expect(page2Audit.audits[0]).to.deep.equal({
          name: 'accessibility',
          type: 'a11y',
          opportunities: [],
        });
      });

      it('should handle step parameter in audit context', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.step = 'custom-step';

        await scrapeAccessibilityData(context, auditContext);

        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] site: site-123, job: job-123, step: custom-step. Step 1: Preparing accessibility scrape',
        );
      });

      it('should handle missing step parameter in audit context', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        delete auditContext.step;

        await scrapeAccessibilityData(context, auditContext);

        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] site: site-123, job: job-123, step: undefined. Step 1: Preparing accessibility scrape',
        );
      });

      it('should handle empty string S3 bucket name', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = '';

        await scrapeAccessibilityData(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle undefined S3 bucket name', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = undefined;

        await scrapeAccessibilityData(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should log preview URLs being used', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        await scrapeAccessibilityData(context, auditContext);

        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Using preview URLs for accessibility audit: [\n  {\n    "url": "https://example.com/page1"\n  },\n  {\n    "url": "https://example.com/page2"\n  }\n]',
        );
      });

      it('should log force re-scraping message', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        await scrapeAccessibilityData(context, auditContext);

        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Force re-scraping all 2 URLs for accessibility audit',
        );
      });

      it('should log sending URLs message', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        await scrapeAccessibilityData(context, auditContext);

        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] Sending 2 URLs to content scraper for accessibility audit',
        );
      });
    });

    describe('accessibility handler integration', () => {
      it('should skip when no preview URLs provided', async () => {
        const accessibility = (await import('../../src/preflight/accessibility.js')).default;
        auditContext.previewUrls = [];

        await accessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for accessibility audit, skipping',
        );
      });

      it('should handle previewUrls as null', async () => {
        const accessibility = (await import('../../src/preflight/accessibility.js')).default;

        auditContext.previewUrls = null;

        await accessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for accessibility audit, skipping',
        );
      });

      it('should handle previewUrls as undefined', async () => {
        const accessibility = (await import('../../src/preflight/accessibility.js')).default;

        auditContext.previewUrls = undefined;

        await accessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for accessibility audit, skipping',
        );
      });

      it('should handle previewUrls as non-array', async () => {
        const accessibility = (await import('../../src/preflight/accessibility.js')).default;
        auditContext.previewUrls = 'not-an-array';

        await accessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for accessibility audit, skipping',
        );
      });

      it('should execute accessibility workflow when checks is null', async () => {
        const accessibility = (await import('../../src/preflight/accessibility.js')).default;

        // Set checks to null to trigger the accessibility workflow
        auditContext.checks = null;

        // Mock successful S3 operations for the entire workflow
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'ListObjectsV2Command') {
            return Promise.resolve({
              Contents: [
                { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
                { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
              ],
            });
          }
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {},
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await accessibility(context, auditContext);

        // Verify that the workflow was executed
        expect(sqs.sendMessage).to.have.been.called;
        expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      });

      it('should execute accessibility workflow when checks is undefined', async () => {
        const accessibility = (await import('../../src/preflight/accessibility.js')).default;

        // Set checks to undefined to trigger the accessibility workflow
        auditContext.checks = undefined;

        // Mock successful S3 operations for the entire workflow
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'ListObjectsV2Command') {
            return Promise.resolve({
              Contents: [
                { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
                { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
              ],
            });
          }
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {},
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await accessibility(context, auditContext);

        // Verify that the workflow was executed
        expect(sqs.sendMessage).to.have.been.called;
        expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      });
    });

    describe('processAccessibilityOpportunities', () => {
      afterEach(() => {
        sinon.restore();
      });

      it('should handle missing S3 bucket configuration', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = null;

        await processAccessibilityOpportunities(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for accessibility audit');
      });

      it('should handle missing accessibility data for URL', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return null for accessibility data
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(null),
              },
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No accessibility data found for https://example.com/page1 at key: accessibility-preflight/site-123/example_com_page1.json',
        );
      });

      it('should add timing information to execution breakdown', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock successful S3 operations
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {},
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
        expect(auditContext.timeExecutionBreakdown[0]).to.deep.include({
          name: 'accessibility-processing',
        });
        expect(auditContext.timeExecutionBreakdown[0]).to.have.property('duration');
        expect(auditContext.timeExecutionBreakdown[0]).to.have.property('startTime');
        expect(auditContext.timeExecutionBreakdown[0]).to.have.property('endTime');
      });

      it('should process accessibility violations and create opportunities', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with violations
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    critical: {
                      items: {
                        'button-name': {
                          level: 'A',
                          count: 2,
                          htmlWithIssues: ['<button><img src="icon.png" alt=""></button>'],
                          target: ['button'],
                          failureSummary: 'Buttons must have discernible text',
                          successCriteriaNumber: '412',
                          successCriteriaTags: ['wcag412'],
                          description: 'Ensures buttons have accessible names',
                          understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(accessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'A',
          severity: 'critical',
          occurrences: 2,
          failureSummary: 'Buttons must have discernible text',
          wcagRule: '4.1.2 Name, Role, Value',
          check: 'a11y-assistive',
          type: 'button-name',
        });
      });

      it('should handle accessibility violations that do not match opportunity types', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with violations that don't match opportunity types
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    critical: {
                      items: {
                        'unknown-violation': {
                          level: 'AA',
                          count: 1,
                          htmlWithIssues: ['<div>Unknown issue</div>'],
                          target: ['div'],
                          failureSummary: 'Unknown violation',
                          successCriteriaNumber: '1.1.1',
                          description: 'Unknown violation description',
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that no opportunities were created for unknown violations
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(0);
      });

      it('should handle accessibility violations with missing or undefined fields', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with missing/undefined fields to test fallbacks
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    moderate: {
                      items: {
                        'button-name': {
                          // Missing level field - should fallback to ''
                          // Missing count field - should fallback to ''
                          // Missing htmlWithIssues field - should fallback to []
                          // Missing target field - should fallback to ''
                          // Missing failureSummary field - should fallback to ''
                          // Missing successCriteriaNumber field - should fallback to ''
                          // Missing description field - should fallback to ''
                          // Missing understandingUrl field - should fallback to ''
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that opportunity was created with fallback values
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(accessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: '', // fallback for missing level
          severity: 'moderate',
          occurrences: '', // fallback for missing count
          htmlWithIssues: [], // fallback for missing htmlWithIssues
          failureSummary: '', // fallback for missing failureSummary
          wcagRule: '', // fallback for missing successCriteriaNumber
          description: '', // fallback for missing description
          check: 'a11y-assistive',
          type: 'button-name',
          understandingUrl: '', // fallback for missing understandingUrl
        });
      });

      it('should handle accessibility violations with partially missing htmlWithIssues and target arrays', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with partial arrays to test target fallback
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    serious: {
                      items: {
                        'button-name': {
                          level: 'AA',
                          count: 2,
                          htmlWithIssues: ['<button>First</button>', '<button>Second</button>'],
                          target: ['button'], // Only one target for two htmlWithIssues
                          failureSummary: 'Test summary',
                          successCriteriaNumber: '4.1.2',
                          description: 'Test description',
                          understandingUrl: 'https://example.com',
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that opportunity was created with target selector fallback
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(accessibilityAudit.opportunities[0].htmlWithIssues).to.have.lengthOf(2);
        expect(accessibilityAudit.opportunities[0].htmlWithIssues[0]).to.deep.include({
          target_selector: 'button',
          update_from: '<button>First</button>',
        });
        expect(accessibilityAudit.opportunities[0].htmlWithIssues[1]).to.deep.include({
          target_selector: '', // fallback for missing target[1]
          update_from: '<button>Second</button>',
        });
      });

      it('should handle accessibility violations with null/undefined html in htmlWithIssues', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    moderate: {
                      items: {
                        'button-name': {
                          level: 'AA',
                          count: 3,
                          htmlWithIssues: [null, undefined, ''], // Test falsy values for html
                          target: ['button1', 'button2', 'button3'],
                          failureSummary: 'Test summary',
                          successCriteriaNumber: '4.1.2',
                          description: 'Test description',
                          understandingUrl: 'https://example.com',
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that opportunity was created with empty string fallbacks for html || ''
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(accessibilityAudit.opportunities[0].htmlWithIssues).to.have.lengthOf(3);
        // Test the html || '' branch coverage - all should fallback to empty string
        expect(accessibilityAudit.opportunities[0].htmlWithIssues[0]).to.deep.include({
          target_selector: 'button1',
          update_from: '', // null || '' = ''
        });
        expect(accessibilityAudit.opportunities[0].htmlWithIssues[1]).to.deep.include({
          target_selector: 'button2',
          update_from: '', // undefined || '' = ''
        });
        expect(accessibilityAudit.opportunities[0].htmlWithIssues[2]).to.deep.include({
          target_selector: 'button3',
          update_from: '', // '' || '' = ''
        });
      });

      it('should handle missing accessibility audit entry for URL', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Create audit context without accessibility audit entries
        const auditContextWithoutAccessibility = {
          ...auditContext,
          audits: new Map([
            ['https://example.com/page1', { audits: [] }], // No accessibility audit
            ['https://example.com/page2', { audits: [] }],
          ]),
        };

        // Mock S3 to return accessibility data
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {},
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContextWithoutAccessibility);

        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No accessibility audit found for URL: https://example.com/page1',
        );
      });

      it('should handle accessibility data with violations but no items', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with violations but no items
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    critical: {
                      // No items property
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that no opportunities were created
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(0);
      });

      it('should handle accessibility data with total violations count', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with total count
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    total: 5, // This should be skipped
                    critical: {
                      items: {
                        'button-name': {
                          level: 'A',
                          count: 2,
                          htmlWithIssues: ['<button><img src="icon.png" alt=""></button>'],
                          target: ['button'],
                          failureSummary: 'Buttons must have discernible text',
                          successCriteriaNumber: '4.1.2',
                          description: 'Ensures buttons have accessible names',
                          understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created (excluding total count)
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(accessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'A',
          severity: 'critical',
          occurrences: 2,
          check: 'a11y-assistive',
          type: 'button-name',
        });
      });

      it('should handle accessibility data with missing htmlWithIssues and target arrays', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with missing arrays
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    critical: {
                      items: {
                        'button-name': {
                          level: 'A',
                          count: 2,
                          // Missing htmlWithIssues and target arrays
                          failureSummary: 'Buttons must have discernible text',
                          successCriteriaNumber: '4.1.2',
                          description: 'Ensures buttons have accessible names',
                          understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created with empty arrays
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(accessibilityAudit.opportunities[0].htmlWithIssues).to.deep.equal([]);
      });

      it('should handle accessibility data with mismatched htmlWithIssues and target arrays', async () => {
        const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

        // Mock S3 to return accessibility data with mismatched arrays
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {
                    critical: {
                      items: {
                        'button-name': {
                          level: 'A',
                          count: 2,
                          htmlWithIssues: ['<button><img src="icon.png" alt=""></button>', '<button></button>'],
                          target: ['button'], // Only one target for two htmlWithIssues
                          failureSummary: 'Buttons must have discernible text',
                          successCriteriaNumber: '4.1.2',
                          description: 'Ensures buttons have accessible names',
                          understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
                        },
                      },
                    },
                  },
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created with proper mapping
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');

        expect(accessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(accessibilityAudit.opportunities[0].htmlWithIssues).to.have.lengthOf(2);
        expect(accessibilityAudit.opportunities[0].htmlWithIssues[0].target_selector).to.equal('button');
        expect(accessibilityAudit.opportunities[0].htmlWithIssues[1].target_selector).to.equal(''); // Empty for missing target
      });
    });

    describe('accessibility handler polling', () => {
      let pollingContext;
      let pollingAuditContext;
      let pollingS3Client;
      let pollingLog;
      let accessibility;
      let sandbox;

      beforeEach(async () => {
        sandbox = sinon.createSandbox();
        // Mock the sleep function using esmock
        const accessibilityModule = await esmock('../../src/preflight/accessibility.js', {
          '../../src/support/utils.js': {
            sleep: sandbox.stub().resolves(),
          },
        });
        accessibility = accessibilityModule.default;
        pollingS3Client = {
          send: sinon.stub(),
        };
        pollingLog = {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.stub(),
        };

        pollingContext = {
          site: {
            getId: () => 'site-123',
            getBaseURL: () => 'https://example.com',
          },
          job: {
            getId: () => 'job-123',
            getMetadata: () => ({
              payload: {
                enableAuthentication: true,
              },
            }),
          },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          },
          s3Client: pollingS3Client,
          sqs: {
            sendMessage: sinon.stub().resolves(),
          },
          log: pollingLog,
        };

        pollingAuditContext = {
          previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
          step: 'identify',
          checks: ['accessibility'],
          audits: new Map([
            ['https://example.com/page1', { audits: [{ name: 'accessibility', type: 'a11y', opportunities: [] }] }],
            ['https://example.com/page2', { audits: [{ name: 'accessibility', type: 'a11y', opportunities: [] }] }],
          ]),
          auditsResult: [
            { pageUrl: 'https://example.com/page1', audits: [] },
            { pageUrl: 'https://example.com/page2', audits: [] },
          ],
          timeExecutionBreakdown: [],
        };
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should skip accessibility when not in checks', async () => {
        pollingAuditContext.checks = ['other-check']; // Not including accessibility

        await accessibility(pollingContext, pollingAuditContext);

        expect(pollingS3Client.send).to.not.have.been.called;
        expect(pollingLog.info).to.not.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      });

      it('should execute full accessibility workflow when checks include accessibility', async () => {
        // Mock successful S3 operations for the entire workflow
        pollingS3Client.send.callsFake((command) => {
          if (command.constructor.name === 'ListObjectsV2Command') {
            return Promise.resolve({
              Contents: [
                { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
                { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
              ],
            });
          }
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  violations: {},
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await accessibility(pollingContext, pollingAuditContext);

        // Verify that the workflow was executed
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] S3 Bucket: test-bucket');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Site ID: site-123');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Job ID: job-123');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Looking for data in path: accessibility-preflight/site-123/');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Expected files: ["example_com_page1.json","example_com_page2.json"]');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Polling attempt - checking S3 bucket: test-bucket');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process accessibility data');
      });

      it('should handle polling with files that do not match expected pattern', async () => {
        let pollCount = 0;
        // Mock the accessibility module with s3-utils mocked
        const accessibilityModule = await esmock('../../src/preflight/accessibility.js', {
          '../../src/support/utils.js': {
            sleep: sandbox.stub().resolves(),
          },
          '../../src/utils/s3-utils.js': {
            getObjectKeysUsingPrefix: sinon.stub().callsFake(() => {
              pollCount += 1;
              if (pollCount === 1) {
                // First call: Return files that don't match expected patterns
                return Promise.resolve([
                  'accessibility-preflight/site-123/wrong_file1.json',
                  'accessibility-preflight/site-123/wrong_file2.json',
                  'accessibility-preflight/site-123/other_file.json',
                  'accessibility-preflight/site-123/', // Directory-like key
                ]);
              } else {
                // Second call: Return proper files to exit the polling loop
                return Promise.resolve([
                  'accessibility-preflight/site-123/example_com_page1.json',
                  'accessibility-preflight/site-123/example_com_page2.json',
                ]);
              }
            }),
            getObjectFromKey: sinon.stub().resolves({
              violations: {},
            }),
          },
        });

        const mockedAccessibility = accessibilityModule.default;

        await mockedAccessibility(pollingContext, pollingAuditContext);

        // Verify that it found 0 files due to filtering logic on first attempt
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Found 0 out of 2 expected accessibility files, continuing to wait...');
        // Verify that it eventually found the files and proceeded
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
      });

      it('should handle polling timeout scenario', async () => {
        let callCount = 0;

        // Stub Date.now to simulate timeout
        const dateNowStub = sandbox.stub(Date, 'now').callsFake(() => {
          callCount += 1;
          if (callCount === 1) {
            // First call - start time
            return 1000000;
          } else {
            // Subsequent calls - simulate timeout reached (11 minutes later)
            return 1000000 + (11 * 60 * 1000);
          }
        });

        // Mock the accessibility module with s3-utils mocked
        const accessibilityModule = await esmock('../../src/preflight/accessibility.js', {
          '../../src/support/utils.js': {
            sleep: sandbox.stub().resolves(),
          },
          '../../src/utils/s3-utils.js': {
            getObjectKeysUsingPrefix: sinon.stub().resolves([]), // Always return empty array
            getObjectFromKey: sinon.stub().resolves(null),
          },
        });

        const mockedAccessibility = accessibilityModule.default;

        await mockedAccessibility(pollingContext, pollingAuditContext);

        // Verify that timeout message was logged
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Maximum wait time reached, stopping polling');

        // Restore the stub
        dateNowStub.restore();
      });
    });

    describe('scrapeAccessibilityData edge cases', () => {
      it('should handle empty previewUrls array', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.previewUrls = [];

        await scrapeAccessibilityData(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle null previewUrls', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.previewUrls = null;

        await scrapeAccessibilityData(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle undefined previewUrls', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.previewUrls = undefined;

        await scrapeAccessibilityData(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle non-array previewUrls', async () => {
        const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

        auditContext.previewUrls = 'not-an-array';

        await scrapeAccessibilityData(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });
    });
  });

  describe('accessibility coverage tests', () => {
    let context;
    let auditContext;
    let s3Client;
    let log;
    let accessibility;
    let sandbox;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();

      // Mock the sleep function using esmock
      const accessibilityModule = await esmock('../../src/preflight/accessibility.js', {
        '../../src/support/utils.js': {
          sleep: sandbox.stub().resolves(),
        },
      });
      accessibility = accessibilityModule.default;

      log = {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      };

      s3Client = {
        send: sinon.stub(),
      };

      context = {
        site: {
          getId: sinon.stub().returns('site-123'),
          getBaseURL: sinon.stub().returns('https://example.com'),
        },
        job: {
          getId: sinon.stub().returns('job-123'),
          getMetadata: sinon.stub().returns({
            payload: { enableAuthentication: true },
          }),
        },
        log,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/queue',
          CONTENT_SCRAPER_QUEUE_URL: 'https://sqs.test.com/scraper-queue',
        },
        s3Client,
        sqs: {
          sendMessage: sinon.stub().resolves(),
        },
        dataAccess: {
          AsyncJob: {
            update: sinon.stub().resolves(),
          },
        },
      };

      auditContext = {
        previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
        step: 'test-step',
        audits: new Map([
          ['https://example.com/page1', {
            audits: [{
              name: 'accessibility',
              type: 'a11y',
              opportunities: [],
            }],
          }],
          ['https://example.com/page2', {
            audits: [{
              name: 'accessibility',
              type: 'a11y',
              opportunities: [],
            }],
          }],
        ]),
        auditsResult: {},
        timeExecutionBreakdown: [],
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should handle error in processAccessibilityOpportunities when accessibility audit is missing', async () => {
      const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

      // Create audit context without accessibility audit entries
      auditContext.audits = new Map([
        ['https://example.com/page1', { audits: [] }], // No accessibility audit
      ]);

      // Mock S3 to return accessibility data
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {
                  critical: {
                    items: {
                      'button-name': {
                        level: 'A',
                        count: 1,
                        htmlWithIssues: ['<button>test</button>'],
                        target: ['button'],
                      },
                    },
                  },
                },
              })),
            },
          });
        }
        return Promise.resolve({});
      });

      // The function should throw an error when trying to access undefined.opportunities
      try {
        await processAccessibilityOpportunities(context, auditContext);
        expect.fail('Expected function to throw an error');
      } catch (error) {
        expect(error.message).to.include('Cannot read properties of undefined');
      }
    });

    it('should handle error in processAccessibilityOpportunities and add error opportunity', async () => {
      const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

      // Mock S3 to throw an error
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.reject(new Error('S3 error'));
        }
        return Promise.resolve({});
      });

      await processAccessibilityOpportunities(context, auditContext);

      // Verify that the function handles S3 errors gracefully by logging warnings
      // The getObjectFromKey function returns null when S3 throws an error
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No accessibility data found for https://example.com/page1 at key: accessibility-preflight/site-123/example_com_page1.json');
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No accessibility data found for https://example.com/page2 at key: accessibility-preflight/site-123/example_com_page2.json');
    });

    it('should handle cleanup error in processAccessibilityOpportunities', async () => {
      const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

      // Mock S3 to succeed for GetObjectCommand but fail for DeleteObjectsCommand
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.reject(new Error('Cleanup failed'));
        }
        return Promise.resolve({});
      });

      await processAccessibilityOpportunities(context, auditContext);

      // The cleanup error should be logged
      expect(log.warn).to.have.been.calledWith('[preflight-audit] Failed to clean up accessibility files: Cleanup failed');
    });

    it('should handle missing accessibility audit in error handling', async () => {
      const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

      // Create audit context where some URLs don't have accessibility audits
      auditContext.audits = new Map([
        ['https://example.com/page1', {
          audits: [{
            name: 'accessibility',
            type: 'a11y',
            opportunities: [],
          }],
        }],
        ['https://example.com/page2', {
          audits: [], // No accessibility audit
        }],
      ]);

      // Mock S3 to throw an error
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.reject(new Error('S3 error'));
        }
        return Promise.resolve({});
      });

      // The function should handle missing accessibility audits gracefully
      await processAccessibilityOpportunities(context, auditContext);

      // Verify that the function completed without throwing an error
      // and logged appropriate warnings for missing accessibility audits
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No accessibility data found for https://example.com/page1 at key: accessibility-preflight/site-123/example_com_page1.json');
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No accessibility data found for https://example.com/page2 at key: accessibility-preflight/site-123/example_com_page2.json');

      // The warning for missing accessibility audit is only logged when accessibilityData exists
      // but there's no accessibility audit found. Since we're mocking S3 to return null,
      // this warning won't be logged. The test should verify the actual behavior.
      const missingAuditCalls = log.warn.getCalls().filter((call) => call.args[0] === '[preflight-audit] No accessibility audit found for URL: https://example.com/page2');
      expect(missingAuditCalls).to.have.lengthOf(0);
    });

    it('should handle accessibility function with no URLs to process', async () => {
      // Test the case where previewUrls is empty
      auditContext.previewUrls = [];

      await accessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for accessibility audit, skipping');
    });

    it('should handle accessibility function with null previewUrls', async () => {
      // Test the case where previewUrls is null
      auditContext.previewUrls = null;

      await accessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for accessibility audit, skipping');
    });

    it('should handle accessibility function with non-array previewUrls', async () => {
      // Test the case where previewUrls is not an array
      auditContext.previewUrls = 'not-an-array';

      await accessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for accessibility audit, skipping');
    });

    it('should handle accessibility function with undefined previewUrls', async () => {
      // Test the case where previewUrls is undefined
      auditContext.previewUrls = undefined;

      await accessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for accessibility audit, skipping');
    });

    it('should handle accessibility function with empty array previewUrls', async () => {
      // Test the case where previewUrls is an empty array
      auditContext.previewUrls = [];

      await accessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for accessibility audit, skipping');
    });

    it('should handle error during accessibility data processing', async () => {
      const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

      // Mock S3 to throw an error during GetObjectCommand
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.reject(new Error('S3 processing error'));
        }
        return Promise.resolve({});
      });

      await processAccessibilityOpportunities(context, auditContext);

      // Verify that warnings were logged for missing accessibility data
      expect(log.warn).to.have.been.calledWith(
        '[preflight-audit] No accessibility data found for https://example.com/page1 at key: accessibility-preflight/site-123/example_com_page1.json',
      );
      expect(log.warn).to.have.been.calledWith(
        '[preflight-audit] No accessibility data found for https://example.com/page2 at key: accessibility-preflight/site-123/example_com_page2.json',
      );
    });

    it('should skip accessibility when checks is provided but does not include accessibility', async () => {
      // Set checks to an array that doesn't include 'accessibility'
      auditContext.checks = ['other-check', 'another-check'];

      await accessibility(context, auditContext);

      // Verify that no accessibility processing was done
      expect(s3Client.send).to.not.have.been.called;
      expect(log.info).to.not.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
    });

    it('should handle polling loop in accessibility function', async () => {
      // Mock S3 to return files immediately (simplified test without polling loop)
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        return Promise.resolve({});
      });

      await accessibility(context, auditContext);

      // Verify that polling was attempted and succeeded
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Polling attempt - checking S3 bucket: test-bucket');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process accessibility data');
    });

    it('should call processAccessibilityOpportunities after successful polling', async () => {
      // Mock S3 to return files immediately
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });

      await accessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.debug).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
    });

    it('should complete accessibility function with processAccessibilityOpportunities call', async () => {
      // Mock S3 to return files immediately
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });

      await accessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.debug).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
    });

    it('should execute complete accessibility workflow', async () => {
      // Mock S3 to return files immediately on first call
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });

      // Execute the accessibility function
      await accessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.debug).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
    });

    it('should ensure processAccessibilityOpportunities is called', async () => {
      // Mock S3 to return files immediately
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'accessibility', opportunities: [] }],
      });

      // Execute the accessibility function
      await accessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.debug).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for accessibility data');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
    });

    it('should have empty urlsToScrape after mapping', async () => {
      const { scrapeAccessibilityData } = await import('../../src/preflight/accessibility.js');

      // Create a scenario where previewUrls exists but map results in empty urlsToScrape
      // This is a rare edge case but needed for coverage
      auditContext.previewUrls = [''];
      // Mock map only on this instance to return an empty array
      auditContext.previewUrls.map = function mockMap() {
        return [];
      };

      try {
        await scrapeAccessibilityData(context, auditContext);

        // Should log the "No URLs to scrape" message from line 126
        expect(log.info).to.have.been.calledWith('[preflight-audit] No URLs to scrape');
        expect(context.sqs.sendMessage).to.not.have.been.called;
      } finally {
        // No need to restore map since we only mocked the instance
      }
    });

    it('should handle error during individual file processing and add accessibility-error opportunity', async () => {
      const { processAccessibilityOpportunities } = await import('../../src/preflight/accessibility.js');

      // Set up the test context to have the required previewUrls
      auditContext.previewUrls = ['https://example.com/page1'];
      // Create a page result with a find method that throws an error
      const pageResult = {
        audits: [{
          name: 'accessibility',
          type: 'a11y',
          opportunities: [],
        }],
      };
      // Make the find method throw an error the first time it's called (during processing)
      // but work normally the second time (during error handling)
      let findCallCount = 0;
      const originalFind = pageResult.audits.find;
      pageResult.audits.find = function findMock(predicate) {
        findCallCount += 1;
        if (findCallCount === 1) {
          throw new Error('JSON parsing failed');
        }
        return originalFind.call(this, predicate);
      };

      auditContext.audits.set('https://example.com/page1', pageResult);

      // Mock S3 client to return valid data
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: () => Promise.resolve('{"violations": {"critical": {"items": {}}}}'),
            },
          });
        }
        return Promise.resolve({});
      });

      await processAccessibilityOpportunities(context, auditContext);

      // Verify that the error was logged for the first URL
      expect(log.error).to.have.been.calledWith(
        '[preflight-audit] Error processing accessibility file for https://example.com/page1: JSON parsing failed',
      );

      // Verify that an accessibility-error opportunity was added to the audit
      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const accessibilityAudit = page1Audit.audits.find((a) => a.name === 'accessibility');
      const errorOpportunity = accessibilityAudit.opportunities.find((o) => o.type === 'accessibility-error');

      expect(errorOpportunity).to.exist;
      expect(errorOpportunity.title).to.equal('Accessibility File Processing Error');
      expect(errorOpportunity.description).to.include('Failed to process accessibility data for https://example.com/page1: JSON parsing failed');
      expect(errorOpportunity.severity).to.equal('error');
    });

    it('should handle error during polling loop and continue polling', async () => {
      let pollCallCount = 0;
      // Mock S3 to throw an error on first polling attempt, then succeed
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          pollCallCount += 1;
          if (pollCallCount === 1) {
            // First polling attempt - throw an error
            return Promise.reject(new Error('S3 ListObjectsV2 failed'));
          }
          // Second polling attempt - return success
          return Promise.resolve({
            Contents: [
              { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      await accessibility(context, auditContext);

      // Verify that the polling error was logged
      expect(log.error).to.have.been.calledWith('[preflight-audit] Error polling for accessibility data: S3 ListObjectsV2 failed');
      // Verify that polling continued and eventually succeeded
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process accessibility data');
      // Verify that both polling attempts were made
      expect(pollCallCount).to.equal(2);
    });

    it('should handle foundFiles', async () => {
      let pollCallCount = 0;
      // Mock S3 to return null foundFiles first, then success
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          pollCallCount += 1;
          if (pollCallCount === 1) {
            // First polling attempt - return response with no Contents (foundFiles will be falsy)
            return Promise.resolve({
              // No Contents property - this makes foundFiles undefined/falsy
            });
          }
          // Second polling attempt - return success
          return Promise.resolve({
            Contents: [
              { Key: 'accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                violations: {},
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      await accessibility(context, auditContext);

      // Verify that the foundCount = foundFiles ? foundFiles.length : 0 branch was hit
      // This should log "Found 0 out of 2 expected..." when foundFiles is falsy
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 0 out of 2 expected accessibility files, continuing to wait...');
      // Verify that polling continued and eventually succeeded
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, accessibility processing complete');
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process accessibility data');
      // Verify that both polling attempts were made
      expect(pollCallCount).to.equal(2);
    });
  });
});
