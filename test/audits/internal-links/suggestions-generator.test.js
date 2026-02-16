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
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import sinon from 'sinon';
import nock from 'nock';
import { Audit, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import esmock from 'esmock';
import { generateSuggestionData } from '../../../src/internal-links/suggestions-generator.js';
import { MockContextBuilder } from '../../shared.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

const site = {
  getConfig: () => Config({}),
  getId: () => 'site1',
  getBaseURL: () => 'https://bar.foo.com',
  getIsLive: () => true,
  getOrganizationId: () => 'org1',
};

use(sinonChai);
use(chaiAsPromised);

describe('generateSuggestionData', async function test() {
  this.timeout(10000);

  let auditData;
  let brokenInternalLinksData;
  let configuration;
  let azureOpenAIClient;

  let message;
  let context;

  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    message = {
      type: 'internal-links',
      siteId: 'site1',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          AZURE_OPENAI_ENDPOINT: 'https://test-openai-endpoint.com/',
          AZURE_API_VERSION: '2024-02-15',
          AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          AZURE_OPENAPI_KEY: 'test-openapi-key',
        },
        s3Client: {
          send: sandbox.stub(),
        },
      })
      .build(message);
  });
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  const mockFileResponse = {
    ContentType: 'application/json',
    Body: {
      transformToString: sandbox.stub().resolves(JSON.stringify({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: '<html lang="en"><body><header><a href="/home">Home</a><a href="/about">About</a></header></body></html>',
          tags: {
            title: 'Page 1 Title',
            description: 'Page 1 Description',
            h1: ['Page 1 H1'],
          },
        },
      })),
    },
  };

  beforeEach(() => {
    brokenInternalLinksData = [
      { urlTo: 'https://example.com/broken1' },
      { urlTo: 'https://example.com/broken2' },
    ];
    auditData = {
      getAuditResult: () => ({
        success: true,
        brokenInternalLinks: [
          { urlTo: 'https://example.com/broken1' },
          { urlTo: 'https://example.com/broken2' },
        ],
      }),
    };
    configuration = {
      isHandlerEnabledForSite: sandbox.stub(),
      getHandlers: sandbox.stub().returns({}),
    };
    context.dataAccess.Configuration.findLatest.resolves(configuration);

    azureOpenAIClient = {
      fetchChatCompletion: sandbox.stub(),
    };
    sandbox.stub(AzureOpenAIClient, 'createFrom').returns(azureOpenAIClient);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('if sitedata is not found, return audit object as is', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);
    expect(configuration.isHandlerEnabledForSite()).to.equal(true);
    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });
    azureOpenAIClient.fetchChatCompletion.onCall(3).resolves({
      choices: [{
        message: { content: JSON.stringify({ some_other_property: 'some other value' }) },
        finish_reason: 'stop',
      }],
    });

    await generateSuggestionData('https://example.com', auditData, context, site);

    expect(azureOpenAIClient.fetchChatCompletion).to.not.have.been.called;
  });

  it('processes suggestions for broken internal links, defaults to base URL if none found', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    // Mock responses based on broken_url in request body
    azureOpenAIClient.fetchChatCompletion.callsFake(async (requestBody) => {
      // requestBody could be a string or object containing the prompt
      let brokenUrl = null;
      try {
        const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
        brokenUrl = body.broken_url;
      } catch (e) {
        // If not JSON, check if requestBody contains the broken URL in string form
        if (typeof requestBody === 'string' && requestBody.includes('broken1')) {
          brokenUrl = 'https://example.com/broken1';
        } else if (typeof requestBody === 'string' && requestBody.includes('broken2')) {
          brokenUrl = 'https://example.com/broken2';
        }
      }

      // broken1 gets suggestions, broken2 gets empty response
      if (brokenUrl === 'https://example.com/broken1') {
        return {
          choices: [{
            message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
            finish_reason: 'stop',
          }],
        };
      } else if (brokenUrl === 'https://example.com/broken2') {
        return {
          choices: [{
            message: { content: JSON.stringify({ some_other_property: 'some other value' }) },
            finish_reason: 'stop',
          }],
        };
      }

      return {
        choices: [{
          message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(azureOpenAIClient.fetchChatCompletion).to.have.been.called;
    const sortedResult = result.sort((a, b) => a.urlTo.localeCompare(b.urlTo));
    expect(sortedResult).to.deep.equal([
      {
        urlTo: 'https://example.com/broken1',
        urlsSuggested: ['https://fix.com'],
        aiRationale: 'Rationale',
      },
      {
        urlTo: 'https://example.com/broken2',
        urlsSuggested: ['https://example.com'],
        aiRationale: 'No suitable suggestions found',
      },
    ]);
  });

  it('generates suggestions in multiple batches if there are more than 300 alternative URLs', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        // genereate 301 keys
        ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    // Mock responses based on broken_url in request body
    azureOpenAIClient.fetchChatCompletion.callsFake(async (requestBody) => {
      // requestBody could be a string or object containing the prompt
      let brokenUrl = null;
      try {
        const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
        brokenUrl = body.broken_url;
      } catch (e) {
        // If not JSON, check if requestBody contains the broken URL in string form
        if (typeof requestBody === 'string' && requestBody.includes('broken1')) {
          brokenUrl = 'https://example.com/broken1';
        } else if (typeof requestBody === 'string' && requestBody.includes('broken2')) {
          brokenUrl = 'https://example.com/broken2';
        }
      }

      // broken1 gets successful suggestions, broken2 causes error
      if (brokenUrl === 'https://example.com/broken1') {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
              aiRationale: 'Rationale',
            },
            finish_reason: 'stop',
          }],
        };
      } else if (brokenUrl === 'https://example.com/broken2') {
        // Throw error for broken2 to test error handling
        throw new Error('Simulated error');
      }

      // Default fallback
      return {
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(azureOpenAIClient.fetchChatCompletion).to.have.been.called;
    const sortedResult = result.sort((a, b) => a.urlTo.localeCompare(b.urlTo));
    expect(sortedResult).to.deep.equal([
      {
        urlTo: 'https://example.com/broken1',
        urlsSuggested: ['https://fix.com'],
        aiRationale: 'Rationale',
      },
      {
        urlTo: 'https://example.com/broken2',
      },
    ]);
  }).timeout(20000);

  it('handles Firefall client errors gracefully and continues processing, should suggest base URL instead', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        // genereate 301 keys
        ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    // Mock responses based on broken_url - broken1 returns empty, broken2 throws error
    azureOpenAIClient.fetchChatCompletion.callsFake(async (requestBody) => {
      // requestBody could be a string or object containing the prompt
      let brokenUrl = null;
      try {
        const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
        brokenUrl = body.broken_url;
      } catch (e) {
        // If not JSON, check if requestBody contains the broken URL in string form
        if (typeof requestBody === 'string' && requestBody.includes('broken1')) {
          brokenUrl = 'https://example.com/broken1';
        } else if (typeof requestBody === 'string' && requestBody.includes('broken2')) {
          brokenUrl = 'https://example.com/broken2';
        }
      }

      if (brokenUrl === 'https://example.com/broken1') {
        // broken1 returns empty suggestions
        return {
          choices: [{
            message: {
              content: JSON.stringify({}),
            },
            finish_reason: 'stop',
          }],
        };
      } else if (brokenUrl === 'https://example.com/broken2') {
        // broken2 throws error
        throw new Error('Firefall error');
      }

      // Default fallback
      return {
        choices: [{
          message: {
            content: JSON.stringify({}),
          },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    const sortedResult = result.sort((a, b) => a.urlTo.localeCompare(b.urlTo));
    expect(sortedResult).to.deep.equal([
      {
        urlTo: 'https://example.com/broken1',
        urlsSuggested: ['https://example.com'],
        aiRationale: 'No suitable suggestions found',
      },
      {
        urlTo: 'https://example.com/broken2',
      },
    ]);
    expect(context.log.error).to.have.been.called;
  }).timeout(20000);

  it('should extract path prefix from urlFrom when urlTo has no prefix', async () => {
    // Test the false branch of: extractPathPrefix(link.urlTo) || extractPathPrefix(link.urlFrom)
    // When urlTo has no prefix but urlFrom does
    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com/uk',
    };

    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    const mockFileResponseWithPrefix = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://bulk.com/uk/page1',
          scrapeResult: {
            rawBody: '<html><body><header><a href="/uk/home">Home</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };
    context.s3Client.send.resolves(mockFileResponseWithPrefix);

    // Broken link where urlTo has no prefix but urlFrom does
    // urlTo must have no path prefix (empty string from extractPathPrefix) to hit false branch
    const brokenLinks = [
      { urlTo: 'https://bulk.com', urlFrom: 'https://bulk.com/uk/page1' }, // urlTo has no prefix
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await generateSuggestionData('https://bulk.com', brokenLinks, context, siteWithSubpath);
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
  });

  it('should use prefix-filtered data when prefix filtering results in non-empty arrays', async () => {
    // Setup: site with baseURL that has subpath, broken link has same prefix
    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com/uk',
    };

    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    // Mock scrape data with URLs from /uk/ locale (matching the broken link prefix)
    const mockFileResponseWithLocale = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://bulk.com/uk/page1',
          scrapeResult: {
            rawBody: '<html><body><header><a href="/uk/home">Home</a><a href="/uk/about">About</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };
    context.s3Client.send.resolves(mockFileResponseWithLocale);

    // Broken link with same prefix (/uk/) - this will trigger the true branch
    // prefixFilteredSiteData.length > 0 will be true
    // linkFilteredSiteData = prefixFilteredSiteData
    const brokenLinksWithSamePrefix = [
      { urlTo: 'https://bulk.com/uk/broken1', urlFrom: 'https://bulk.com/uk/page1' },
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://bulk.com/uk/page1'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await generateSuggestionData('https://bulk.com', brokenLinksWithSamePrefix, context, siteWithSubpath);

    // Should use prefix-filtered data (true branch of if statements)
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
    expect(result[0].urlTo).to.equal('https://bulk.com/uk/broken1');
  });

  it('should handle siteData items that are strings', async () => {
    // Test when siteData items are strings - covers the string case in ternary operator
    // Import actual filter functions to use in mock
    const { filterByAuditScope, extractPathPrefix, isWithinAuditScope } = await import('../../../src/internal-links/subpath-filter.js');

    const mockedModule = await esmock('../../../src/internal-links/suggestions-generator.js', {
      '../../../src/support/utils.js': {
        getScrapedDataForSiteId: sandbox.stub().resolves({
          siteData: ['https://bulk.com/uk/page1'], // Strings, not objects
          headerLinks: ['https://bulk.com/uk/home'], // Strings
        }),
      },
      '../../../src/internal-links/subpath-filter.js': {
        filterByAuditScope, // Use actual function
        extractPathPrefix, // Use actual function
        isWithinAuditScope, // Use actual function
      },
    });

    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com/uk',
    };

    const brokenLinks = [
      { urlTo: 'https://bulk.com/uk/broken1', urlFrom: 'https://bulk.com/uk/page1' },
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await mockedModule.generateSuggestionData('https://bulk.com', brokenLinks, context, siteWithSubpath);
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
  });

  it('should handle siteData items that are objects, not strings', async () => {
    // Test when siteData items are objects (not strings)
    // covers the object case in ternary operator
    // Import actual filter functions to use in mock
    const { filterByAuditScope, extractPathPrefix, isWithinAuditScope } = await import('../../../src/internal-links/subpath-filter.js');

    const mockedModule = await esmock('../../../src/internal-links/suggestions-generator.js', {
      '../../../src/support/utils.js': {
        getScrapedDataForSiteId: sandbox.stub().resolves({
          siteData: [{ url: 'https://bulk.com/uk/page1', title: 'Test' }], // Objects, not strings
          headerLinks: ['https://bulk.com/uk/home'], // Strings
        }),
      },
      '../../../src/internal-links/subpath-filter.js': {
        filterByAuditScope, // Use actual function
        extractPathPrefix, // Use actual function
        isWithinAuditScope, // Use actual function
      },
    });

    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com/uk',
    };

    const brokenLinks = [
      { urlTo: 'https://bulk.com/uk/broken1', urlFrom: 'https://bulk.com/uk/page1' },
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await mockedModule.generateSuggestionData('https://bulk.com', brokenLinks, context, siteWithSubpath);
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
  });

  it('should handle headerLinks items that are objects', async () => {
    // Test when headerLinks items are objects (not strings)
    // covers the object case in ternary operator
    // Import actual filter functions to use in mock
    const { filterByAuditScope, extractPathPrefix, isWithinAuditScope } = await import('../../../src/internal-links/subpath-filter.js');

    const mockedModule = await esmock('../../../src/internal-links/suggestions-generator.js', {
      '../../../src/support/utils.js': {
        getScrapedDataForSiteId: sandbox.stub().resolves({
          siteData: [{ url: 'https://bulk.com/uk/page1', title: 'Test' }], // Objects
          headerLinks: [{ url: 'https://bulk.com/uk/home' }], // Objects, not strings
        }),
      },
      '../../../src/internal-links/subpath-filter.js': {
        filterByAuditScope, // Use actual function
        extractPathPrefix, // Use actual function
        isWithinAuditScope, // Use actual function
      },
    });

    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com/uk',
    };

    const brokenLinks = [
      { urlTo: 'https://bulk.com/uk/broken1', urlFrom: 'https://bulk.com/uk/page1' },
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await mockedModule.generateSuggestionData('https://bulk.com', brokenLinks, context, siteWithSubpath);
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
  });

  it('should fallback to base-filtered data when prefix filtering results in empty arrays', async () => {
    // Setup: site with baseURL that has subpath, but broken link has different prefix
    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com/uk',
    };

    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    // Mock scrape data with URLs from /uk/ locale only
    const mockFileResponseWithLocale = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://bulk.com/uk/page1',
          scrapeResult: {
            rawBody: '<html><body><header><a href="/uk/home">Home</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };
    context.s3Client.send.resolves(mockFileResponseWithLocale);

    // Broken link with different prefix (/fr/ instead of /uk/)
    // This will cause prefixFilteredSiteData.length === 0, so the condition is false
    // This covers the false branch (assignment doesn't happen)
    const brokenLinksWithDifferentPrefix = [
      { urlTo: 'https://bulk.com/fr/broken1', urlFrom: 'https://bulk.com/fr/page1' },
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await generateSuggestionData(
      'https://bulk.com',
      brokenLinksWithDifferentPrefix,
      context,
      siteWithSubpath,
    );

    // Should still process with base-filtered data
    // (fallback to base-filtered when prefix-filtered is empty)
    // This ensures the false branch is covered
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
  });

  it('should use dataBatches when link.filteredSiteData is not available', async () => {
    // Test when link.filteredSiteData is falsy, so we use dataBatches instead
    // This happens when linkPathPrefix is falsy
    const siteNoSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com', // No subpath
    };

    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    const mockFileResponseNoBatch = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://bulk.com/page1',
          scrapeResult: {
            rawBody: '<html><body><header><a href="/home">Home</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };
    context.s3Client.send.resolves(mockFileResponseNoBatch);

    // Broken link with no prefix - linkPathPrefix will be empty
    // link.filteredSiteData won't be set
    const brokenLinks = [
      { urlTo: 'https://bulk.com/broken1', urlFrom: 'https://bulk.com/page1' },
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await generateSuggestionData('https://bulk.com', brokenLinks, context, siteNoSubpath);
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
  });

  it('should use filteredHeaderLinks when link.filteredHeaderLinks not available', async () => {
    // Test when link.filteredHeaderLinks is falsy
    // so we use filteredHeaderLinks instead
    // This happens when linkPathPrefix is falsy
    const siteNoSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com', // No subpath
    };

    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    const mockFileResponseNoHeader = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://bulk.com/page1',
          scrapeResult: {
            rawBody: '<html><body><header><a href="/home">Home</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };
    context.s3Client.send.resolves(mockFileResponseNoHeader);

    // Broken link with no prefix - linkPathPrefix will be empty
    // link.filteredHeaderLinks won't be set
    const brokenLinks = [
      { urlTo: 'https://bulk.com/broken1', urlFrom: 'https://bulk.com/page1' },
    ];

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await generateSuggestionData('https://bulk.com', brokenLinks, context, siteNoSubpath);
    expect(result).to.be.an('array');
    expect(result.length).to.equal(1);
  });

  it('should return early when filteredSiteData is empty after filtering', async () => {
    // Setup: site with baseURL that filters out all siteData
    const siteWithSubpath = {
      ...site,
      getBaseURL: () => 'https://bulk.com/fr', // Different locale
    };

    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    // Mock scrape data with URLs from /uk/ locale (will be filtered out)
    const mockFileResponseUK = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://bulk.com/uk/page1',
          scrapeResult: {
            rawBody: '<html><body><header><a href="/uk/home">Home</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };
    context.s3Client.send.resolves(mockFileResponseUK);

    const brokenLinks = [
      { urlTo: 'https://bulk.com/fr/broken1', urlFrom: 'https://bulk.com/fr/page1' },
    ];

    const result = await generateSuggestionData('https://bulk.com', brokenLinks, context, siteWithSubpath);

    // Should return broken links as-is when filteredSiteData is empty
    expect(result).to.deep.equal(brokenLinks);
    expect(context.log.info).to.have.been.calledWith(
      `[${AUDIT_TYPE}] [Site: ${siteWithSubpath.getId()}] No site data found, skipping suggestions generation`,
    );
  });

  it('should handle batch finish_reason !== stop (processBatch error path)', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    let callCount = 0;
    azureOpenAIClient.fetchChatCompletion.callsFake(async () => {
      callCount += 1;
      // First two: headers (succeed normally)
      if (callCount <= 2) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
              aiRationale: 'Rationale',
            },
            finish_reason: 'stop',
          }],
        };
      }
      // Batches: return finish_reason: 'length' to trigger error path
      if (callCount === 3) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
              aiRationale: 'Rationale',
            },
            finish_reason: 'length', // This triggers processBatch to return null
          }],
        };
      }
      // Final request succeeds
      return {
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Final' }),
            aiRationale: 'Final',
          },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(result).to.have.lengthOf(2);
    expect(context.log.error).to.have.been.calledWithMatch(/No suggestions found for/);
  });

  it('should handle final request finish_reason !== stop', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    let callCount = 0;
    azureOpenAIClient.fetchChatCompletion.callsFake(async () => {
      callCount += 1;
      // Headers succeed
      if (callCount <= 2) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            },
            finish_reason: 'stop',
          }],
        };
      }
      // Batches succeed (4 batches per link = 8 total for 2 links)
      if (callCount <= 10 && callCount >= 3) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            },
            finish_reason: 'stop',
          }],
        };
      }
      // Final request for broken1: return finish_reason: 'length'
      if (callCount === 11) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Final' }),
            },
            finish_reason: 'length', // This triggers line 181 condition
          }],
        };
      }
      // Final request for broken2: also return finish_reason: 'length'
      if (callCount === 12) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Final' }),
            },
            finish_reason: 'length',
          }],
        };
      }
      // Default
      return {
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
          },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(result).to.have.lengthOf(2);
    // When final response has finish_reason !== 'stop', line 182 logs error
    expect(context.log.error).to.have.been.calledWithMatch(/No final suggestions found for/);
  });

  it('should handle empty batch URLs', async () => {
    class EmptySliceArray extends Array {
      // eslint-disable-next-line class-methods-use-this
      slice() {
        return [];
      }
    }

    const customSiteData = new EmptySliceArray('https://example.com/page1');

    const mockedModule = await esmock('../../../src/internal-links/suggestions-generator.js', {
      '../../../src/support/utils.js': {
        getScrapedDataForSiteId: sandbox.stub().resolves({
          siteData: customSiteData,
          headerLinks: ['https://example.com/home'],
        }),
      },
      '../../../src/internal-links/subpath-filter.js': {
        filterByAuditScope: (data) => data,
        extractPathPrefix: () => null,
        isWithinAuditScope: () => true,
      },
    });

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await mockedModule.generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(result).to.be.an('array');
    expect(context.log.warn).to.have.been.calledWithMatch(/No valid URLs in batch for/);
  });

  it('should handle header suggestions finish_reason !== stop', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    let callCount = 0;
    azureOpenAIClient.fetchChatCompletion.callsFake(async () => {
      callCount += 1;
      // Header for broken1: return finish_reason: 'length'
      if (callCount === 1) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'] }),
              aiRationale: 'Rationale',
            },
            finish_reason: 'length', // This triggers header suggestion error path
          }],
        };
      }
      // All other requests succeed
      return {
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(result).to.have.lengthOf(2);
    expect(context.log.error).to.have.been.calledWithMatch(/No header suggestions for/);
  });

  it('should handle failed prompt loading', async () => {
    // Test when getPrompt returns null
    const { filterByAuditScope, extractPathPrefix, isWithinAuditScope } = await import('../../../src/internal-links/subpath-filter.js');

    const mockedModule = await esmock('../../../src/internal-links/suggestions-generator.js', {
      '../../../src/support/utils.js': {
        getScrapedDataForSiteId: sandbox.stub().resolves({
          siteData: ['https://example.com/page1'],
          headerLinks: ['https://example.com/home'],
        }),
      },
      '../../../src/internal-links/subpath-filter.js': {
        filterByAuditScope,
        extractPathPrefix,
        isWithinAuditScope,
      },
      '@adobe/spacecat-shared-utils': {
        getPrompt: sandbox.stub().resolves(null), // Simulate prompt loading failure
        isNonEmptyArray: (arr) => Array.isArray(arr) && arr.length > 0,
      },
    });

    azureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });

    const result = await mockedModule.generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    // Should handle prompt loading failure gracefully
    expect(result).to.be.an('array');
    expect(context.log.error).to.have.been.calledWithMatch(/Failed to load prompt for/);
  });

  it('should handle empty response content', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    let callCount = 0;
    azureOpenAIClient.fetchChatCompletion.callsFake(async () => {
      callCount += 1;
      // Headers succeed
      if (callCount <= 2) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            },
            finish_reason: 'stop',
          }],
        };
      }
      // First batch: return empty content
      if (callCount === 3) {
        return {
          choices: [{
            message: {
              content: '   ', // Empty/whitespace content
            },
            finish_reason: 'stop',
          }],
        };
      }
      // Other batches succeed
      return {
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
          },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(result).to.have.lengthOf(2);
    expect(context.log.error).to.have.been.calledWithMatch(/Empty response content for/);
  });

  it('should handle final response with no choices', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);

    let callCount = 0;
    azureOpenAIClient.fetchChatCompletion.callsFake(async () => {
      callCount += 1;
      // Headers succeed
      if (callCount <= 2) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            },
            finish_reason: 'stop',
          }],
        };
      }
      // Batches succeed (4 batches per link = 8 total for 2 links)
      if (callCount <= 10 && callCount >= 3) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            },
            finish_reason: 'stop',
          }],
        };
      }
      // Final request for broken1: return empty choices
      if (callCount === 11) {
        return {
          choices: [],
        };
      }
      // Final request for broken2: also return empty choices
      if (callCount === 12) {
        return {
          choices: [],
        };
      }
      // Default
      return {
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Final' }),
          },
          finish_reason: 'stop',
        }],
      };
    });

    const result = await generateSuggestionData('https://example.com', brokenInternalLinksData, context, site);

    expect(result).to.have.lengthOf(2);
    expect(context.log.error).to.have.been.calledWithMatch(/Final suggestion error for/);
  });
});

describe('syncBrokenInternalLinksSuggestions', () => {
  let testSandbox;
  let testContext;
  let testOpportunity;
  let mockSyncSuggestions;
  let syncBrokenInternalLinksSuggestions;

  beforeEach(async () => {
    testSandbox = sinon.createSandbox();
    testContext = new MockContextBuilder()
      .withSandbox(testSandbox)
      .withOverrides({
        env: {},
      })
      .build();

    testOpportunity = {
      getId: () => 'oppty-id-1',
      addSuggestions: testSandbox.stub().resolves({
        createdItems: [],
        errorItems: [],
      }),
    };

    // Mock syncSuggestions using esmock
    mockSyncSuggestions = testSandbox.stub().resolves();
    const mockedModule = await esmock('../../../src/internal-links/suggestions-generator.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
    });
    syncBrokenInternalLinksSuggestions = mockedModule.syncBrokenInternalLinksSuggestions;
  });

  afterEach(() => {
    testSandbox.restore();
  });

  it('should call syncSuggestions with correct parameters', async () => {
    const brokenInternalLinks = [
      {
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        trafficDomain: 100,
        title: 'Test Title',
        urlsSuggested: ['https://example.com/suggested1'],
        aiRationale: 'Test rationale',
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    // Verify syncSuggestions was called with correct parameters
    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    expect(callArgs.opportunity).to.equal(testOpportunity);
    expect(callArgs.newData).to.deep.equal(brokenInternalLinks);
    expect(callArgs.context).to.equal(testContext);
    expect(callArgs.statusToSetForOutdated).to.equal(SuggestionDataAccess.STATUSES.NEW);
    expect(callArgs.buildKey(brokenInternalLinks[0])).to.equal('https://example.com/from1-https://example.com/to1-link');


    const mappedSuggestion = callArgs.mapNewSuggestion(brokenInternalLinks[0]);
    expect(mappedSuggestion).to.deep.equal({
      opportunityId: 'oppty-id-1',
      type: 'CONTENT_UPDATE',
      rank: 100,
      data: {
        title: 'Test Title',
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        itemType: 'link',
        priority: 'high',
        urlsSuggested: ['https://example.com/suggested1'],
        aiRationale: 'Test rationale',
        trafficDomain: 100,
      },
    });
  });

  it('should handle assets in mapNewSuggestion', async () => {
    const brokenAssets = [
      {
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken.png',
        trafficDomain: 50,
        itemType: 'image',
        title: 'Broken Image',
      },
      {
        urlFrom: 'https://example.com/page2',
        urlTo: 'https://example.com/broken.css',
        trafficDomain: 30,
        itemType: 'css',
        title: 'Broken CSS',
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks: brokenAssets,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    expect(mockSyncSuggestions).to.have.been.calledOnce;
    const callArgs = mockSyncSuggestions.getCall(0).args[0];

    const imageSuggestion = callArgs.mapNewSuggestion(brokenAssets[0]);
    expect(imageSuggestion).to.deep.equal({
      opportunityId: 'oppty-id-1',
      type: 'CONTENT_UPDATE',
      rank: 50,
      data: {
        title: 'Broken Image',
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken.png',
        itemType: 'image',
        priority: 'high',
        urlsSuggested: [],
        aiRationale: '',
        trafficDomain: 50,
      },
    });

    const cssSuggestion = callArgs.mapNewSuggestion(brokenAssets[1]);
    expect(cssSuggestion.type).to.equal('CONTENT_UPDATE');
    expect(cssSuggestion.data.itemType).to.equal('css');
    expect(cssSuggestion.data.priority).to.equal('high');
  });

  it('should handle empty arrays in mapNewSuggestion', async () => {
    const brokenInternalLinks = [
      {
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        trafficDomain: 100,
        // Missing urlsSuggested and aiRationale - should use defaults
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    const mappedSuggestion = callArgs.mapNewSuggestion(brokenInternalLinks[0]);

    // Should use default empty array and empty string
    expect(mappedSuggestion.data.urlsSuggested).to.deep.equal([]);
    expect(mappedSuggestion.data.aiRationale).to.equal('');
  });

  it('should use trafficDomain 1 (never 0) when entry.trafficDomain is null, undefined, or 0', async () => {
    const brokenInternalLinks = [
      { urlFrom: 'https://example.com/from1', urlTo: 'https://example.com/to1' },
      { urlFrom: 'https://example.com/from2', urlTo: 'https://example.com/to2', trafficDomain: null },
      { urlFrom: 'https://example.com/from3', urlTo: 'https://example.com/to3', trafficDomain: 0 },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    const noTraffic = callArgs.mapNewSuggestion(brokenInternalLinks[0]);
    const nullTraffic = callArgs.mapNewSuggestion(brokenInternalLinks[1]);
    const zeroTraffic = callArgs.mapNewSuggestion(brokenInternalLinks[2]);

    expect(noTraffic.rank).to.equal(1);
    expect(noTraffic.data.trafficDomain).to.equal(1);
    expect(nullTraffic.rank).to.equal(1);
    expect(nullTraffic.data.trafficDomain).to.equal(1);
    expect(zeroTraffic.rank).to.equal(1);
    expect(zeroTraffic.data.trafficDomain).to.equal(1);
  });

  it('should preserve urlEdited when isEdited is true', async () => {
    const brokenInternalLinks = [
      {
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        trafficDomain: 100,
        urlsSuggested: ['https://example.com/suggested1'],
        aiRationale: 'Test rationale',
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    const mergeDataFn = callArgs.mergeDataFunction;
    expect(mergeDataFn).to.be.a('function');

    // Test that urlEdited is preserved when isEdited is true
    const existingData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      title: 'Old Title',
      trafficDomain: 50,
      urlEdited: 'https://example.com/user-fixed-url',
      isEdited: true,
      urlsSuggested: ['https://example.com/old-suggested'],
    };

    const newData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      title: 'New Title',
      trafficDomain: 100,
      urlsSuggested: ['https://example.com/new-suggested'],
      aiRationale: 'New rationale',
    };

    const result = mergeDataFn(existingData, newData);

    expect(result.urlEdited).to.equal('https://example.com/user-fixed-url');
    expect(result.isEdited).to.equal(true);
    expect(result.title).to.equal('New Title');
    expect(result.trafficDomain).to.equal(100);
    expect(result.urlsSuggested).to.deep.equal(['https://example.com/new-suggested']);
  });

  it('should preserve urlEdited when isEdited is false (AI selection)', async () => {
    const brokenInternalLinks = [
      {
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        trafficDomain: 100,
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    const mergeDataFn = callArgs.mergeDataFunction;

    // Test that urlEdited IS preserved when isEdited is false (user selected AI suggestion)
    const existingData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      urlEdited: 'https://example.com/old-edited-url',
      isEdited: false,
    };

    const newData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      title: 'New Title',
    };

    const result = mergeDataFn(existingData, newData);

    // urlEdited should be preserved even when isEdited is false
    expect(result.urlEdited).to.equal('https://example.com/old-edited-url');
    expect(result.isEdited).to.equal(false);
    expect(result.title).to.equal('New Title');
  });

  it('should not preserve urlEdited when urlEdited is undefined', async () => {
    const brokenInternalLinks = [
      {
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        trafficDomain: 100,
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    const mergeDataFn = callArgs.mergeDataFunction;

    // Test that urlEdited is NOT preserved when it's undefined
    const existingData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      isEdited: true,
      // urlEdited is undefined
    };

    const newData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      title: 'New Title',
    };

    const result = mergeDataFn(existingData, newData);

    expect(result.urlEdited).to.be.undefined;
    expect(result.title).to.equal('New Title');
  });

  it('should handle when isEdited is null', async () => {
    const brokenInternalLinks = [
      {
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        trafficDomain: 100,
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    const mergeDataFn = callArgs.mergeDataFunction;

    // Test with null isEdited
    const existingData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      urlEdited: 'https://example.com/edited-url',
      isEdited: null,
    };

    const newData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      title: 'New Title',
    };

    const result = mergeDataFn(existingData, newData);

    expect(result.urlEdited).to.be.undefined;
    expect(result.title).to.equal('New Title');
  });

  it('should handle when urlEdited is null', async () => {
    const brokenInternalLinks = [
      {
        urlFrom: 'https://example.com/from1',
        urlTo: 'https://example.com/to1',
        trafficDomain: 100,
      },
    ];

    await syncBrokenInternalLinksSuggestions({
      opportunity: testOpportunity,
      brokenInternalLinks,
      context: testContext,
      opportunityId: 'oppty-id-1',
    });

    const callArgs = mockSyncSuggestions.getCall(0).args[0];
    const mergeDataFn = callArgs.mergeDataFunction;

    // Test with null urlEdited but true isEdited
    const existingData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      urlEdited: null,
      isEdited: true,
    };

    const newData = {
      urlFrom: 'https://example.com/from1',
      urlTo: 'https://example.com/to1',
      title: 'New Title',
    };

    const result = mergeDataFn(existingData, newData);

    // Should not preserve null urlEdited
    expect(result.urlEdited).to.be.undefined;
    expect(result.title).to.equal('New Title');
  });
});
