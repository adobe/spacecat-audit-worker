/*
 * Copyright 2024 Adobe. All rights reserved.
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
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';

import {
  processStructuredData,
  generateSuggestionsData,
  opportunityAndSuggestions,
  runAuditAndGenerateSuggestions,
  importTopPages,
  submitForScraping,
} from '../../../src/structured-data/handler.js';
import { MockContextBuilder } from '../../shared.js';

import gscExample1 from '../../fixtures/structured-data/gsc-example1.json' with { type: 'json' };

use(sinonChai);

const sandbox = sinon.createSandbox();
const message = {
  type: 'structured-data',
  url: 'https://www.example.com',
};

const createPageStub = (url) => ({
  getUrl: () => url,
});

const createS3ObjectStub = (object) => ({
  ContentType: 'application/json',
  Body: {
    transformToString: sinon.stub().returns(object),
  },
});

const createFirefallSuggestion = (suggestion) => ({
  choices: [{
    finish_reason: 'stop',
    message: {
      content: JSON.stringify(suggestion),
    },
  }],
});

describe('Structured Data Audit', () => {
  let context;
  let googleClientStub;
  let urlInspectStub;
  let siteStub;
  let structuredDataSuggestions;
  let mockConfiguration;
  let s3ClientStub;
  let firefallClientStub;
  let auditStub;

  const finalUrl = 'https://www.example.com';

  beforeEach(() => {
    mockConfiguration = {
      isHandlerEnabledForSite: sinon.stub().returns(true),
    };
    s3ClientStub = {
      send: sinon.mock(),
      getObject: sinon.stub(),
    };
    firefallClientStub = {
      fetchChatCompletion: sinon.stub(),
    };

    siteStub = {
      getId: () => '123',
      getConfig: () => ({
        getIncludedURLs: () => ['https://example.com/product/1', 'https://example.com/product/2', 'https://example.com/product/3'],
      }),
      getDeliveryType: () => 'other',
    };

    auditStub = {
      getId: () => 'audit-id',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.spy(),
        },
        s3Client: s3ClientStub,
        site: siteStub,
        finalUrl,
        audit: auditStub,
      })
      .build(message);

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
      createPageStub('https://example.com/product/1'),
      createPageStub('https://example.com/product/2'),
      createPageStub('https://example.com/product/3'),
    ]);
    context.dataAccess.Configuration.findLatest = sinon.stub().resolves(mockConfiguration);

    googleClientStub = {
      urlInspect: sandbox.stub(),
    };

    urlInspectStub = googleClientStub.urlInspect;

    structuredDataSuggestions = {
      createdItems: [
        {
          type: 'url',
          url: 'https://example.com/product/1',
          errors: ['Missing field "image"'],
        },
        {
          type: 'url',
          url: 'https://example.com/product/2',
          errors: ['Missing field "image"'],
        },
      ],
    };

    sandbox.stub(FirefallClient, 'createFrom').returns(firefallClientStub);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('runAuditAndGenerateSuggestions', () => {
    it('throws an error if no top pages are available', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([]);

      const result = await runAuditAndGenerateSuggestions(context);
      expect(result).to.deep.equal({
        fullAuditRef: 'https://www.example.com',
        auditResult: {
          error: 'No top pages for site ID 123 found.',
          success: false,
        },
      });
    });

    it('filters out files from top pages', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/product/1'),
        createPageStub('https://example.com/product/2.pdf'),
        createPageStub('https://example.com/product/8.xlsx'),
      ]);

      context.dataAccess.Opportunity.allBySiteIdAndStatus
        .resolves([context.dataAccess.Opportunity]);
      context.dataAccess.Opportunity.getSuggestions.resolves([]);
      context.dataAccess.Opportunity.getId.returns('opportunity-id');
      context.dataAccess.Opportunity.getType.returns('structured-data');
      context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);

      await runAuditAndGenerateSuggestions(context);
      expect(s3ClientStub.send.calledOnce).to.equal(true);
      const scrapeRequests = s3ClientStub.send.getCalls().map((call) => call.args[0].input.Key);
      expect(scrapeRequests).to.deep.equal(['scrapes/123/product/1/scrape.json']);
    });

    it('runs a full audit', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
        createPageStub('https://example.com/product/1'),
      ]);

      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
      urlInspectStub.resolves(gscExample1);

      context.dataAccess.Opportunity.allBySiteIdAndStatus
        .resolves([context.dataAccess.Opportunity]);
      context.dataAccess.Opportunity.getSuggestions.resolves([]);
      context.dataAccess.Opportunity.getId.returns('opportunity-id');
      context.dataAccess.Opportunity.getType.returns('structured-data');
      context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);

      s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
        scrapeResult: {
          rawBody: '<main></main>',
          structuredData: [{
            '@type': 'Product',
          }],
        },
      })));

      const suggestion = {
        errorDescription: 'Missing field "name"',
        correctedLdjson: '{"@type":"Product","name":"Example Product Name"}',
        aiRationale: 'The product name is missing.',
        confidenceScore: 0.95,
      };
      firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));

      const result = await runAuditAndGenerateSuggestions(context);

      expect(result.auditResult.auditResult.success).to.be.true;
      expect(result.auditResult.auditResult.issues).to.have.lengthOf(1);
      expect(result.auditResult.auditResult.issues[0].suggestion).to.deep.equal(suggestion);
      expect(result.auditResult.auditResult.issues[0].errors).to.have.lengthOf(1);
    });
  });

  describe('opportunityAndSuggestions', () => {
    it('returns early if audit failed', async () => {
      const auditData = {
        auditResult: {
          success: false,
          issues: [],
        },
      };
      const result = await opportunityAndSuggestions(finalUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
    });

    it('groups issues by pageUrl', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
      context.dataAccess.Opportunity.getSuggestions.resolves([]);
      context.dataAccess.Opportunity.getId.returns('opportunity-id');
      context.dataAccess.Opportunity.addSuggestions.resolves({
        createdItems: [
          {
            type: 'url',
            url: 'https://example.com/product/1',
            errors: [],
          },
        ],
      });

      const auditData = {
        id: 'audit-id',
        siteId: context.site.getId(),
        auditResult: {
          success: true,
          issues: [{
            pageUrl: 'https://www.example.com',
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            location: '1690,2640',
            source: '{"itemListElement":[{"position":1,"name":"Home","@type":"ListItem"},{"position":2,"name":"Website","@type":"ListItem"}],"@type":"BreadcrumbList"}',
            issueMessage: 'issue 1',
            severity: 'WARNING',
            path: [],
            suggestion: {
              errorDescription: 'error suggestion 1',
              correctedMarkup: {
                '@type': 'BreadcrumbList',
              },
              aiRationale: 'AI rationale 1',
              confidenceScore: 0.95,
            },
            errors: [],
          },
          {
            pageUrl: 'https://www.example.com',
            rootType: 'Product',
            dataFormat: 'jsonld',
            location: '100,102',
            source: '{}',
            issueMessage: 'issue 1',
            severity: 'ERROR',
            path: [],
            suggestion: {
              errorDescription: 'error suggestion 2',
              correctedMarkup: {
                '@type': 'Product',
              },
              aiRationale: 'AI rationale 2',
              confidenceScore: 0.90,
            },
            errors: [],
          }],
        },
      };

      await opportunityAndSuggestions(finalUrl, auditData, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledWith([{
        opportunityId: 'opportunity-id',
        type: 'CODE_CHANGE',
        rank: 0,
        data: {
          type: 'url',
          url: 'https://www.example.com',
          errors: [
            {
              fix: '## Affected page\n * https://www.example.com\n\n## Issue Explanation\nerror suggestion 1\n\n## Corrected Structured Data\n```json\n{\n    "@type": "BreadcrumbList"\n}\n```\n\n## Rationale\nAI rationale 1\n\n_Confidence score: 95%_',
              id: 'breadcrumblist:issue1',
              errorTitle: 'BreadcrumbList: issue 1',
            },
            {
              fix: '## Affected page\n * https://www.example.com\n\n## Issue Explanation\nerror suggestion 2\n\n## Corrected Structured Data\n```json\n{\n    "@type": "Product"\n}\n```\n\n## Rationale\nAI rationale 2\n\n_Confidence score: 90%_',
              id: 'product:issue1',
              errorTitle: 'Product: issue 1',
            },
          ],
        },
      }]);
    });

    it('ensure unique error IDs for duplicate issues', async () => {
      const auditData = {
        siteId: context.site.getId(),
        auditResult: {
          success: true,
          issues: [
            { rootType: 'Product', issueMessage: 'Missing field "name"', pageUrl: 'https://example.com/page1' },
            { rootType: 'Product', issueMessage: 'Missing field "name"', pageUrl: 'https://example.com/page2' },
            { rootType: 'Product', issueMessage: 'Missing field "price"', pageUrl: 'https://example.com/page1' },
            { rootType: 'BreadcrumbList', issueMessage: 'Missing field "name"', pageUrl: 'https://example.com/page1' },
            { rootType: 'Product', issueMessage: 'Missing field "name"', pageUrl: 'https://example.com/page1' },
          ],
        },
      };
      const opportunity = {
        auditId: 'audit-id-12345',
        updatedBy: 'system',
        setAuditId: () => {},
        getSuggestions: () => [],
        getType: () => 'structured-data',
        getData: () => ({ dataSources: ['Ahrefs', 'Site'] }),
        setData: () => {},
        setUpdatedBy: () => {},
        save: () => {},
        getId: () => 'opportunity-id-12345',
        addSuggestions: () => ({ errorItems: [] }),
        setType: () => {},
        getSiteId: () => 'site-id-12345',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus = () => [opportunity];
      await opportunityAndSuggestions(finalUrl, auditData, context);
      const pageUrlToErrorIds = auditData.auditResult.issues.reduce((acc, issue) => {
        if (!acc[issue.pageUrl]) acc[issue.pageUrl] = [];
        acc[issue.pageUrl].push(issue.errors[0].id);
        return acc;
      }, {});
      Object.values(pageUrlToErrorIds).forEach((errorIds) => {
        expect(new Set(errorIds).size).to.equal(errorIds.length);
      });
      expect(pageUrlToErrorIds).to.deep.equal({
        'https://example.com/page1': [
          'product:missingfieldname',
          'product:missingfieldprice',
          'breadcrumblist:missingfieldname',
          'product:missingfieldname:1',
        ],
        'https://example.com/page2': [
          'product:missingfieldname',
        ],
      });
    });
  });

  describe('generateSuggestionsData', () => {
    it('returns early if previous audit was not successful', async () => {
      const scrapeCache = new Map();
      const auditData = {
        auditResult: {
          success: false,
          issues: [],
        },
      };
      const result = await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);
      expect(result).to.deep.equal(auditData);
    });

    it('returns early if auto-suggest configuration is disabled', async () => {
      const scrapeCache = new Map();
      const auditData = {
        auditResult: {
          success: true,
          issues: [],
        },
      };
      mockConfiguration.isHandlerEnabledForSite = sinon.stub().returns(false);

      const result = await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);
      expect(result).to.deep.equal(auditData);
    });

    it('stops early if Firefall request limit is reached', async () => {
      const auditData = {
        auditResult: {
          success: true,
          issues: [{
            pageUrl: finalUrl,
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            source: '{"itemListElement":[{"position":1,"name":"Things To Do","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@5ac9b38d","@type":"ListItem"},{"position":2,"name":"REESE\'S Stuff Your Cup","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@545b1739","@type":"ListItem"}],"@type":"BreadcrumbList"}',
            issueMessage: 'Invalid URL in field "item"',
            severity: 'WARNING',
          }],
        },
      };

      auditData.auditResult.issues = Array
        .from({ length: 51 }, () => structuredClone(auditData.auditResult.issues[0]))
        .map((issue, index) => ({
          ...issue,
          issueMessage: `${issue.issueMessage} ${index}`,
        }));

      const scrapeCache = new Map();
      s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
        scrapeResult: {
          rawBody: '<main></main>',
          structuredData: [{
            '@type': 'BreadcrumbList',
          }],
        },
      })));

      const suggestion = {
        errorDescription: 'Invalid URL in field "item"',
        correctedLdjson: '{}',
        aiRationale: 'Invalid URL in field "item"',
        confidenceScore: 0.95,
      };
      firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));

      const result = await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);

      expect(result.auditResult.issues.length).to.equal(51);
      expect(context.log.error).to.have.been.calledWith('SDA: Aborting suggestion generation as more than 50 Firefall requests have been used.');
    });

    it('re-uses an existing suggestion', async () => {
      const auditData = {
        auditResult: {
          success: true,
          issues: [{
            pageUrl: 'https://example.com/product/1',
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            source: '{"itemListElement":[{"position":1,"name":"Things To Do","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@5ac9b38d","@type":"ListItem"},{"position":2,"name":"REESE\'S Stuff Your Cup","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@545b1739","@type":"ListItem"}],"@type":"BreadcrumbList"}',
            issueMessage: 'Invalid URL in field "item"',
            severity: 'WARNING',
          }, {
            pageUrl: 'https://example.com/product/2',
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            source: '{"itemListElement":[{"position":1,"name":"Things To Do","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@5ac9b38d","@type":"ListItem"},{"position":2,"name":"REESE\'S Stuff Your Cup","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@545b1739","@type":"ListItem"}],"@type":"BreadcrumbList"}',
            issueMessage: 'Invalid URL in field "item"',
            severity: 'WARNING',
          }],
        },
      };

      const scrapeCache = new Map();
      s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
        scrapeResult: {
          rawBody: '<main></main>',
          structuredData: [{
            '@type': 'BreadcrumbList',
          }],
        },
      })));

      const suggestion = {
        errorDescription: 'Invalid URL in field "item"',
        correctedLdjson: '{}',
        aiRationale: 'Invalid URL in field "item"',
        confidenceScore: 0.95,
      };
      firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));

      const result = await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);

      expect(firefallClientStub.fetchChatCompletion).to.have.been.calledOnce;
      expect(result.auditResult.issues).to.have.lengthOf(2);
      expect(result.auditResult.issues[0].suggestion).to.deep.equal(suggestion);
      expect(result.auditResult.issues[1].suggestion).to.deep.equal(suggestion);
    });

    it('skips issue if scrape cannot be found', async () => {
      const auditData = {
        auditResult: {
          success: true,
          issues: [{
            pageUrl: 'https://example.com/product/1',
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            source: '{"itemListElement":[{"position":1,"name":"Things To Do","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@5ac9b38d","@type":"ListItem"},{"position":2,"name":"REESE\'S Stuff Your Cup","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@545b1739","@type":"ListItem"}],"@type":"BreadcrumbList"}',
            issueMessage: 'Invalid URL in field "item"',
            severity: 'WARNING',
          }],
        },
      };

      const scrapeCache = new Map();
      s3ClientStub.send.rejects(new Error('Failed to fetch S3 object'));

      await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);
      expect(context.log.error).to.have.been.calledWith('SDA: Could not find scrape for https://example.com/product/1 at /product/1. Make sure that scrape-top-pages did run.');
      expect(firefallClientStub.fetchChatCompletion).to.not.have.been.called;
    });

    it('skips issue if wrong markup cannot be found', async () => {
      const auditData = {
        auditResult: {
          success: true,
          issues: [{
            pageUrl: 'https://example.com/product/1',
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            issueMessage: 'Invalid URL in field "item"',
            severity: 'WARNING',
          }],
        },
      };

      const scrapeCache = new Map();
      s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
        scrapeResult: {
          rawBody: '<main></main>',
        },
      })));

      await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);
      expect(context.log.error).to.have.been.calledWith('SDA: Could not find structured data for issue of type BreadcrumbList for URL https://example.com/product/1');
      expect(firefallClientStub.fetchChatCompletion).to.not.have.been.called;
    });

    it('logs a warning if cleanup of microdata markup fails', async () => {
      const auditData = {
        auditResult: {
          success: true,
          issues: [{
            pageUrl: 'https://example.com/product/1',
            rootType: 'BreadcrumbList',
            dataFormat: 'rdfa',
            source: 123,
            issueMessage: 'Invalid URL in field "item"',
            severity: 'ERROR',
          }],
        },
      };

      const scrapeCache = new Map();
      s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
        scrapeResult: {
          rawBody: '<main></main>',
          structuredData: [{
            '@type': 'BreadcrumbList',
          }],
        },
      })));

      await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);
      expect(context.log.warn).to.have.been.calledWith('SDA: Could not cleanup markup for issue of type BreadcrumbList for URL https://example.com/product/1');
    });

    it('generates a suggestion', async () => {
      const auditData = {
        auditResult: {
          success: true,
          issues: [{
            pageUrl: finalUrl,
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            source: '{"itemListElement":[{"position":1,"name":"Things To Do","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@5ac9b38d","@type":"ListItem"},{"position":2,"name":"REESE\'S Stuff Your Cup","item":"com.adobe.cq.wcm.core.components.internal.link.LinkImpl@545b1739","@type":"ListItem"}],"@type":"BreadcrumbList"}',
            issueMessage: 'Invalid URL in field "item"',
            severity: 'WARNING',
          }],
        },
      };

      const scrapeCache = new Map();
      s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
        scrapeResult: {
          rawBody: '<main></main>',
          structuredData: [{
            '@type': 'BreadcrumbList',
          }],
        },
      })));

      const suggestion = {
        errorDescription: 'Invalid URL in field "item"',
        correctedLdjson: '{}',
        aiRationale: 'Invalid URL in field "item"',
        confidenceScore: 0.95,
      };
      firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));

      const result = await generateSuggestionsData(finalUrl, auditData, context, scrapeCache);
      expect(result.auditResult.issues.length).to.equal(1);
      expect(result.auditResult.issues[0].suggestion).to.deep.equal(suggestion);
    });
  });

  describe('processStructuredData', () => {
    it('returns empty array if no structured data is found', async () => {
      const scrapeCache = new Map();
      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
      urlInspectStub.resolves(gscExample1);

      s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
        scrapeResult: {
          structuredData: {
            jsonld: {
              BreadcrumbList: [
                {
                  itemListElement: [
                    {
                      position: 1,
                      name: 'Product',
                      '@type': 'ListItem',
                      item: 'https://example.com/product/1',
                    },
                    {
                      position: 2,
                      '@type': 'ListItem',
                    },
                  ],
                  '@type': 'BreadcrumbList',
                  '@location': '1690,2640',
                },
              ],
            },
            errors: [],
          },
        },
      })));

      const pages = [
        { url: 'https://example.com/product/1' },
      ];

      const result = await processStructuredData(finalUrl, context, pages, scrapeCache);
      expect(result).to.deep.equal({
        success: true,
        issues: [
          {
            pageUrl: 'https://example.com/product/1',
            rootType: 'BreadcrumbList',
            dataFormat: 'jsonld',
            location: '1690,2640',
            source: '{"itemListElement":[{"position":1,"name":"Product","@type":"ListItem","item":"https://example.com/product/1"},{"position":2,"@type":"ListItem"}],"@type":"BreadcrumbList"}',
            issueMessage: 'One of the following conditions needs to be met: Required attribute "name" is missing or Required attribute "item.name" is missing',
            severity: 'ERROR',
            path: [{
              index: 0,
              type: 'BreadcrumbList',
            },
            {
              index: 1,
              length: 2,
              property: 'itemListElement',
              type: 'ListItem',
            }],
            errors: [],
          },
          {
            pageUrl: 'https://example.com/product/1',
            rootType: 'Product',
            dataFormat: 'jsonld',
            issueMessage: 'Missing field "name"',
            severity: 'ERROR',
            errors: [],
          },
        ],
      });
    });

    it('returns a list of issues', async () => {
      const scrapeCache = new Map();
      sandbox.stub(GoogleClient, 'createFrom').throws(new Error('No secrets found'));
      s3ClientStub.send.rejects(new Error('Failed to fetch S3 object'));

      const pages = [
        { url: 'https://example.com/product/1' },
      ];

      const result = await processStructuredData(finalUrl, context, pages, scrapeCache);
      expect(result).to.deep.equal({
        success: true,
        issues: [],
      });
    });
  });

  describe('importTopPages', () => {
    it('sends import top pages event', async () => {
      const result = await importTopPages(context);
      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: '123',
        auditResult: {
          status: 'preparing',
          finalUrl,
        },
        fullAuditRef: 'scrapes/123/',
        finalUrl,
      });
    });
  });

  describe('submitForScraping', () => {
    it('sends scraping request event', async () => {
      const result = await submitForScraping(context);
      expect(result).to.deep.equal({
        siteId: '123',
        type: 'structured-data',
        urls: [
          { url: 'https://example.com/product/1' },
          { url: 'https://example.com/product/2' },
          { url: 'https://example.com/product/3' },
        ],
      });
    });

    it('throws error if no top pages are found when sending scraping request', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([]);

      expect(submitForScraping(context)).to.be.rejectedWith('No top pages for site ID 123 found.');
    });
  });
});
