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
import sinon from 'sinon';
import esmock from 'esmock';

import { load as cheerioLoad } from 'cheerio';
import jsBeautify from 'js-beautify';
import GoogleClient from '@adobe/spacecat-shared-google-client';

import {
  cleanupStructuredDataMarkup,
  getIssuesFromGSC,
  getIssuesFromScraper,
  deduplicateIssues,
  getWrongMarkup,
  generateErrorMarkupForIssue,
  generateFirefallSuggestion,
  includeIssue,
} from '../../../src/structured-data/lib.js';
import { MockContextBuilder } from '../../shared.js';

import gscExample1 from '../../fixtures/structured-data/gsc-example1.json' with { type: 'json' };
import gscExample2 from '../../fixtures/structured-data/gsc-example2.json' with { type: 'json' };
import gscExample4 from '../../fixtures/structured-data/gsc-example4.json' with { type: 'json' };
import gscExample5 from '../../fixtures/structured-data/gsc-example5.json' with { type: 'json' };
import gscExample6 from '../../fixtures/structured-data/gsc-example6.json' with { type: 'json' };

use(sinonChai);
const sandbox = sinon.createSandbox();

const createS3ObjectStub = (object) => ({
  ContentType: 'application/json',
  Body: {
    transformToString: sinon.stub().returns(JSON.stringify(object)),
  },
});

describe('Structured Data Libs', () => {
  const message = {
    type: 'structured-data',
    url: 'https://www.example.com',
  };

  describe('cleanupStructuredDataMarkup', () => {
    it('removes all comments', () => {
      const $ = cheerioLoad('<div><!-- Comment --><span itemprop="name">Hello</span></div>');
      const cleanedup = cleanupStructuredDataMarkup($);
      expect(jsBeautify.html(cleanedup)).to.equal('<span itemprop="name">Hello</span>');
    });

    it('removes all non-allowed attributes', () => {
      const $ = cheerioLoad(`<div>
        <ul class="list" itemtype="http://schema.org/BreadcrumbList">
          <li class="cmp-breadcrumb__item" itemprop="itemListElement" itemscope="" itemtype="http://schema.org/ListItem">
            <a href="https://www.chocolateworld.com/home.html" aria-label="Home" class="cmp-breadcrumb__item-link" itemprop="item">
              <span itemprop="name">Home</span>
            </a>
            <meta itemprop="position" content="1">
          </li>
        </ul>
      </div>`);
      const cleanedup = cleanupStructuredDataMarkup($);
      expect(jsBeautify.html(cleanedup, { indent_size: 2 })).to.equal(`<ul itemtype="http://schema.org/BreadcrumbList">
  <li itemprop="itemListElement" itemtype="http://schema.org/ListItem">
    <a href="https://www.chocolateworld.com/home.html" itemprop="item">
      <span itemprop="name">Home</span>
    </a>
    <meta itemprop="position" content="1">
  </li>
</ul>`);
    });

    it('removes all tags without attributes', () => {
      const $ = cheerioLoad(`<div>
        <ul>
          <li>
            <div>
              <meta itemprop="position" content="1">
              <svg>
                <polygon />
              </svg>
            </div>
          </li>
        </ul>
      </div>`);
      const cleanedup = cleanupStructuredDataMarkup($);
      expect(jsBeautify.html(cleanedup)).to.equal('<meta itemprop="position" content="1">');
    });
  });

  describe('getIssuesFromGSC', () => {
    let context;

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            warn: sinon.spy(),
            error: sinon.stub(),
            debug: sinon.spy(),
          },
          site: {
            getId: sinon.stub().returns('site-123'),
          },
        })
        .build(message);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('returns an empty array if Google client cannot be created', async () => {
      sandbox.stub(GoogleClient, 'createFrom').throws(new Error('No secrets found'));

      const result = await getIssuesFromGSC('https://example.com', context, []);
      expect(result).to.deep.equal([]);
      expect(context.log.warn.calledOnce).to.be.true;
    });

    it('gets results from Google client without rich results', async () => {
      const googleClientStub = {
        urlInspect: sinon.stub().resolves(gscExample4),
      };
      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);

      const result = await getIssuesFromGSC('https://example.com', context, [{ url: 'https://example.com' }]);
      expect(result).to.deep.equal([]);
      expect(context.log.warn.called).to.be.false;
      expect(context.log.error.called).to.be.false;
    });

    it('it skips results without entity mapping', async () => {
      const googleClientStub = {
        urlInspect: sinon.stub().resolves(gscExample6),
      };
      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);

      const result = await getIssuesFromGSC('https://example.com', context, [{ url: 'https://example.com' }]);
      expect(result).to.deep.equal([]);
      expect(context.log.warn).to.be.calledWith('SDA: Skipping GSC issue, because cannot map GSC type "Unsupported snippets" to schema.org type.');
    });

    it('skips issues with severity lower than ERROR', async () => {
      const googleClientStub = {
        urlInspect: sinon.stub().resolves(gscExample2),
      };
      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);

      const result = await getIssuesFromGSC('https://example.com', context, [{ url: 'https://example.com' }]);
      expect(result).to.deep.equal([]);
    });

    it('returns rich results issues', async () => {
      const googleClientStub = {
        urlInspect: sinon.stub().resolves(gscExample1),
      };
      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);

      const result = await getIssuesFromGSC('https://example.com', context, [{ url: 'https://example.com/product/1' }]);
      expect(result).to.deep.equal([{
        dataFormat: 'jsonld',
        errors: [],
        issueMessage: 'Missing field "name"',
        pageUrl: 'https://example.com/product/1',
        rootType: 'Product',
        severity: 'ERROR',
      }]);
    });

    it('deduplicates issues', async () => {
      const googleClientStub = {
        urlInspect: sinon.stub().resolves(gscExample5),
      };
      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);

      const result = await getIssuesFromGSC('https://example.com', context, [{ url: 'https://example.com/product/1' }]);
      expect(result).to.deep.equal([{
        dataFormat: 'jsonld',
        errors: [],
        issueMessage: 'Missing field "itemReviewed"',
        pageUrl: 'https://example.com/product/1',
        rootType: 'AggregateRating',
        severity: 'ERROR',
      },
      {
        dataFormat: 'jsonld',
        errors: [],
        issueMessage: 'Missing field "author"',
        pageUrl: 'https://example.com/product/1',
        rootType: 'AggregateRating',
        severity: 'ERROR',
      },
      {
        dataFormat: 'jsonld',
        errors: [],
        issueMessage: 'Missing field "name"',
        pageUrl: 'https://example.com/product/1',
        rootType: 'Product',
        severity: 'ERROR',
      }]);
    });

    it('fails to get inspection results from GSC', async () => {
      const googleClientStub = {
        urlInspect: sinon.stub().throws(new Error('Some error')),
      };
      sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);

      const result = await getIssuesFromGSC('https://example.com', context, [{ url: 'https://example.com/product/1' }]);
      expect(result).to.deep.equal([]);
      expect(context.log.error).to.be.calledWith('SDA: Failed to get inspection results from GSC for URL: https://example.com/product/1.');
    });
  });

  describe('deduplicateIssues', () => {
    let context;

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            warn: sinon.spy(),
            error: sinon.stub(),
            debug: sinon.spy(),
          },
        })
        .build(message);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('returns only gsc issues, if scraper issues are empty', () => {
      const gscIssues = [{ rootType: 'Product' }];
      const scraperIssues = [];

      const result = deduplicateIssues(context, gscIssues, scraperIssues);
      expect(result).to.deep.equal(gscIssues);
    });

    it('only returns scraper issues, if gsc issues are empty', () => {
      const gscIssues = [];
      const scraperIssues = [{ rootType: 'Product' }];

      const result = deduplicateIssues(context, gscIssues, scraperIssues);
      expect(result).to.deep.equal(scraperIssues);
    });

    it('uses both issue types, if scraper issues and gsc issues are available', () => {
      const gscIssues = [{ rootType: 'Product' }];
      const scraperIssues = [{ rootType: 'BreadcrumbList' }];

      const result = deduplicateIssues(context, gscIssues, scraperIssues);
      expect(result).to.deep.equal([{
        rootType: 'BreadcrumbList',
      },
      {
        rootType: 'Product',
      }]);
      expect(context.log.warn).to.be.calledWith('SDA: GSC issue for type Product was not found by structured data parser.');
    });
  });

  describe('getIssuesFromScraper', () => {
    let context;
    let s3ClientStub;

    beforeEach(() => {
      s3ClientStub = {
        send: sinon.stub(),
        getObject: sinon.stub(),
      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            warn: sinon.spy(),
            error: sinon.stub(),
            debug: sinon.spy(),
          },
          s3Client: s3ClientStub,
          site: {
            getId: () => '123',
            getDeliveryType: sinon.stub().returns('other'),
          },
        })
        .build(message);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('cannot find a scrape for path', async () => {
      s3ClientStub.send.rejects(new Error('Failed to fetch S3 object'));
      const scrapeCache = new Map();
      const result = await getIssuesFromScraper(context, [{ url: 'https://example.com/product/1' }], scrapeCache);

      expect(result).to.deep.equal([]);
      expect(context.log.error).to.be.calledWith('SDA: Could not find scrape for /product/1. Make sure that scrape-top-pages did run.');
    });

    it('skips scrapes in the old format', async () => {
      s3ClientStub.send.resolves(createS3ObjectStub({
        scrapeResult: {
          structuredData: [{
            '@context': 'https://schema.org',
            '@type': 'Product',
          }],
        },
      }));

      const scrapeCache = new Map();
      const result = await getIssuesFromScraper(context, [{ url: 'https://example.com/product/1' }], scrapeCache);

      expect(result).to.deep.equal([]);
      expect(context.log.error.called).to.be.false;
    });

    it('uses the scrape cache', async () => {
      const scrapeCache = new Map();
      scrapeCache.set('/product/1', {
        scrapeResult: {
          structuredData: [{
            '@context': 'https://schema.org',
            '@type': 'Product',
          }],
        },
      });

      await getIssuesFromScraper(context, [{ url: 'https://example.com/product/1' }], scrapeCache);
      expect(s3ClientStub.send.called).to.be.false;
    });

    it('returns issues from the scraper', async () => {
      s3ClientStub.send.resolves(createS3ObjectStub({
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
      }));

      const scrapeCache = new Map();
      const result = await getIssuesFromScraper(context, [{ url: 'https://example.com/product/1' }], scrapeCache);

      expect(result).to.have.lengthOf(1);
    });

    it('deduplicates issues', async () => {
      s3ClientStub.send.resolves(createS3ObjectStub({
        scrapeResult: {
          structuredData: {
            jsonld: {
              BreadcrumbList: [
                {
                  itemListElement: [
                    {
                      position: 1,
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
      }));

      const scrapeCache = new Map();
      const result = await getIssuesFromScraper(context, [{ url: 'https://example.com/product/1' }], scrapeCache);

      expect(result).to.have.lengthOf(1);
    });

    it('strips trailing slash from URL', async () => {
      const scrapeCache = new Map();
      await getIssuesFromScraper(context, [{ url: 'https://example.com/product/1/' }], scrapeCache);
      expect(s3ClientStub.send.calledOnce).to.be.true;
      expect(s3ClientStub.send.args[0][0].input).to.deep.equal({
        Bucket: 'test-bucket', Key: 'scrapes/123/product/1/scrape.json',
      });
    });

    it('does not throw an error if the validation fails', async () => {
      // Create stubs for the StructuredDataValidator
      const StructuredDataValidatorStub = sinon.stub().returns({
        validate: sinon.stub().rejects(new Error('Validation failed')),
      });

      // Mock the module using esmock
      const mockedLib = await esmock('../../../src/structured-data/lib.js', {
        '@adobe/structured-data-validator': {
          default: StructuredDataValidatorStub,
        },
      });

      s3ClientStub.send.resolves(createS3ObjectStub({
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
      }));

      const scrapeCache = new Map();
      const result = await mockedLib.getIssuesFromScraper(context, [{ url: 'https://example.com/product/1' }], scrapeCache);

      expect(result).to.deep.equal([]);
      expect(context.log.error).to.be.calledWith('SDA: Failed to validate structured data for https://example.com/product/1.');
    });
  });

  describe('getWrongMarkup', () => {
    let context;

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            warn: sinon.spy(),
            error: sinon.stub(),
            debug: sinon.spy(),
          },
        })
        .build(message);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('returns null if structured data is not found in the scrape', () => {
      const result = getWrongMarkup(context, { pageUrl: 'https://www.example.com' }, { scrapeResult: {} });
      expect(result).to.be.null;
      expect(context.log.error).to.be.calledWith('SDA: No structured data found in scrape result for URL https://www.example.com');
    });

    it('uses the source attribute if available', () => {
      const result = getWrongMarkup(context, { pageUrl: 'https://www.example.com', source: '{ wrong: "markup" }' }, { scrapeResult: { structuredData: { jsonld: [] } } });
      expect(result).to.equal('{ wrong: "markup" }');
    });

    it('find the wrong markup in the first level of old scraper format', () => {
      const scrapeResult = {
        scrapeResult: {
          structuredData: [
            {
              '@context': 'https://schema.org',
              '@type': 'Product',
            },
          ],
        },
      };

      const result = getWrongMarkup(context, { pageUrl: 'https://www.example.com', rootType: 'Product' }, scrapeResult);
      expect(result).to.deep.equal({
        '@context': 'https://schema.org',
        '@type': 'Product',
      });
    });

    it('find the wrong markup in the second level of old scraper format', () => {
      const scrapeResult = {
        scrapeResult: {
          structuredData: [
            {
              '@context': 'https://schema.org',
              '@type': 'Product',
              review: {
                '@type': 'Review',
              },
            },
          ],
        },
      };

      const result = getWrongMarkup(context, { pageUrl: 'https://www.example.com', rootType: 'Review' }, scrapeResult);
      expect(result).to.deep.equal({
        '@type': 'Review',
      });
    });

    it('find the wrong markup in the new scraper format', () => {
      const scrapeResult = {
        scrapeResult: {
          structuredData: {
            jsonld: {
              BreadcrumbList: [
                {
                  '@type': 'BreadcrumbList',
                  '@location': '1690,2640',
                },
              ],
            },
          },
        },
      };

      const result = getWrongMarkup(context, { pageUrl: 'https://www.example.com', dataFormat: 'jsonld', rootType: 'BreadcrumbList' }, scrapeResult);
      expect(result).to.deep.equal({
        '@type': 'BreadcrumbList',
        '@location': '1690,2640',
      });
    });

    it('returns null for invalid data format', () => {
      const scrapeResult = {
        scrapeResult: {
          structuredData: {
            jsonld: {
              BreadcrumbList: [
                {
                  '@type': 'BreadcrumbList',
                  '@location': '1690,2640',
                },
              ],
            },
          },
        },
      };

      const result = getWrongMarkup(context, { pageUrl: 'https://www.example.com', dataFormat: 'invalid', rootType: 'BreadcrumbList' }, scrapeResult);
      expect(result).to.equal(null);
    });
  });

  describe('generateErrorMarkupForIssue', () => {
    it('returns error markup for jdonld issue with suggestion', () => {
      const issue = {
        dataFormat: 'jsonld',
        pageUrl: 'https://www.example.com',
        suggestion: {
          errorDescription: 'This is an error description',
          correctedMarkup: { some: 'markup' },
          aiRationale: 'Some reason',
          confidenceScore: '0.95',
        },
      };
      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Explanation
This is an error description

## Corrected Structured Data
\`\`\`json
{
    "some": "markup"
}
\`\`\`

## Rationale
Some reason

_Confidence score: 95%_`);
    });

    it('returns error markup for microdata issue with suggestion', () => {
      const issue = {
        dataFormat: 'microdata',
        pageUrl: 'https://www.example.com',
        suggestion: {
          errorDescription: 'This is an error description',
          correctedMarkup: '<div><p itemprop="name">Hello</p></div>',
          aiRationale: 'Some reason',
          confidenceScore: '0.95',
        },
      };
      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Explanation
This is an error description

## Corrected Structured Data
\`\`\`html
<div>
  <p itemprop="name">Hello</p>
</div>
\`\`\`

## Rationale
Some reason

_Confidence score: 95%_`);
    });

    it('returns error markup for invalid microdata markup with suggestion', () => {
      const issue = {
        dataFormat: 'microdata',
        pageUrl: 'https://www.example.com',
        suggestion: {
          errorDescription: 'This is an error description',
          correctedMarkup: '<div>invalid<div>html</html>',
          aiRationale: 'Some reason',
          confidenceScore: '0.95',
        },
      };
      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Explanation
This is an error description

## Corrected Structured Data
\`\`\`html
<div>invalid<div>html

    </html>
\`\`\`

## Rationale
Some reason

_Confidence score: 95%_`);
    });

    it('returns error markup for jsonld issue without suggestion and source', () => {
      const issue = {
        dataFormat: 'jsonld',
        pageUrl: 'https://www.example.com',
        rootType: 'Product',
        issueMessage: 'This is an error description',
      };
      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Detected for Product
This is an error description`);
    });

    it('returns error markup for jsonld issue without suggestion', () => {
      const issue = {
        dataFormat: 'jsonld',
        pageUrl: 'https://www.example.com',
        rootType: 'Product',
        issueMessage: 'This is an error description',
        source: '{ "name": "Product" }',
      };
      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Detected for Product
This is an error description
## Problematic Structured Data
\`\`\`json
{
    "name": "Product"
}
\`\`\``);
    });

    it('returns error markup for invalid jsonld issue without suggestion', () => {
      const issue = {
        dataFormat: 'jsonld',
        pageUrl: 'https://www.example.com',
        rootType: 'Product',
        source: '{ "invalid": "JSON"',
        issueMessage: 'This is an error description',
      };
      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Detected for Product
This is an error description
## Problematic Structured Data
\`\`\`json
{ "invalid": "JSON"
\`\`\``);
    });

    it('returns error markup for microdata issue without suggestion', () => {
      const issue = {
        dataFormat: 'microdata',
        pageUrl: 'https://www.example.com',
        rootType: 'Product',
        issueMessage: 'This is an error description',
        source: '<div itemtype="http://schema.org/Product"><p itemprop="name">Hello</p></div>',
      };

      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Detected for Product
This is an error description
## Problematic Structured Data
\`\`\`html
<div itemtype="http://schema.org/Product">
  <p itemprop="name">Hello</p>
</div>
\`\`\``);
    });

    it('returns error markup for invalid microdata issue without suggestion', () => {
      const issue = {
        dataFormat: 'microdata',
        pageUrl: 'https://www.example.com',
        rootType: 'Product',
        issueMessage: 'This is an error description',
        source: 134,
      };

      const result = generateErrorMarkupForIssue(issue);
      expect(result).to.equal(`## Affected page
 * https://www.example.com

## Issue Detected for Product
This is an error description
## Problematic Structured Data
\`\`\`html
134
\`\`\``);
    });
  });

  describe('generateFirefallSuggestion', () => {
    let context;

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            warn: sinon.spy(),
            error: sinon.stub(),
            debug: sinon.spy(),
          },
        })
        .build(message);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('throws if Firefall did not return any suggestions', async () => {
      const firefallClient = {
        fetchChatCompletion: sinon.stub().resolves({}),
      };
      const issue = {};
      const wrongMarkup = '';
      const scrapeResult = {
        scrapeResult: {
          rawBody: '<div>Hello</div>',
        },
      };

      await expect(generateFirefallSuggestion(context, firefallClient, {}, issue, wrongMarkup, scrapeResult)).to.be.rejectedWith('Firefall did not return any suggestions');
    });

    it('throws if response from Firefall is not a valid JSON', async () => {
      const firefallClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: 'some weird stuff',
              },
            },
          ],
        }),
      };
      const issue = {};
      const wrongMarkup = '';
      const scrapeResult = {
        scrapeResult: {
          rawBody: '<div>Hello</div>',
        },
      };

      await expect(generateFirefallSuggestion(context, firefallClient, {}, issue, wrongMarkup, scrapeResult)).to.be.rejectedWith('Could not parse Firefall response for issue');
    });

    it('throws if response from Firefall is not a valid JSON object', async () => {
      const firefallClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '[]',
              },
            },
          ],
        }),
      };
      const issue = {};
      const wrongMarkup = '';
      const scrapeResult = {
        scrapeResult: {
          rawBody: '<div>Hello</div>',
        },
      };

      await expect(generateFirefallSuggestion(context, firefallClient, {}, issue, wrongMarkup, scrapeResult)).to.be.rejectedWith('Received empty suggestion from Firefall');
    });

    it('throws if confidence score from Firefall is too low', async () => {
      const firefallClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '{ "confidenceScore": 0.1 }',
              },
            },
          ],
        }),
      };
      const issue = {};
      const wrongMarkup = '';
      const scrapeResult = {
        scrapeResult: {
          rawBody: '<div>Hello</div>',
        },
      };

      await expect(generateFirefallSuggestion(context, firefallClient, {}, issue, wrongMarkup, scrapeResult)).to.be.rejectedWith('Confidence score too low, skip suggestion');
    });

    it('returns a suggestion', async () => {
      const firefallClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '{ "confidenceScore": 0.9, "errorDescription": "This is an error description", "correctedMarkup": "<div>Hello</div>", "aiRationale": "Some reason" }',
              },
            },
          ],
        }),
      };
      const issue = {
        path: [],
      };
      const wrongMarkup = '';
      const scrapeResult = {
        scrapeResult: {
          rawBody: '<div>Hello</div>',
        },
      };

      const result = await generateFirefallSuggestion(
        context,
        firefallClient,
        {},
        issue,
        wrongMarkup,
        scrapeResult,
      );
      expect(result).to.deep.equal({
        confidenceScore: 0.9,
        errorDescription: 'This is an error description',
        correctedMarkup: '<div>Hello</div>',
        aiRationale: 'Some reason',
      });
    });
  });

  describe('includeIssue', () => {
    let context;
    const suppressionMessage = 'One of the following conditions needs to be met: Required attribute "creator" is missing or Required attribute "creditText" is missing or Required attribute "copyrightNotice" is missing or Required attribute "license" is missing';
    const Site = {
      DELIVERY_TYPES: {
        AEM_CS: 'aem_cs',
        AEM_AMS: 'aem_ams',
      },
    };

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            warn: sinon.spy(),
            error: sinon.stub(),
            debug: sinon.spy(),
          },
          site: {
            getDeliveryType: sinon.stub().returns('other'),
          },
        })
        .build(message);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('returns false for non-ERROR severity', () => {
      context.site.getDeliveryType = sinon.stub().returns('other');
      const issue = {
        severity: 'WARNING',
        rootType: 'ImageObject',
        issueMessage: 'some message',
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.false;
    });

    it('returns true for non-ImageObject type with ERROR severity', () => {
      context.site.getDeliveryType = sinon.stub().returns('other');
      const issue = {
        severity: 'ERROR',
        rootType: 'Product',
        issueMessage: 'some message',
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.true;
    });

    it('returns true for ImageObject when delivery type is not in specified customer types', () => {
      context.site.getDeliveryType = sinon.stub().returns('some-other-type');
      const issue = {
        severity: 'ERROR',
        rootType: 'ImageObject',
        issueMessage: suppressionMessage,
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.true;
      expect(context.log.warn).not.to.be.called;
    });

    it('returns true for ImageObject with non-matching message in AEM_CS', () => {
      context.site.getDeliveryType = sinon.stub().returns(Site.DELIVERY_TYPES.AEM_CS);
      const issue = {
        severity: 'ERROR',
        rootType: 'ImageObject',
        issueMessage: 'non-matching message',
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.true;
      expect(context.log.warn).not.to.be.called;
    });

    it('returns true for ImageObject with non-matching message in AEM_AMS', () => {
      context.site.getDeliveryType = sinon.stub().returns(Site.DELIVERY_TYPES.AEM_AMS);
      const issue = {
        severity: 'ERROR',
        rootType: 'ImageObject',
        issueMessage: 'non-matching message',
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.true;
      expect(context.log.warn).not.to.be.called;
    });

    it('excludes issue if severity is ERROR, rootType is ImageObject, delivery type is AEM_CS, and message matches suppression', () => {
      context.site.getDeliveryType = sinon.stub().returns(Site.DELIVERY_TYPES.AEM_CS);
      const issue = {
        severity: 'ERROR',
        rootType: 'ImageObject',
        issueMessage: suppressionMessage,
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.false;
      expect(context.log.warn).to.be.calledWith('SDA: Suppressing issue', suppressionMessage);
    });

    it('excludes issue if severity is ERROR, rootType is ImageObject, delivery type is AEM_AMS, and message matches suppression', () => {
      context.site.getDeliveryType = sinon.stub().returns(Site.DELIVERY_TYPES.AEM_AMS);
      const issue = {
        severity: 'ERROR',
        rootType: 'ImageObject',
        issueMessage: suppressionMessage,
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.false;
      expect(context.log.warn).to.be.calledWith('SDA: Suppressing issue', suppressionMessage);
    });

    it('includes issue if severity is ERROR, rootType is ImageObject, delivery type is AEM_CS, but message does not match suppression', () => {
      context.site.getDeliveryType = sinon.stub().returns(Site.DELIVERY_TYPES.AEM_CS);
      const issue = {
        severity: 'ERROR',
        rootType: 'ImageObject',
        issueMessage: 'Some other error',
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.true;
    });

    it('includes issue if severity is ERROR, rootType is ImageObject, delivery type is AEM_AMS, but message does not match suppression', () => {
      context.site.getDeliveryType = sinon.stub().returns(Site.DELIVERY_TYPES.AEM_AMS);
      const issue = {
        severity: 'ERROR',
        rootType: 'ImageObject',
        issueMessage: 'Some other error',
      };
      const result = includeIssue(context, issue);
      expect(result).to.be.true;
    });
  });
});
