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

import chaiAsPromised from 'chai-as-promised';
import {
  processStructuredData,
  generateSuggestionsData,
  opportunityAndSuggestions,
  runAuditAndGenerateSuggestions,
  importTopPages,
  submitForScraping,
} from '../../src/structured-data/handler.js';
import { MockContextBuilder } from '../shared.js';

import gscExample1 from '../fixtures/structured-data/gsc-example1.json' with { type: 'json' };
import gscExample2 from '../fixtures/structured-data/gsc-example2.json' with { type: 'json' };
import gscExample3 from '../fixtures/structured-data/gsc-example3.json' with { type: 'json' };
import gscExample4 from '../fixtures/structured-data/gsc-example4.json' with { type: 'json' };
import gscExample5 from '../fixtures/structured-data/gsc-example5.json' with { type: 'json' };

import expectedOppty from '../fixtures/structured-data/oppty.json' with { type: 'json' };
import { findPagesWithFAQMismatch, handleGEOStructuredData } from '../../src/structured-data-geo/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Structured Data Audit', () => {
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

  const createAuditData = (finalUrl, type, issueMessage, suggestion) => ({
    siteId: 'site-id',
    id: 'audit-id',
    fullAuditRef: finalUrl,
    auditResult: [{
      inspectionUrl: 'https://example.com/product/1',
      indexStatusResult: {
        verdict: 'PASS',
        lastCrawlTime: '2024-08-13T22:35:22Z',
      },
      richResults: {
        verdict: 'FAIL',
        detectedItemTypes: [
          type,
        ],
        detectedIssues: [
          {
            richResultType: type,
            items: [
              {
                name: 'Unnamed item',
                issues: [
                  {
                    issueMessage,
                    severity: 'ERROR',
                  },
                ],
              },
            ],
            suggestion,
          },
        ],
      },
    }],
  });

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
      send: sinon.stub(),
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

  it('fails if no top pages are available', async () => {
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

  it('fails if google client cannot be created', async () => {
    sandbox.stub(GoogleClient, 'createFrom').throws(new Error('No secrets found'));

    await expect(processStructuredData(finalUrl, context, [{ url: 'https://www.example.com' }]))
      .to.be.rejectedWith('Failed to create Google client. Site was probably not onboarded to GSC yet. Error: No secrets found');
  });

  it('gets results from google client with and without rich results', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(gscExample1);
    urlInspectStub.onSecondCall().resolves(gscExample2);
    urlInspectStub.onThirdCall().resolves(gscExample3);
    const pages = [
      { url: 'https://example.com/product/1' },
      { url: 'https://example.com/product/2' },
      { url: 'https://example.com/product/3' },
    ];

    const result = await processStructuredData(finalUrl, context, pages);
    expect(urlInspectStub).to.have.been.calledThrice;
    expect(urlInspectStub).to.have.been.calledWith('https://example.com/product/1');
    expect(urlInspectStub).to.have.been.calledWith('https://example.com/product/2');
    expect(urlInspectStub).to.have.been.calledWith('https://example.com/product/3');

    expect(result).to.deep.equal([
      {
        inspectionUrl: 'https://example.com/product/1',
        indexStatusResult: {
          verdict: 'PASS',
          lastCrawlTime: '2024-08-13T22:35:22Z',
        },
        richResults: {
          verdict: 'FAIL',
          detectedItemTypes: [
            'Product snippets',
          ],
          detectedIssues: [
            {
              richResultType: 'Product snippets',
              items: [
                {
                  name: 'Unnamed item',
                  issues: [
                    {
                      issueMessage: 'Missing field "name"',
                      severity: 'ERROR',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        inspectionUrl: 'https://example.com/product/2',
        indexStatusResult: {
          verdict: 'PASS',
          lastCrawlTime: '2024-08-13T22:35:22Z',
        },
        richResults: {
          verdict: 'FAIL',
          detectedItemTypes: [
            'Merchant listings',
          ],
          detectedIssues: [
            {
              richResultType: 'Merchant listings',
              items: [
                {
                  name: 'Example Product Name',
                  issues: [
                    {
                      issueMessage: 'Missing field "priceCurrency"',
                      severity: 'ERROR',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        inspectionUrl: 'https://example.com/product/3',
        indexStatusResult: {
          verdict: 'PASS',
          lastCrawlTime: '2024-08-13T22:35:22Z',
        },
        richResults: {
          verdict: 'PASS',
          detectedItemTypes: [],
          detectedIssues: [],
        },
      },
    ]);
  });

  it('returns an empty response if results from google client do not have rich results', async () => {
    const pages = [
      { url: 'https://example.com/product/4' },
    ];
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(gscExample4);

    const result = await processStructuredData(finalUrl, context, pages);
    expect(urlInspectStub).to.have.been.calledWith('https://example.com/product/4');

    expect(result).to.deep.equal([
      {
        inspectionUrl: 'https://example.com/product/4',
        indexStatusResult: {
          verdict: 'PASS',
          lastCrawlTime: '2024-08-13T22:35:22Z',
        },
        richResults: {},
      },
    ]);
  });

  it('filters out failing inspections', async () => {
    const pages = [
      { url: 'https://example.com/product/1' },
      { url: 'https://example.com/product/2' },
      { url: 'https://example.com/product/3' },
    ];

    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(gscExample1);
    urlInspectStub.onSecondCall().resolves(gscExample2);
    urlInspectStub.onThirdCall().throws(new Error('Failed to inspect URL'));

    const result = await processStructuredData(finalUrl, context, pages);
    expect(urlInspectStub).to.have.been.calledThrice;

    expect(result.length).to.equal(2);
  });

  it('filters out duplicate issue entries', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(gscExample5);

    const pages = [
      { url: 'https://example.com/product/1' },
    ];

    const result = await processStructuredData(finalUrl, context, pages);
    expect(urlInspectStub).to.have.been.calledOnce;
    expect(result).to.deep.equal([
      {
        inspectionUrl: 'https://example.com/product/1',
        indexStatusResult: {
          verdict: 'PASS',
          lastCrawlTime: '2024-08-13T22:35:22Z',
        },
        richResults: {
          verdict: 'FAIL',
          detectedItemTypes: [
            'Review snippets',
            'Product snippets',
          ],
          detectedIssues: [
            {
              richResultType: 'Review snippets',
              items: [
                {
                  name: 'Unnamed item',
                  issues: [
                    {
                      issueMessage: 'Missing field "itemReviewed"',
                      severity: 'ERROR',
                    },
                    {
                      issueMessage: 'Missing field "author"',
                      severity: 'ERROR',
                    },
                  ],
                },
              ],
            },
            {
              richResultType: 'Product snippets',
              items: [
                {
                  name: 'Unnamed item',
                  issues: [
                    {
                      issueMessage: 'Missing field "name"',
                      severity: 'ERROR',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
  });

  it('skips generating suggestions if audit failed', async () => {
    const auditData = {
      fullAuditRef: finalUrl,
      auditResult: {
        error: 'Failed to inspect URL',
        success: false,
      },
    };

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(context.log.info).to.have.been.calledWith('Audit failed, skipping suggestions data generation');
    expect(result).to.deep.equal(auditData);
  });

  it('skips generating suggestions if configuration is not enabled', async () => {
    const auditData = {
      fullAuditRef: finalUrl,
      auditResult: [],
    };
    mockConfiguration.isHandlerEnabledForSite = sinon.stub().returns(false);

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);

    expect(context.log.info).to.have.been.calledWith('Auto-suggest is disabled for site');
    expect(result).to.deep.equal(auditData);
  });

  it('skips url if scrape is not available', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.rejects(new Error('Failed to fetch S3 object'));

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('Could not find scrape for /product/1. Make sure that scrape-top-pages did run.');
  });

  it('skips url if no structured data in scrape', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({})));

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('No structured data found in scrape result for URL https://example.com/product/1');
  });

  it('skips issue if entity mapping is not available', async () => {
    const auditData = createAuditData(finalUrl, 'Something random', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{}],
      },
    })));

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('Could not find entity mapping for issue of type Something random for URL https://example.com/product/1');
  });

  it('skips issue if entity cannot be found in structured data', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Article',
        }],
      },
    })));
    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('Could not find structured data for issue of type Product for URL https://example.com/product/1');
  });

  it('skips issue if Firefall does not return a suggestion', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
        }],
      },
    })));
    firefallClientStub.fetchChatCompletion.resolves({ choices: [] });

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);
    expect(context.log.error).to.have.been.calledWith('Could not create suggestion because Firefall did not return any suggestions for issue of type Product snippets for URL https://example.com/product/1');
  });

  it('skips issue if Firefall response cannot be parsed', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
        }],
      },
    })));
    firefallClientStub.fetchChatCompletion.resolves({
      choices: [{
        finish_reason: 'stop',
        message: { content: 'Some answer that is not JSON' },
      }],
    });

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);
    expect(context.log.error).to.have.been.calledWith('Could not parse Firefall response for issue of type Product snippets for URL https://example.com/product/1');
  });

  it('skips issue if Firefall confidence score is below 60%', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    const suggestion = {
      errorDescription: 'Missing field "name"',
      correctedLdjson: '{"@type":"Product","name":"Example Product Name"}',
      aiRationale: 'The product name is missing.',
      confidenceScore: 0.55,
    };
    firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
        }],
      },
    })));

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);
    expect(context.log.error).to.have.been.calledWith('Confidence score too low, skip suggestion of type Product snippets for URL https://example.com/product/1');
  });

  it('skips generating suggestions once more than 50 Firefall requests have been made', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    // Duplicate audit result entries 51 times and change issue message
    auditData.auditResult = Array
      .from({ length: 51 }, () => structuredClone(auditData.auditResult[0]));
    auditData.auditResult = auditData.auditResult
      .map((result, index) => {
        // eslint-disable-next-line no-param-reassign
        result.richResults.detectedIssues[0].items[0].issues[0].issueMessage = `Missing field "name" ${index}`;
        return result;
      });

    const suggestion = {
      errorDescription: 'Missing field "name"',
      correctedLdjson: '{"@type":"Product","name":"Example Product Name"}',
      aiRationale: 'The product name is missing.',
      confidenceScore: 0.95,
    };
    firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
        }],
      },
    })));

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    // Should still get all 51 results
    expect(result.auditResult.length).to.equal(51);
    expect(context.log.error).to.have.been.calledWith('Aborting suggestion generation as more than 50 Firefall requests have been used.');
  });

  it('generates suggestion for a Product', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    const suggestion = {
      errorDescription: 'Missing field "name"',
      correctedLdjson: '{"@type":"Product","name":"Example Product Name"}',
      aiRationale: 'The product name is missing.',
      confidenceScore: 0.95,
    };
    firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
        }],
      },
    })));

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(createAuditData(finalUrl, 'Product snippets', 'Missing field "name"', suggestion));
  });

  it('re-uses existing suggestions for the same issue', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');
    // Duplicate same issue
    auditData.auditResult = Array
      .from({ length: 2 }, () => structuredClone(auditData.auditResult[0]));

    const suggestion = {
      errorDescription: 'Missing field "name"',
      correctedLdjson: '{"@type":"Product","name":"Example Product Name"}',
      aiRationale: 'The product name is missing.',
      confidenceScore: 0.95,
    };
    firefallClientStub.fetchChatCompletion.resolves(createFirefallSuggestion(suggestion));
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
        }],
      },
    })));

    const result = await generateSuggestionsData(finalUrl, auditData, context, siteStub);
    expect(context.log.info).to.have.been.calledWith('Re-use existing suggestion for type Product snippets and URL https://example.com/product/1');

    const expectedAuditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"', suggestion);
    expectedAuditData.auditResult = Array
      .from({ length: 2 }, () => structuredClone(expectedAuditData.auditResult[0]));
    expect(result).to.deep.equal(expectedAuditData);
  });

  it('calls Firefall with AggregateRating structured data', async () => {
    const auditData = createAuditData(finalUrl, 'Review snippets', 'Either "ratingCount" or "reviewCount" should be specified');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: 4.5,
          },
        }],
      },
    })));
    firefallClientStub.fetchChatCompletion.rejects(new Error('No suggestions found'));

    await generateSuggestionsData(finalUrl, auditData, context, siteStub);

    // Get log call with structured data
    const logCall = context.log.debug.getCalls().find((call) => call.args[0].includes('Filtered structured data:'));
    expect(logCall.args[1]).to.equal('{"@type":"AggregateRating","ratingValue":4.5}');
  });

  it('skips transforming the audit data into opportunities if audit failed', async () => {
    const auditData = {
      fullAuditRef: finalUrl,
      auditResult: {
        error: 'Failed to inspect URL',
        success: false,
      },
    };

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    const result = await opportunityAndSuggestions(finalUrl, auditData, context);

    expect(context.log.info).to.have.been.calledWith('Audit failed, skipping opportunity generation');
    expect(result).to.deep.equal(auditData);
  });

  it('transforms the audit data into opportunities with no auto-suggestion', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');

    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions(finalUrl, auditData, context);

    // eslint-disable-next-line quotes
    const expectedFix = `\n## Issues Detected for Product snippets\n\n* Unnamed item\n    * Missing field "name"\n\n`;

    expect(context.dataAccess.Opportunity.create).to.have.been.calledWith(expectedOppty);
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledWith([{
      opportunityId: 'opportunity-id',
      type: 'CODE_CHANGE',
      rank: 1,
      data: {
        type: 'url',
        url: 'https://example.com/product/1',
        errors: [{
          id: 'productsnippets',
          errorTitle: 'Product snippets',
          fix: expectedFix,
        }],
      },
    }]);
  });

  it('transforms the audit data into opportunities with auto-suggestions', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    const suggestion = {
      errorDescription: 'Missing field "name"',
      correctedLdjson: '{"@type":"Product","name":"Example Product Name"}',
      aiRationale: 'The product name is missing.',
      confidenceScore: 0.95,
    };
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"', suggestion);
    // eslint-disable-next-line no-useless-escape
    const expectedFix = '\n## Issue Explanation\nMissing field \"name\"\n## Corrected Structured Data\n```json\n"{\\\"@type\\\":\\\"Product\\\",\\\"name\\\":\\\"Example Product Name\\\"}\"\n```\n\n## Rationale\nThe product name is missing.\n\n_Confidence score: 95%_';

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions(finalUrl, auditData, context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledWith(expectedOppty);
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledWith([{
      opportunityId: 'opportunity-id',
      type: 'CODE_CHANGE',
      rank: 1,
      data: {
        type: 'url',
        url: 'https://example.com/product/1',
        errors: [{
          id: 'productsnippets',
          errorTitle: 'Product snippets',
          fix: expectedFix,
        }],
      },
    }]);
  });

  it('should transform the audit result into opportunities and suggestions in the post processor and add the audit to an existing opportunity', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([context.dataAccess.Opportunity]);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.getType.returns('structured-data');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions(finalUrl, auditData, context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.dataAccess.Opportunity.setAuditId).to.have.been.calledOnceWith('audit-id');
    expect(context.dataAccess.Opportunity.save).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnce;
  });

  it('should transform the audit result into opportunities and suggestions in the post processor and add the audit to an existing opportunity with outdated suggestions', async () => {
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([context.dataAccess.Opportunity]);
    const existingSuggestionsData = {
      type: 'url',
      url: 'https://example.com/product/1',
      errors: [
        {
          id: 'missingfieldimages',
          errorTitle: "Missing field 'images'",
          fix: '',
        },
        {
          id: 'missingfieldrecipe',
          errorTitle: "Missing field 'Recipe'",
          fix: '',
        },
      ],
    };

    const existingSuggestions = [{
      opportunityId: 'opportunity-id',
      type: 'CODE_CHANGE',
      rank: 2,
      data: existingSuggestionsData,
      remove: sinon.stub(),
      getData: sinon.stub().returns(existingSuggestionsData),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
      getStatus: sinon.stub().returns('NEW'),
    }];

    context.dataAccess.Opportunity.getSuggestions.resolves(existingSuggestions);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.getType.returns('structured-data');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions(finalUrl, auditData, context);

    expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
      existingSuggestions,
      'OUTDATED',
    );
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.dataAccess.Opportunity.setAuditId).to.have.been.calledOnceWith('audit-id');
    expect(context.dataAccess.Opportunity.save).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnce;
  });

  it('should throw an error if creating a new opportunity fails', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    const auditData = createAuditData(finalUrl, 'Product snippets', 'Missing field "name"');

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.throws(new Error('opportunity-error'));

    try {
      await opportunityAndSuggestions(finalUrl, auditData, context);
      expect.fail;
    } catch (error) {
      expect(error.message).to.equal('opportunity-error');
    }

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);
    expect(context.dataAccess.Opportunity.addSuggestions).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith('Failed to create new opportunity for siteId site-id and auditId audit-id: opportunity-error');
  });

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

  it('runs a full audit', async () => {
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
      createPageStub('https://example.com/product/1'),
    ]);

    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(gscExample1);

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([context.dataAccess.Opportunity]);
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

    expect(result.auditResult.auditResult).to.have.lengthOf(1);
    expect(result.auditResult.auditResult[0].richResults.detectedIssues).to.have.lengthOf(1);
    expect(result.auditResult.auditResult[0].richResults.detectedIssues[0].suggestion)
      .to.deep.equal(suggestion);
  });
});

describe('FAQ mismatch check', () => {
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

  let context;
  let siteStub;
  let mockConfiguration;
  let s3ClientStub;
  let auditStub;

  const finalUrl = 'https://www.example.com';

  beforeEach(() => {
    mockConfiguration = {
      isHandlerEnabledForSite: sinon.stub().returns(true),
    };
    s3ClientStub = {
      send: sinon.stub(),
      getObject: sinon.stub(),
    };

    siteStub = {
      getId: () => '123',
      getConfig: () => ({
        getIncludedURLs: () => ['https://example.com/product/1', 'https://example.com/product/2', 'https://example.com/product/3'],
      }),
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
  });

  afterEach(() => {
    sandbox.restore();
  });

  const testUrl = 'http://example.com';

  it('handles no pages', async () => {
    const result = await findPagesWithFAQMismatch([], context);

    expect(result).to.deep.equal([]);
  });

  it('handles invalid URL', async () => {
    const result = await findPagesWithFAQMismatch([{ url: 'bad url' }], context);

    expect(result).to.deep.equal([]);
  });

  it('ignores pages with no scrape', async () => {
    s3ClientStub.send.rejects(new Error('Failed to fetch S3 object'));
    const result = await findPagesWithFAQMismatch([{ url: testUrl }], context);

    expect(result).to.deep.equal([]);
  });

  it('ignores pages with FAQ in structured data', async () => {
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'FAQPage',
        }],
      },
    })));
    const result = await findPagesWithFAQMismatch([{ url: testUrl }], context);

    expect(result).to.deep.equal([]);
  });

  it('returns pages with no FAQ in structured data but FAQ in body', async () => {
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main><div id="faq"></div></main>',
        structuredData: [],
      },
    })));
    const result = await findPagesWithFAQMismatch([{ url: testUrl }], context);

    expect(result).to.deep.equal([{ url: testUrl }]);
  });

  it('fails if no top pages returned', async () => {
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([]);

    await expect(handleGEOStructuredData(context)).to.be.rejectedWith('No top pages for site ID 123 found.');
  });

  it('doesn\'t create suggestions if pages already have FAQData', async () => {
    const buildS3Object = (strData, body) => createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: body,
        structuredData: [strData],
      },
    }));

    s3ClientStub.send.onCall(0).resolves(buildS3Object({ '@type': 'FAQPage' }, ''));
    s3ClientStub.send.onCall(1).resolves(buildS3Object({ '@type': 'FAQPage' }, ''));
    s3ClientStub.send.onCall(2).resolves(buildS3Object({ '@type': 'FAQPage' }, ''));

    const result = await handleGEOStructuredData(context);

    expect(result).to.deep.equal({
      auditResult: {
        message: 'No pages with FAQ mismatch found',
      },
      fullAuditRef: 'https://www.example.com',
    });
  });

  it('creates suggestions if pages have mismatch', async () => {
    const buildS3Object = (strData, body) => createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: body,
        structuredData: [strData],
      },
    }));

    s3ClientStub.send.onCall(0).resolves(buildS3Object({ '@type': 'FAQPage' }, ''));
    s3ClientStub.send.onCall(1).resolves(buildS3Object({ }, '<div class="faq"></div>'));
    s3ClientStub.send.onCall(2).resolves(buildS3Object({ }, ''));

    const faqSuggestion = {
      type: 'url',
      url: 'https://example.com/product/2',
      errors: [{
        id: 'https://example.com/product/2-faq-missing',
        errorTitle: 'Missing FAQ',
        fix: 'Detected a page with FAQs that doesn\'t provide the FAQ as structured data.',
      }],
    };

    const faqSuggestionsCreated = {
      createdItems: [faqSuggestion],
    };

    const faqOpportunity = {
      opportunityId: 'opportunity-id',
      type: 'CODE_CHANGE',
      rank: 10,
      data: faqSuggestion,
    };

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(faqSuggestionsCreated);

    const result = await handleGEOStructuredData(context);

    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledWith([faqOpportunity]);

    expect(result).to.deep.equal({
      auditResult: {
        message: 'Successfully created suggestion to update 1 pages with FAQ structured data',
        pages: JSON.stringify([{ url: 'https://example.com/product/2' }]),
      },
      fullAuditRef: 'https://www.example.com',
    });
  });
});
