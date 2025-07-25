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
import { Site } from '@adobe/spacecat-shared-data-access';
import {
  preflightAudit, scrapePages, PREFLIGHT_STEP_SUGGEST, PREFLIGHT_STEP_IDENTIFY,
  AUDIT_BODY_SIZE, AUDIT_LOREM_IPSUM, AUDIT_H1_COUNT,
} from '../../src/preflight/handler.js';
import { runLinksChecks } from '../../src/preflight/links-checks.js';
import { MockContextBuilder } from '../shared.js';
import { suggestionData } from '../fixtures/preflight/preflight-suggest.js';
import identifyData from '../fixtures/preflight/preflight-identify.json' with { type: 'json' };
import { getPrefixedPageAuthToken, isValidUrls } from '../../src/preflight/utils.js';

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
      // Verify only one page was processed (now logs total links, internal and external links)
      expect(context.log.info).to.have.been.calledThrice;
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
      // (now logs total links, internal and external links for each page)
      expect(context.log.info.callCount).to.equal(6);
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
      expect(context.log.info).to.have.been.calledWithMatch('[preflight-audit] Found internal links:');
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
      expect(context.log.info).to.have.been.calledWith(
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
    let firefallClient;
    let genvarClient;

    const sandbox = sinon.createSandbox();

    beforeEach(() => {
      site = {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
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
        },
      });

      firefallClient.fetchChatCompletion.resolves({
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

      await preflightAudit(context);

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
      const body = '<body><a href="https://example.com/broken"></a><a href="https://example.com/another-broken-url"></a><h1>Home H1</h1></body>';
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
        },
      });

      firefallClient.fetchChatCompletion.resolves({
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

      await preflightAudit(context);

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
          enableAuthentication: false,
        },
      });

      configuration.isHandlerEnabledForSite.returns(false);

      await preflightAudit(context);

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
          enableAuthentication: false,
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
          step: PREFLIGHT_STEP_IDENTIFY,
          urls: ['not-a-url'],
        },
      });

      await expect(preflightAudit(context)).to.be.rejectedWith('[preflight-audit] site: site-123. Invalid URL provided: not-a-url');
    });

    it('sets status to FAILED if an error occurs', async () => {
      job.getMetadata = () => ({
        payload: {
          step: PREFLIGHT_STEP_IDENTIFY,
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
        const expectedChecks = ['dom', 'canonical', 'metatags', 'links'];

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

      await preflightAudit(context);

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

      await preflightAudit(context);

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

      await preflightAudit(context);

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
});
