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

import { generateSuggestionsData, opportunityAndSuggestions, structuredDataHandler } from '../../src/structured-data/handler.js';
import { MockContextBuilder } from '../shared.js';

import gscExample1 from '../fixtures/structured-data/gsc-example1.json' with { type: 'json' };
import gscExample2 from '../fixtures/structured-data/gsc-example2.json' with { type: 'json' };
import gscExample3 from '../fixtures/structured-data/gsc-example3.json' with { type: 'json' };

import expectedOppty from '../fixtures/structured-data/oppty.json' with { type: 'json' };

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

const createAuditData = (baseUrl, type, issueMessage, suggestion) => ({
  siteId: 'site-id',
  id: 'audit-id',
  fullAuditRef: baseUrl,
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

describe('Structured Data Audit', () => {
  let context;
  let googleClientStub;
  let urlInspectStub;
  let siteStub;
  let structuredDataSuggestions;
  let mockConfiguration;
  let s3ClientStub;
  let firefallClientStub;

  const baseUrl = 'https://www.example.com';

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

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.stub(),
        },
        s3Client: s3ClientStub,
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
    siteStub = {
      getId: () => '123',
      getConfig: () => ({
        getIncludedURLs: () => ['https://example.com/product/1', 'https://example.com/product/2', 'https://example.com/product/3'],
      }),
    };

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

    const result = await structuredDataHandler(baseUrl, context, siteStub);
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

    const result = await structuredDataHandler(baseUrl, context, siteStub);
    expect(result).to.deep.equal({
      fullAuditRef: 'https://www.example.com',
      auditResult: {
        error: 'Failed to create Google client. Site was probably not onboarded to GSC yet. Error: No secrets found',
        success: false,
      },
    });
  });

  it('gets results from google client with and without rich results', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(gscExample1);
    urlInspectStub.onSecondCall().resolves(gscExample2);
    urlInspectStub.onThirdCall().resolves(gscExample3);

    const result = await structuredDataHandler(baseUrl, context, siteStub);
    expect(urlInspectStub).to.have.been.calledThrice;
    expect(urlInspectStub).to.have.been.calledWith('https://example.com/product/1');
    expect(urlInspectStub).to.have.been.calledWith('https://example.com/product/2');
    expect(urlInspectStub).to.have.been.calledWith('https://example.com/product/3');

    expect(result).to.deep.equal({
      fullAuditRef: 'https://www.example.com',
      auditResult: [
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
      ],
    });
  });

  it('filters out failing inspections', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(gscExample1);
    urlInspectStub.onSecondCall().resolves(gscExample2);
    urlInspectStub.onThirdCall().throws(new Error('Failed to inspect URL'));

    const result = await structuredDataHandler(baseUrl, context, siteStub);
    expect(urlInspectStub).to.have.been.calledThrice;

    expect(result.auditResult.length).to.equal(2);
  });

  it('skips generating suggestions if audit failed', async () => {
    const auditData = {
      fullAuditRef: baseUrl,
      auditResult: {
        error: 'Failed to inspect URL',
        success: false,
      },
    };

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(context.log.info).to.have.been.calledWith('Audit failed, skipping suggestions data generation');
    expect(result).to.deep.equal(auditData);
  });

  it('skips generating suggestions if configuration is not enabled', async () => {
    const auditData = {
      fullAuditRef: baseUrl,
      auditResult: [],
    };
    mockConfiguration.isHandlerEnabledForSite = sinon.stub().returns(false);

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);

    expect(context.log.info).to.have.been.calledWith('Auto-suggest is disabled for site');
    expect(result).to.deep.equal(auditData);
  });

  it('skips url if scrape is not available', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.rejects(new Error('Failed to fetch S3 object'));

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('Could not find scrape for /product/1. Make sure that scrape-top-pages did run.');
  });

  it('skips url if no structured data in scrape', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({})));

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('No structured data found in scrape result for URL https://example.com/product/1');
  });

  it('skips issue if entity mapping is not available', async () => {
    const auditData = createAuditData(baseUrl, 'Something random', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{}],
      },
    })));

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('Could not find entity mapping for issue of type Something random');
  });

  it('skips issue if entity cannot be found in structured data', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Article',
        }],
      },
    })));
    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);

    expect(context.log.error).to.have.been.calledWith('Could not find structured data for issue of type Product');
  });

  it('skips issue if Firefall does not return a suggestion', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');
    s3ClientStub.send.resolves(createS3ObjectStub(JSON.stringify({
      scrapeResult: {
        rawBody: '<main></main>',
        structuredData: [{
          '@type': 'Product',
        }],
      },
    })));
    firefallClientStub.fetchChatCompletion.resolves({ choices: [] });

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);
    expect(context.log.error).to.have.been.calledWith('Could not create suggestion because Firefall did not return any suggestions for issue of type Product snippets');
  });

  it('skips issue if Firefall response cannot be parsed', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');
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

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);
    expect(context.log.error).to.have.been.calledWith('Could not parse Firefall response for issue of type Product snippets');
  });

  it('skips issue if Firefall confidence score is below 60%', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');
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

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(auditData);
    expect(context.log.error).to.have.been.calledWith('Confidence score too low, skip suggestion of type Product snippets');
  });

  it('generates suggestion for a Product', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');
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

    const result = await generateSuggestionsData(baseUrl, auditData, context, siteStub);
    expect(result).to.deep.equal(createAuditData(baseUrl, 'Product snippets', 'Missing field "name"', suggestion));
  });

  it('transforms the audit data into opportunities with no auto-suggestion', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions(baseUrl, auditData, context);

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
          fix: '',
        }],
      },
    }]);
  });

  it('transforms the audit data into opportunities with auto-suggestions', async () => {
    const suggestion = {
      errorDescription: 'Missing field "name"',
      correctedLdjson: '{"@type":"Product","name":"Example Product Name"}',
      aiRationale: 'The product name is missing.',
      confidenceScore: 0.95,
    };
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"', suggestion);
    // eslint-disable-next-line no-useless-escape
    const expectedFix = '\n## Issue Explanation\nMissing field \"name\"\n## Corrected Structured Data\n```json\n"{\\\"@type\\\":\\\"Product\\\",\\\"name\\\":\\\"Example Product Name\\\"}\"\n```\n\n## Rationale\nThe product name is missing.\n\n_Confidence score: 95%_';

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions(baseUrl, auditData, context);

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
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([context.dataAccess.Opportunity]);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.getType.returns('structured-data');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions(baseUrl, auditData, context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.dataAccess.Opportunity.setAuditId).to.have.been.calledOnceWith('audit-id');
    expect(context.dataAccess.Opportunity.save).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnce;
  });

  it('should throw an error if creating a new opportunity fails', async () => {
    const auditData = createAuditData(baseUrl, 'Product snippets', 'Missing field "name"');

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.throws(new Error('opportunity-error'));

    try {
      await opportunityAndSuggestions(baseUrl, auditData, context);
      expect.fail;
    } catch (error) {
      expect(error.message).to.equal('opportunity-error');
    }

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);
    expect(context.dataAccess.Opportunity.addSuggestions).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith('Failed to create new opportunity for siteId site-id and auditId audit-id: opportunity-error');
  });
});
