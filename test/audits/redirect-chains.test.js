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
import nock from 'nock';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import {
  redirectsAuditRunner,
  getJsonData,
  processRedirectsFile,
  processEntriesInParallel,
  analyzeResults,
  getSuggestedFix,
  generateSuggestedFixes,
  generateOpportunities,
  filterIssuesToFitIntoSpace,
  AUDIT_LOGGING_NAME,
} from '../../src/redirect-chains/handler.js';
import {
  addWWW,
  ensureFullUrl,
  hasProtocol,
  is404page,
} from '../../src/redirect-chains/opportunity-utils.js';
import { MockContextBuilder } from '../shared.js';
import { createOpportunityData } from '../../src/redirect-chains/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../src/common/constants.js';

use(sinonChai);
use(chaiAsPromised);
const sandbox = sinon.createSandbox();

describe('Redirect Chains Audit', () => {
  let context;
  let handlerModule;
  let convertToOpportunityStub;
  let syncSuggestionsStub;
  const url = 'https://www.example.com';
  const message = {
    type: 'redirect-chains',
    url: 'site-id',
    auditContext: {},
  };

  // pre-sorted by the Source URLs (so we can get consistent results)
  const sampleRedirectsJson = {
    data: [
      {
        Source: '/another-old',
        Destination: '/another-new',
      },
      {
        Source: '/old-page',
        Destination: '/new-page',
      },
    ],
    total: 2,
  };

  beforeEach(async () => {
    context = new MockContextBuilder().withSandbox(sandbox).build(message);

    // Create the stubs
    convertToOpportunityStub = sandbox.stub().resolves({ getId: () => 'test-opportunity-id' });
    syncSuggestionsStub = sandbox.stub().resolves();

    // Mock the module using esmock
    handlerModule = await esmock('../../src/redirect-chains/handler.js', {
      '../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
      '../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
    });
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    sandbox.restore();
  });

  describe('URL Utilities', () => {
    describe('hasProtocol', () => {
      it('should return true for URLs with protocol', () => {
        expect(hasProtocol('https://example.com')).to.be.true;
        expect(hasProtocol('ftp://example.com')).to.be.true;
      });

      it('should return false for URLs without protocol', () => {
        expect(hasProtocol('example.com')).to.be.false;
        expect(hasProtocol('/path')).to.be.false;
      });

      it('should return false for invalid URLs', () => {
        expect(hasProtocol('not a url')).to.be.false;
      });
    });

    describe('is404page', () => {
      it('should return true for 404 page URLs', () => {
        expect(is404page('/404')).to.be.true;
        expect(is404page('/404/')).to.be.true;
        expect(is404page('/404.html')).to.be.true;
        expect(is404page('/404.htm')).to.be.true;
      });

      it('should return false for non-404 page URLs', () => {
        expect(is404page('/page')).to.be.false;
        expect(is404page('/error')).to.be.false;
        expect(is404page('/some/product/404/cleaner')).to.be.false;
        expect(is404page('https://www.visionwheel.com/wheel/15432/VisionOffRoad/404%20Brawl?finishID=1')).to.be.false;
      });
    });

    describe('addWWW', () => {
      it('should add www to domain without subdomain', () => {
        expect(addWWW('example.com')).to.equal('www.example.com');
        expect(addWWW('https://example.com')).to.equal('https://www.example.com');
      });

      it('should not add www to domain with subdomain', () => {
        expect(addWWW('sub.example.com')).to.equal('sub.example.com');
        expect(addWWW('https://sub.example.com')).to.equal('https://sub.example.com');
      });

      it('should not modify domain that already has www', () => {
        expect(addWWW('www.example.com')).to.equal('www.example.com');
        expect(addWWW('https://www.example.com')).to.equal('https://www.example.com');
      });

      it('should handle invalid URLs', () => {
        expect(addWWW('not a url')).to.equal('not a url'); // original string returned
      });
    });

    describe('ensureFullUrl', () => {
      it('should add protocol and www to domain', () => {
        expect(ensureFullUrl('example.com')).to.equal('https://www.example.com');
      });

      it('should add domain to relative path', () => {
        expect(ensureFullUrl('/path', 'example.com')).to.equal('https://www.example.com/path');
      });

      it('should not modify fully qualified URLs', () => {
        expect(ensureFullUrl('https://example.com/path')).to.equal('https://example.com/path');
      });

      it('should handle URLs with existing www', () => {
        expect(ensureFullUrl('www.example.com')).to.equal('https://www.example.com');
      });

      it('should handle domain ending with slash and path starting with slash', () => {
        expect(ensureFullUrl('/path', 'example.com/')).to.equal('https://www.example.com/path');
      });

      it('should handle domain ending with slash and path not starting with slash', () => {
        expect(ensureFullUrl('path', 'example.com/')).to.equal('https://www.example.com/path');
      });

      it('should handle domain not ending with slash and path not starting with slash', () => {
        expect(ensureFullUrl('path', 'example.com')).to.equal('https://www.example.com/path');
      });

      it('should handle domain not ending with slash and path starting with slash', () => {
        expect(ensureFullUrl('/path', 'example.com')).to.equal('https://www.example.com/path');
      });

      it('should handle domain with trailing slash and path with leading slash (avoid double slash)', () => {
        expect(ensureFullUrl('/path', 'https://example.com/')).to.equal('https://example.com/path');
      });

      it('should handle domain without trailing slash and path without leading slash (add slash)', () => {
        expect(ensureFullUrl('path', 'https://example.com')).to.equal('https://example.com/path');
      });
    });
  });

  describe('JSON Data Handling', () => {
    describe('getJsonData', () => {
      it('should fetch and parse JSON data successfully', async () => {
        nock(url)
          .get('/redirects.json')
          .reply(200, sampleRedirectsJson);

        const result = await getJsonData(`${url}/redirects.json`, context.log);
        expect(result).to.deep.equal(sampleRedirectsJson);
      });

      it('should handle 404 response', async () => {
        nock(url)
          .get('/redirects.json')
          .reply(404);

        const result = await getJsonData(`${url}/redirects.json`, context.log);
        expect(result).to.deep.equal([]);
      });

      it('should handle non-404 error response', async () => {
        nock(url)
          .get('/redirects.json')
          .reply(500);

        const result = await getJsonData(`${url}/redirects.json`, context.log);

        expect(result).to.deep.equal([]);
        expect(context.log.error.calledOnce).to.be.true;
        expect(context.log.error.firstCall.args[0]).to.include('Error trying to get');
        expect(context.log.error.firstCall.args[0]).to.include('HTTP code: 500');
      });

      it('should handle fetch errors', async () => {
        nock(url)
          .get('/redirects.json')
          .replyWithError('Network error');

        const result = await getJsonData(`${url}/redirects.json`, context.log);
        expect(result).to.deep.equal([]);
      });
    });

    describe('processRedirectsFile', () => {
      it('should process redirects file successfully', async () => {
        nock(url)
          .get('/redirects.json')
          .reply(200, sampleRedirectsJson);

        const result = await processRedirectsFile(url, context.log);
        expect(result).to.be.an('array');
        expect(result).to.have.lengthOf(2);
        expect(result[1]).to.have.property('origSrc', '/old-page');
        expect(result[1]).to.have.property('origDest', '/new-page');
      });

      it('should handle empty redirects file', async () => {
        nock(url)
          .get('/redirects.json')
          .reply(200, { data: [], total: 0 });

        const result = await processRedirectsFile(url, context.log);
        expect(result).to.be.an('array');
        expect(result).to.have.lengthOf(0);
      });

      it('should sort the Source URLs', async () => {
        const jsonUnsorted = {
          data: [
            { Source: '/c', Destination: '/page3' },
            { Source: '/b', Destination: '/page2' },
            { Source: '/a', Destination: '/page1' },
          ],
          total: 3,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonUnsorted);

        const result = await processRedirectsFile(url, context.log);
        expect(result).to.be.an('array');
        expect(result).to.have.lengthOf(3);
        expect(result[0]).to.have.property('origSrc', '/a');
        expect(result[1]).to.have.property('origSrc', '/b');
        expect(result[2]).to.have.property('origSrc', '/c');
      });

      it('should detect duplicate source URLs', async () => {
        const jsonWithDuplicates = {
          data: [
            { Source: '/duplicate', Destination: '/page1' },
            { Source: '/duplicate', Destination: '/page2' },
          ],
          total: 2,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithDuplicates);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].isDuplicateSrc).to.be.true;
        expect(result[0].ordinalDuplicate).to.equal(1);
      });

      it('should detect too qualified URLs', async () => {
        const jsonWithQualifiedUrls = {
          data: [
            { Source: `${url}/page`, Destination: `${url}/new` },
          ],
          total: 1,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithQualifiedUrls);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].tooQualified).to.be.true;
      });

      it('should handle lowercase params', async () => {
        const jsonWithQualifiedUrls = {
          data: [
            { source: '/old-page', destination: '/new-page' }, // lowercase params
          ],
          total: 1,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithQualifiedUrls);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].origSrc).to.equal('/old-page');
        expect(result[0].origDest).to.equal('/new-page');
      });

      it('should handle uppercase params', async () => {
        const jsonWithQualifiedUrls = {
          data: [
            { Source: '/old-page', Destination: '/new-page' }, // uppercase params
          ],
          total: 1,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithQualifiedUrls);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].origSrc).to.equal('/old-page');
        expect(result[0].origDest).to.equal('/new-page');
      });

      it('should handle missing source parameter', async () => {
        const jsonWithMissingSource = {
          data: [
            { Destination: '/new-page' }, // missing Source/source
          ],
          total: 1,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithMissingSource);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].origSrc).to.equal('');
        expect(result[0].origDest).to.equal('/new-page');
      });

      it('should handle missing destination parameter', async () => {
        const jsonWithMissingDestination = {
          data: [
            { Source: '/old-page' }, // missing Destination/destination
          ],
          total: 1,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithMissingDestination);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].origSrc).to.equal('/old-page');
        expect(result[0].origDest).to.equal('');
      });

      it('should handle both missing source and destination parameters', async () => {
        const jsonWithMissingBoth = {
          data: [
            { }, // missing both Source/source and Destination/destination
          ],
          total: 1,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithMissingBoth);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].origSrc).to.equal('');
        expect(result[0].origDest).to.equal('');
      });

      it('should detect same source and destination URLs', async () => {
        const jsonWithSameUrls = {
          data: [
            { Source: '/same', Destination: '/same' },
          ],
          total: 1,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithSameUrls);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].hasSameSrcDest).to.be.true;
      });

      it('should log a warning when number of entries does not match total count', async () => {
        const jsonWithMismatchedCount = {
          data: [
            { Source: '/page1', Destination: '/new1' },
            { Source: '/page2', Destination: '/new2' },
          ],
          total: 3, // Intentionally different from data length
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithMismatchedCount);

        nock(url)
          .get('/redirects.json?limit=3')
          .reply(200, jsonWithMismatchedCount);

        await processRedirectsFile(url, context.log);

        expect(context.log.warn.calledOnce).to.be.true;
        expect(context.log.warn.firstCall.args[0]).to.include('Expected 3 entries');
        expect(context.log.warn.firstCall.args[0]).to.include('but found only 2');
      });

      it('should detect too qualified URLs in the last entry', async () => {
        const jsonWithQualifiedLastEntry = {
          // this is pre-sorted by Source URL to ensure the last entry is the one we want to test
          data: [
            { Source: '/page1', Destination: '/new1' },
            { Source: `${url}/page2`, Destination: '/new2' },
          ],
          total: 2,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithQualifiedLastEntry);

        const result = await processRedirectsFile(url, context.log);
        expect(result[1].tooQualified).to.be.true;
        expect(result[1].origSrc).to.equal(`${url}/page2`);
      });

      it('should detect same source and destination URLs in the last entry', async () => {
        const jsonWithSameUrlsLastEntry = {
          // this is pre-sorted by Source URL to ensure the last entry is the one we want to test
          data: [
            { Source: '/page1', Destination: '/new1' },
            { Source: '/same', Destination: '/same' },
          ],
          total: 2,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithSameUrlsLastEntry);

        const result = await processRedirectsFile(url, context.log);
        expect(result[1].hasSameSrcDest).to.be.true;
        expect(result[1].origSrc).to.equal('/same');
        expect(result[1].origDest).to.equal('/same');
      });

      it('should handle both too qualified and same source/destination URLs in the last entry', async () => {
        const jsonWithBothIssuesLastEntry = {
          // this is pre-sorted by Source URL to ensure the last entry is the one we want to test
          data: [
            { Source: '/page1', Destination: '/new1' },
            { Source: `${url}/same`, Destination: `${url}/same` },
          ],
          total: 2,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithBothIssuesLastEntry);

        const result = await processRedirectsFile(url, context.log);
        expect(result[1].tooQualified).to.be.true;
        expect(result[1].hasSameSrcDest).to.be.true;
        expect(result[1].origSrc).to.equal(`${url}/same`);
        expect(result[1].origDest).to.equal(`${url}/same`);
      });

      it('should return empty array if second fetch for ?limit=... returns undefined', async () => {
        // the 'total' is intentionally different from data length
        nock(url)
          .get('/redirects.json')
          .reply(200, { data: [{ Source: '/a', Destination: '/b' }], total: 2 });

        nock(url)
          .get('/redirects.json?limit=2')
          .reply(200, undefined);

        const result = await processRedirectsFile(url, context.log);
        expect(result).to.be.an('array').that.is.empty;
      });

      it('should return empty array if second fetch for ?limit=... returns object without data property', async () => {
        // the 'total' is intentionally different from data length
        nock(url)
          .get('/redirects.json')
          .reply(200, { data: [{ Source: '/a', Destination: '/b' }], total: 2 });

        nock(url)
          .get('/redirects.json?limit=2')
          .reply(200, { notData: true });

        const result = await processRedirectsFile(url, context.log);
        expect(result).to.be.an('array').that.is.empty;
      });

      it('should return empty array if second fetch for ?limit=... returns object with empty data array', async () => {
        // the 'total' is intentionally different from data length
        nock(url)
          .get('/redirects.json')
          .reply(200, { data: [{ Source: '/a', Destination: '/b' }], total: 2 });

        nock(url)
          .get('/redirects.json?limit=2')
          .reply(200, { data: [] });

        const result = await processRedirectsFile(url, context.log);
        expect(result).to.be.an('array').that.is.empty;
      });

      it('should mark tooQualified and hasSameSrcDest for entries in the middle of the array', async () => {
        const redirectsJson = {
          data: [
            // pre-sorted by Source URL to ensure the middle entries are the ones we want to test
            { Source: '/a1', Destination: '/new1' }, // neither
            { Source: '/b1', Destination: '/b1' }, // hasSameSrcDest
            { Source: `${url}/c1`, Destination: '/new2' }, // tooQualified
            { Source: `${url}/d1`, Destination: `${url}/d1` }, // both: tooQualified and hasSameSrcDest
          ],
          total: 4,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, redirectsJson);

        const result = await processRedirectsFile(url, context.log);
        expect(result[0].tooQualified).to.be.false; // case 1: neither
        expect(result[0].hasSameSrcDest).to.be.false;
        expect(result[1].tooQualified).to.be.false; // case 2: hasSameSrcDest
        expect(result[1].hasSameSrcDest).to.be.true;
        expect(result[2].tooQualified).to.be.true; // case 3: tooQualified
        expect(result[2].hasSameSrcDest).to.be.false;
        expect(result[3].tooQualified).to.be.true; // case 4: both
        expect(result[3].hasSameSrcDest).to.be.true;
      });

      it('should correctly mark the number of duplicate entries', async () => {
        const jsonWithMultipleEntries = {
          // pre-sorted by Source URL to ensure the first entry is the one we want to test
          data: [
            {
              Source: '/page1', // 1st duplicate source with 'page1'
              Destination: '/new1',
            },
            {
              Source: '/page1',
              Destination: '/new2',
            },
            {
              Source: '/page2', // 1st duplicate source with 'page2'
              Destination: '/new3',
            },
            {
              Source: '/page2', // 2nd duplicate source with 'page2'
              Destination: '/new4',
            },
            {
              Source: '/page2',
              Destination: '/new5',
            },
          ],
          total: 5,
        };

        nock(url)
          .get('/redirects.json')
          .reply(200, jsonWithMultipleEntries);

        const result = await processRedirectsFile(url, context.log);

        // Verify the entries are processed correctly
        expect(result[0].referencedBy).to.equal(`${url}/redirects.json`);
        expect(result[0].origSrc).to.equal('/page1');
        expect(result[0].origDest).to.equal('/new1');
        expect(result[1].referencedBy).to.equal(`${url}/redirects.json`);
        expect(result[1].origSrc).to.equal('/page1');
        expect(result[1].origDest).to.equal('/new2');
        expect(result[2].referencedBy).to.equal(`${url}/redirects.json`);
        expect(result[2].origSrc).to.equal('/page2');
        expect(result[2].origDest).to.equal('/new3');
        expect(result[3].referencedBy).to.equal(`${url}/redirects.json`);
        expect(result[3].origSrc).to.equal('/page2');
        expect(result[3].origDest).to.equal('/new4');
        expect(result[4].referencedBy).to.equal(`${url}/redirects.json`);
        expect(result[4].origSrc).to.equal('/page2');
        expect(result[4].origDest).to.equal('/new5');

        // Verify that duplicate sources are marked correctly
        expect(result[0].isDuplicateSrc).to.be.true;
        expect(result[0].ordinalDuplicate).to.equal(1); // 1st duplicate of 'page1'
        expect(result[1].isDuplicateSrc).to.be.false;
        expect(result[1].ordinalDuplicate).to.equal(0);
        expect(result[2].isDuplicateSrc).to.be.true;
        expect(result[2].ordinalDuplicate).to.equal(1); // 1st duplicate of 'page2'
        expect(result[3].isDuplicateSrc).to.be.true;
        expect(result[3].ordinalDuplicate).to.equal(2); // 2nd duplicate of 'page2'
        expect(result[4].isDuplicateSrc).to.be.false;
        expect(result[4].ordinalDuplicate).to.equal(0);
      });
    });
  });

  describe('Redirect Processing', () => {
    describe('processEntriesInParallel', () => {
      it('should process entries in parallel successfully', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/old-page',
            origDest: '/new-page',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // need to be able to call each twice:
        //   1st for when we automatically follow all redirects, and 2nd for the manual check
        nock(url)
          .head('/old-page')
          .times(2)
          .reply(301, '', { location: `${url}/new-page` });

        nock(url)
          .head('/new-page')
          .times(2)
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result).to.be.an('array');
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('redirected', true);
        expect(result[0]).to.have.property('redirectCount', 1);
      });

      it('should handle errors during processing', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/error-page',
            origDest: '/new-page',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        nock(url)
          .head('/error-page')
          .replyWithError('Network error');

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result[0]).to.have.property('status', 418);
        expect(result[0]).to.have.property('error', 'Network error');
      });

      it('should handle network errors in countRedirects function', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/error-page',
            origDest: '/new-page',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First sequence: Initial check succeeds, but has redirects, so we automatically follow
        nock(url)
          .head('/error-page')
          .reply(301, '', { location: '/new-page' });

        nock(url)
          .head('/new-page')
          .reply(200);

        // Second sequence: Count redirects, which now fails (in real life, due to a network glitch)
        nock(url)
          .head('/error-page')
          .reply(301, '', { location: '/new-page' });

        nock(url)
          .head('/new-page')
          .replyWithError('Failed to count redirects');

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result[0]).to.have.property('status', 418);
        expect(result[0].error).to.include('Failed to count redirects');
        expect(result[0]).to.have.property('redirected', true);
      });

      it('should handle HTTP error responses', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/error-page',
            origDest: '/new-page',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request returns a 404
        nock(url)
          .head('/error-page')
          .reply(404);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result[0]).to.have.property('status', 404);
        expect(result[0].error).to.equal(`HTTP error 404 for ${url}/error-page`);
        expect(result[0]).to.have.property('redirected', false);
      });

      it('should skip redirect checks for duplicate source URLs', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/duplicate-page',
            origDest: '/new-page',
            isDuplicateSrc: true,
            ordinalDuplicate: 1,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // No nock setup needed since the request should be skipped

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result[0]).to.have.property('isDuplicateSrc', true);
        expect(result[0]).to.have.property('ordinalDuplicate', 1);
        expect(result[0]).to.have.property('error').that.includes('Duplicated source URL: /duplicate-page');
        expect(result[0]).to.have.property('redirected', false);
        expect(result[0]).to.have.property('redirectCount', 0);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', false);
        expect(result[0]).to.have.property('status', 200);
      });

      it('should use source URL as destination when destination is empty', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/some-page',
            origDest: '', // Empty destination
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        nock(url)
          .head('/some-page')
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('fullDest').to.equal(`${url}/some-page`);
        expect(result[0]).to.have.property('fullSrc').to.equal(`${url}/some-page`);
        expect(result[0]).to.have.property('fullFinal').to.equal(`${url}/some-page`);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', true);
        expect(result[0]).to.have.property('redirected', false);
      });

      it('should normalize URLs for comparison -- part 1 of 2', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/old-page',
            origDest: '/new-page', // no trailing slash
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request: old-page redirects to new-page
        nock(url)
          .head('/old-page')
          .times(2)
          .reply(301, '', { location: `${url}/new-page/` });

        // Second request: new-page with trailing slash (should match normalized URL)
        nock(url)
          .head('/new-page/')
          .times(2)
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result).to.be.an('array');
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('redirected', true);
        expect(result[0]).to.have.property('redirectCount', 1);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', true);
        expect(result[0].fullDest).to.equal(`${url}/new-page`);
        expect(result[0].fullFinal).to.equal(`${url}/new-page/`);
      });

      it('should normalize URLs for comparison -- part 2 of 2', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/old-page',
            origDest: '/new-page/', // with trailing slash
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request: old-page redirects to new-page
        nock(url)
          .head('/old-page')
          .times(2)
          .reply(301, '', { location: `${url}/new-page` });

        // Second request: new-page without a trailing slash (should match normalized URL)
        nock(url)
          .head('/new-page')
          .times(2)
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result).to.be.an('array');
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('redirected', true);
        expect(result[0]).to.have.property('redirectCount', 1);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', true);
        expect(result[0].fullDest).to.equal(`${url}/new-page/`);
        expect(result[0].fullFinal).to.equal(`${url}/new-page`);
      });

      it('should handle HTTP errors in countRedirects function', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/old-page',
            origDest: '/new-page',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request succeeds and indicates a redirect
        nock(url)
          .head('/old-page')
          .reply(301, '', { location: '/new-page' });

        // Second request succeeds
        nock(url)
          .head('/new-page')
          .reply(200);

        // Third request (during countRedirects) returns a 404
        nock(url)
          .head('/old-page')
          .reply(404);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result[0]).to.have.property('status', 404);
        expect(result[0]).to.have.property('redirected', true);
        expect(result[0]).to.have.property('redirectCount', 0);
        expect(result[0].error).to.equal(`HTTP error 404 for ${url}/old-page`);
      });

      it('should stop counting at maximum redirects (5)', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/page1',
            origDest: '/final-page',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // Initial sequence: we need at least 1 redirect to force the manual counting
        nock(url)
          .head('/page1')
          .reply(301, '', { location: '/page7' });

        nock(url)
          .head('/page7')
          .reply(200);

        //  Second sequence: count the actual number of redirects
        nock(url)
          .head('/page1')
          .reply(301, '', { location: '/page2' }); // 1st redirect

        nock(url)
          .head('/page2')
          .reply(301, '', { location: '/page3' }); // 2nd redirect

        nock(url)
          .head('/page3')
          .reply(301, '', { location: '/page4' }); // 3rd redirect

        nock(url)
          .head('/page4')
          .reply(301, '', { location: '/page5' }); // 4th redirect

        nock(url)
          .head('/page5')
          .reply(301, '', { location: '/page6' }); // 5th redirect

        nock(url)
          .head('/page6')
          .reply(301, '', { location: '/page7' }); // 6th redirect (should never be called)

        nock(url)
          .head('/page7')
          .reply(200); // This should never be called because we break at 5 redirects

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result[0]).to.have.property('redirected', true);
        expect(result[0]).to.have.property('redirectCount', 5);
        expect(result[0].redirectChain).to.include('/page1');
        expect(result[0].redirectChain).to.include('/page6');
        expect(result[0].redirectChain).to.not.include('/page7');
      });

      it('should handle URLs with different query parameters', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/old-page',
            origDest: '/new-page?param=value', // with 1 query parameter (for example)
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request: old-page redirects to new-page
        nock(url)
          .head('/old-page')
          .times(2)
          .reply(301, '', { location: '/new-page?param=value&extra=param' });

        // Second request: new-page with additional query parameter
        nock(url)
          .head('/new-page?param=value&extra=param')
          .times(2)
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result).to.be.an('array');
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('redirected', true);
        expect(result[0]).to.have.property('redirectCount', 1);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', false);
        expect(result[0].fullDest).to.equal(`${url}/new-page?param=value`);
        expect(result[0].fullFinal).to.equal(`${url}/new-page?param=value&extra=param`);
      });

      it('should handle source URL that redirects to itself (src-is-final scenario)', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/self-redirect',
            origDest: '/intended-destination',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request: self-redirect redirects back to itself
        nock(url)
          .head('/self-redirect')
          .times(2)
          .reply(301, '', { location: '/self-redirect' });

        // Second request: self-redirect (same as source)
        nock(url)
          .head('/self-redirect')
          .times(2)
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result).to.be.an('array');
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', false); // Doesn't match intended destination
        expect(result[0].fullSrc).to.equal(`${url}/self-redirect`);
        expect(result[0].fullDest).to.equal(`${url}/intended-destination`);
        expect(result[0].fullFinal).to.equal(`${url}/self-redirect`); // Same as source
      });

      it('should handle source URL that redirects to itself with trailing slash normalization', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/self-redirect/',
            origDest: '/intended-destination/',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request: self-redirect/ redirects back to itself
        nock(url)
          .head('/self-redirect/')
          .times(2)
          .reply(301, '', { location: '/self-redirect/' });

        // Second request: self-redirect/ (same as source)
        nock(url)
          .head('/self-redirect/')
          .times(2)
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result).to.be.an('array');
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('redirected', false); // No redirect detected since source equals final
        expect(result[0]).to.have.property('redirectCount', 0);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', false); // Doesn't match intended destination
        expect(result[0].fullSrc).to.equal(`${url}/self-redirect/`);
        expect(result[0].fullDest).to.equal(`${url}/intended-destination/`);
        expect(result[0].fullFinal).to.equal(`${url}/self-redirect/`); // Same as source
      });

      it('should handle source URL that redirects to itself with query parameters', async () => {
        const pageUrls = [
          {
            referencedBy: `${url}/redirects.json`,
            origSrc: '/self-redirect?param=value',
            origDest: '/intended-destination',
            isDuplicateSrc: false,
            ordinalDuplicate: 0,
            tooQualified: false,
            hasSameSrcDest: false,
          },
        ];

        // First request: self-redirect?param=value redirects back to itself
        nock(url)
          .head('/self-redirect?param=value')
          .times(2)
          .reply(301, '', { location: '/self-redirect?param=value' });

        // Second request: self-redirect?param=value (same as source)
        nock(url)
          .head('/self-redirect?param=value')
          .times(2)
          .reply(200);

        const result = await processEntriesInParallel(pageUrls, url, context.log);
        expect(result).to.be.an('array');
        expect(result[0]).to.have.property('status', 200);
        expect(result[0]).to.have.property('redirected', false); // No redirect detected since source equals final
        expect(result[0]).to.have.property('redirectCount', 0);
        expect(result[0]).to.have.property('fullFinalMatchesDestUrl', false); // Doesn't match intended destination
        expect(result[0].fullSrc).to.equal(`${url}/self-redirect?param=value`);
        expect(result[0].fullDest).to.equal(`${url}/intended-destination`);
        expect(result[0].fullFinal).to.equal(`${url}/self-redirect?param=value`); // Same as source
      });
    });

    describe('analyzeResults', () => {
      it('should analyze results correctly', () => {
        const results = [
          {
            isDuplicateSrc: true, // problem: is a duplicate
            tooQualified: false,
            hasSameSrcDest: false,
            redirectCount: 0,
            status: 200,
            fullFinalMatchesDestUrl: true,
          },
          {
            isDuplicateSrc: false,
            tooQualified: true, // problem: is too qualified
            hasSameSrcDest: false,
            redirectCount: 0,
            status: 200,
            fullFinalMatchesDestUrl: true,
          },
          {
            isDuplicateSrc: true, // problem: is a duplicate
            tooQualified: true, // problem: is too qualified
            hasSameSrcDest: false,
            redirectCount: 0,
            status: 200,
            fullFinalMatchesDestUrl: true,
          },
          {
            isDuplicateSrc: false,
            tooQualified: false,
            hasSameSrcDest: false,
            redirectCount: 0,
            status: 200,
            fullFinalMatchesDestUrl: true,
          },
        ];

        const { counts, entriesWithProblems } = analyzeResults(results);
        expect(counts.countDuplicateSourceUrls).to.equal(2);
        expect(counts.countTooQualifiedUrls).to.equal(2);
        expect(entriesWithProblems).to.have.lengthOf(3);
      });

      it('should detect too many redirects (redirect count > 1)', () => {
        const results = [
          {
            isDuplicateSrc: false,
            tooQualified: false,
            hasSameSrcDest: false,
            redirectCount: 2, // more than 1 redirect to get to the final destination
            status: 200,
            fullFinalMatchesDestUrl: true,
          },
        ];

        const { counts } = analyzeResults(results);
        expect(counts.countTooManyRedirects).to.equal(1);
      });

      it('should detect 400 errors', () => {
        const results = [
          {
            isDuplicateSrc: false,
            tooQualified: false,
            hasSameSrcDest: false,
            redirectCount: 0,
            status: 404, // problem: 404 error
            fullFinalMatchesDestUrl: true,
          },
        ];

        const { counts } = analyzeResults(results);
        expect(counts.countHttpErrors).to.equal(1);
      });

      it('should detect mismatched destination URLs', () => {
        const results = [
          {
            isDuplicateSrc: false,
            tooQualified: false,
            hasSameSrcDest: false,
            redirectCount: 0,
            status: 200,
            fullFinalMatchesDestUrl: false, // problem
          },
        ];

        const { counts } = analyzeResults(results);
        expect(counts.countNotMatchDestinationUrl).to.equal(1);
      });

      it('should increment countHasSameSrcDest and mark entry as problem if hasSameSrcDest is true', () => {
        const results = [
          {
            isDuplicateSrc: false,
            tooQualified: false,
            hasSameSrcDest: true, // what we want to test
            redirectCount: 0,
            status: 200,
            fullFinalMatchesDestUrl: true,
          },
          {
            isDuplicateSrc: false,
            tooQualified: false,
            hasSameSrcDest: false, // what we don't want to test
            redirectCount: 0,
            status: 200,
            fullFinalMatchesDestUrl: true,
          },
        ];
        const { counts, entriesWithProblems } = analyzeResults(results);
        expect(counts.countHasSameSrcDest).to.equal(1);
        expect(entriesWithProblems).to.have.lengthOf(1);
        expect(entriesWithProblems[0].hasSameSrcDest).to.be.true;
      });
    });
  });

  describe('Suggested Fixes', () => {
    describe('getSuggestedFix', () => {
      it('should return null if getSuggestedFix is called with falsy result', () => {
        expect(getSuggestedFix(undefined)).to.equal(null);
        expect(getSuggestedFix(null)).to.equal(null);
        expect(getSuggestedFix(false)).to.equal(null);
        expect(getSuggestedFix({})).to.equal(null);
      });

      it('should suggest fix for duplicate source URLs', () => {
        const result = {
          isDuplicateSrc: true,
          origSrc: '/duplicate',
          fullSrc: `${url}/duplicate`,
          origDest: '/new',
          fullDest: `${url}/new`,
          fullFinal: `${url}/duplicate`,
          referencedBy: `${url}/redirects.json`,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('since the same');
        expect(fixResult.fixType).to.equal('duplicate-src');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should suggest fix for too qualified URLs', () => {
        const result = {
          tooQualified: true,
          origSrc: `${url}/old`,
          fullSrc: `${url}/old`,
          origDest: '/new',
          fullDest: `${url}/new`,
          fullFinal: `${url}/new`,
          referencedBy: `${url}/redirects.json`,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('use relative path');
        expect(fixResult.fixType).to.equal('too-qualified');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should suggest fix for same source and destination URLs', () => {
        const result = {
          hasSameSrcDest: true,
          origSrc: '/same',
          fullSrc: `${url}/same`,
          origDest: '/same',
          fullDest: `${url}/same`,
          fullFinal: `${url}/same`,
          referencedBy: `${url}/redirects.json`,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('the same as');
        expect(fixResult.fixType).to.equal('same-src-dest');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should suggest fix for 400 errors', () => {
        const result = {
          status: 404,
          fullFinal: `${url}/not-found`,
          origSrc: '/old',
          fullSrc: `${url}/old`,
          origDest: '/new',
          fullDest: `${url}/new`,
          referencedBy: `${url}/redirects.json`,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Check the URL');
        expect(fixResult.fixType).to.equal('manual-check');
        expect(fixResult.canApplyFixAutomatically).to.be.false;
      });

      it('should suggest fix for mismatched destination URLs', () => {
        const result = {
          fullFinal: '/actual',
          origDest: '/expected',
          fullDest: `${url}/expected`,
          origSrc: '/old',
          fullSrc: `${url}/old`,
          referencedBy: `${url}/redirects.json`,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Replace the Destination URL');
        expect(fixResult.fixType).to.equal('final-mismatch');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should suggest fix for too many redirects', () => {
        const result = {
          redirectCount: 3,
          origSrc: '/old',
          fullSrc: `${url}/old`,
          origDest: '/final',
          fullDest: `${url}/final`,
          fullFinal: `${url}/final`,
          fullFinalMatchesDestUrl: true,
          referencedBy: `${url}/redirects.json`,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('too many redirects');
        expect(fixResult.fixType).to.equal('high-redirect-count');
        expect(fixResult.canApplyFixAutomatically).to.be.false;
      });

      it('should return 404 fix if fullFinal is a 404 page', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/old',
          fullSrc: `${baseUrl}/old`,
          origDest: '/404',
          fullDest: `${baseUrl}/404`,
          fullFinal: `${baseUrl}/404`,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('redirects to a 404 page');
        expect(fixResult.fixType).to.equal('404-page');
        expect(fixResult.canApplyFixAutomatically).to.be.false;
      });

      it('should return circular redirect fix if redirectCount >= STOP_AFTER_N_REDIRECTS', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/old',
          fullSrc: `${baseUrl}/old`,
          origDest: '/final',
          fullDest: `${baseUrl}/final`,
          fullFinal: `${baseUrl}/final`,
          redirectCount: 5, // actual value of STOP_AFTER_N_REDIRECTS
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: true,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Redesign the redirects that start from the Source URL');
        expect(fixResult.fixType).to.equal('max-redirects-exceeded');
        expect(fixResult.canApplyFixAutomatically).to.be.false;
      });

      it('should return src-is-final fix when source URL redirects to itself', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/self-redirect',
          fullSrc: `${baseUrl}/self-redirect`,
          origDest: '/intended-destination',
          fullDest: `${baseUrl}/intended-destination`,
          fullFinal: `${baseUrl}/self-redirect`, // Same as fullSrc - redirects to itself
          redirectCount: 1,
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: false, // Doesn't match intended destination
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Remove this entry since the Source URL redirects to itself');
        expect(fixResult.fixType).to.equal('src-is-final');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should return src-is-final fix with relative finalUrl when baseUrl matches', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/self-redirect',
          fullSrc: `${baseUrl}/self-redirect`,
          origDest: '/intended-destination',
          fullDest: `${baseUrl}/intended-destination`,
          fullFinal: `${baseUrl}/self-redirect`, // Same as fullSrc
          redirectCount: 1,
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: false,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Remove this entry since the Source URL redirects to itself');
        expect(fixResult.fixType).to.equal('src-is-final');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
        expect(fixResult.finalUrl).to.equal('/self-redirect'); // Should be relative since origDest is relative
      });

      it('should return src-is-final fix for URLs with trailing slashes', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/self-redirect/',
          fullSrc: `${baseUrl}/self-redirect/`,
          origDest: '/intended-destination/',
          fullDest: `${baseUrl}/intended-destination/`,
          fullFinal: `${baseUrl}/self-redirect/`, // Same as fullSrc
          redirectCount: 1,
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: false,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Remove this entry since the Source URL redirects to itself');
        expect(fixResult.fixType).to.equal('src-is-final');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should return src-is-final fix for URLs with query parameters', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/self-redirect?param=value',
          fullSrc: `${baseUrl}/self-redirect?param=value`,
          origDest: '/intended-destination',
          fullDest: `${baseUrl}/intended-destination`,
          fullFinal: `${baseUrl}/self-redirect?param=value`, // Same as fullSrc
          redirectCount: 1,
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: false,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Remove this entry since the Source URL redirects to itself');
        expect(fixResult.fixType).to.equal('src-is-final');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should return src-is-final fix for URLs with hash fragments', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/self-redirect#section',
          fullSrc: `${baseUrl}/self-redirect#section`,
          origDest: '/intended-destination',
          fullDest: `${baseUrl}/intended-destination`,
          fullFinal: `${baseUrl}/self-redirect#section`, // Same as fullSrc
          redirectCount: 1,
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: false,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Remove this entry since the Source URL redirects to itself');
        expect(fixResult.fixType).to.equal('src-is-final');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should return src-is-final fix for URLs with both query parameters and hash fragments', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/self-redirect?param=value#section',
          fullSrc: `${baseUrl}/self-redirect?param=value#section`,
          origDest: '/intended-destination',
          fullDest: `${baseUrl}/intended-destination`,
          fullFinal: `${baseUrl}/self-redirect?param=value#section`, // Same as fullSrc
          redirectCount: 1,
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: false,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Remove this entry since the Source URL redirects to itself');
        expect(fixResult.fixType).to.equal('src-is-final');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should return src-is-final fix even with multiple redirects', () => {
        const baseUrl = 'https://www.example.com';
        const result = {
          referencedBy: `${baseUrl}/redirects.json`,
          origSrc: '/self-redirect',
          fullSrc: `${baseUrl}/self-redirect`,
          origDest: '/intended-destination',
          fullDest: `${baseUrl}/intended-destination`,
          fullFinal: `${baseUrl}/self-redirect`, // Same as fullSrc after multiple redirects
          redirectCount: 3, // Multiple redirects but ends up at source
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200,
          fullFinalMatchesDestUrl: false,
        };
        const fixResult = getSuggestedFix(result);
        expect(fixResult.fix).to.include('Remove this entry since the Source URL redirects to itself');
        expect(fixResult.fixType).to.equal('src-is-final');
        expect(fixResult.canApplyFixAutomatically).to.be.true;
      });

      it('should generate suggested fixes for multiple entries with issues', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [
                {
                  referencedBy: auditUrl,
                  origSrc: '/duplicate',
                  fullSrc: `${baseUrl}/duplicate`,
                  origDest: '/new',
                  fullDest: `${baseUrl}/new`,
                  fullFinal: `${baseUrl}/duplicate`,
                  redirectCount: 1,
                  isDuplicateSrc: true,
                },
                {
                  referencedBy: auditUrl,
                  origSrc: '/same',
                  fullSrc: `${baseUrl}/same`,
                  origDest: '/same',
                  fullDest: `${baseUrl}/same`,
                  fullFinal: `${baseUrl}/same`,
                  redirectCount: 0,
                  hasSameSrcDest: true,
                },
              ],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').with.lengthOf(2);
        expect(result.suggestions[0]).to.have.property('key');
        expect(result.suggestions[0]).to.have.property('fix');
        expect(result.suggestions[0]).to.have.property('fixType', 'duplicate-src');
        expect(result.suggestions[0]).to.have.property('finalUrl');
        expect(result.suggestions[0]).to.have.property('canApplyFixAutomatically', true);
        expect(result.suggestions[0]).to.have.property('redirectsFile', auditUrl);
        expect(result.suggestions[0]).to.have.property('sourceUrl', '/duplicate');
        expect(result.suggestions[0]).to.have.property('destinationUrl', '/new');
        expect(result.suggestions[0]).to.have.property('redirectCount', 1);
        expect(result.suggestions[0]).to.have.property('httpStatusCode');
        expect(result.suggestions[0].fix).to.include('the same');
        expect(result.suggestions[0].fix).to.include('used later');
        expect(result.suggestions[1]).to.have.property('redirectsFile', auditUrl);
        expect(result.suggestions[1]).to.have.property('sourceUrl', '/same');
        expect(result.suggestions[1]).to.have.property('destinationUrl', '/same');
        expect(result.suggestions[1]).to.have.property('redirectCount', 0);
        expect(result.suggestions[1]).to.have.property('fixType', 'same-src-dest');
        expect(result.suggestions[1]).to.have.property('finalUrl');
        expect(result.suggestions[1]).to.have.property('canApplyFixAutomatically', true);
        expect(result.suggestions[1]).to.have.property('httpStatusCode');
        expect(result.suggestions[1].fix).to.include('is the same as');

        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generating suggestions for URL ${auditUrl} which has 2 affected entries.`);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generated 2 suggested fixes.`);
      });

      it('should generate suggested fixes for src-is-final fix type', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [
                {
                  referencedBy: auditUrl,
                  origSrc: '/self-redirect',
                  fullSrc: `${baseUrl}/self-redirect`,
                  origDest: '/intended-destination',
                  fullDest: `${baseUrl}/intended-destination`,
                  fullFinal: `${baseUrl}/self-redirect`, // Same as fullSrc - redirects to itself
                  redirectCount: 1,
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  status: 200,
                  fullFinalMatchesDestUrl: false, // Doesn't match intended destination
                },
              ],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').with.lengthOf(1);
        expect(result.suggestions[0]).to.have.property('key');
        expect(result.suggestions[0]).to.have.property('fix');
        expect(result.suggestions[0]).to.have.property('fixType', 'src-is-final');
        expect(result.suggestions[0]).to.have.property('finalUrl', '/self-redirect'); // Should be relative
        expect(result.suggestions[0]).to.have.property('canApplyFixAutomatically', true);
        expect(result.suggestions[0]).to.have.property('redirectsFile', auditUrl);
        expect(result.suggestions[0]).to.have.property('sourceUrl', '/self-redirect');
        expect(result.suggestions[0]).to.have.property('destinationUrl', '/intended-destination');
        expect(result.suggestions[0]).to.have.property('redirectCount', 1);
        expect(result.suggestions[0]).to.have.property('httpStatusCode', 200);
        expect(result.suggestions[0].fix).to.include('Remove this entry since the Source URL redirects to itself');

        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generating suggestions for URL ${auditUrl} which has 1 affected entries.`);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generated 1 suggested fixes.`);
      });

      it('should generate suggested fixes for src-is-final with query parameters', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [
                {
                  referencedBy: auditUrl,
                  origSrc: '/self-redirect?param=value',
                  fullSrc: `${baseUrl}/self-redirect?param=value`,
                  origDest: '/intended-destination',
                  fullDest: `${baseUrl}/intended-destination`,
                  fullFinal: `${baseUrl}/self-redirect?param=value`, // Same as fullSrc
                  redirectCount: 1,
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  status: 200,
                  fullFinalMatchesDestUrl: false,
                },
              ],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').with.lengthOf(1);
        expect(result.suggestions[0]).to.have.property('fixType', 'src-is-final');
        expect(result.suggestions[0]).to.have.property('sourceUrl', '/self-redirect?param=value');
        expect(result.suggestions[0]).to.have.property('destinationUrl', '/intended-destination');
        expect(result.suggestions[0]).to.have.property('finalUrl', '/self-redirect?param=value');
        expect(result.suggestions[0].fix).to.include('Remove this entry since the Source URL redirects to itself');
      });

      it('should generate suggested fixes for src-is-final with hash fragments', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [
                {
                  referencedBy: auditUrl,
                  origSrc: '/self-redirect#section',
                  fullSrc: `${baseUrl}/self-redirect#section`,
                  origDest: '/intended-destination',
                  fullDest: `${baseUrl}/intended-destination`,
                  fullFinal: `${baseUrl}/self-redirect#section`, // Same as fullSrc
                  redirectCount: 1,
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  status: 200,
                  fullFinalMatchesDestUrl: false,
                },
              ],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').with.lengthOf(1);
        expect(result.suggestions[0]).to.have.property('fixType', 'src-is-final');
        expect(result.suggestions[0]).to.have.property('sourceUrl', '/self-redirect#section');
        expect(result.suggestions[0]).to.have.property('destinationUrl', '/intended-destination');
        expect(result.suggestions[0]).to.have.property('finalUrl', '/self-redirect#section');
        expect(result.suggestions[0].fix).to.include('Remove this entry since the Source URL redirects to itself');
      });

      it('should generate suggested fixes for src-is-final with multiple redirects', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [
                {
                  referencedBy: auditUrl,
                  origSrc: '/self-redirect',
                  fullSrc: `${baseUrl}/self-redirect`,
                  origDest: '/intended-destination',
                  fullDest: `${baseUrl}/intended-destination`,
                  fullFinal: `${baseUrl}/self-redirect`, // Same as fullSrc after multiple redirects
                  redirectCount: 3, // Multiple redirects but ends up at source
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  status: 200,
                  fullFinalMatchesDestUrl: false,
                },
              ],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').with.lengthOf(1);
        expect(result.suggestions[0]).to.have.property('fixType', 'src-is-final');
        expect(result.suggestions[0]).to.have.property('sourceUrl', '/self-redirect');
        expect(result.suggestions[0]).to.have.property('destinationUrl', '/intended-destination');
        expect(result.suggestions[0]).to.have.property('redirectCount', 3);
        expect(result.suggestions[0].fix).to.include('Remove this entry since the Source URL redirects to itself');
      });

      it('should skip suggestions with HTTP 418 + "unexpected end of file" + source equals final', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [
                {
                  referencedBy: auditUrl,
                  origSrc: '/network-error-page',
                  fullSrc: `${baseUrl}/network-error-page`,
                  origDest: '/destination-page',
                  fullDest: `${baseUrl}/destination-page`,
                  fullFinal: `${baseUrl}/network-error-page`, // Same as fullSrc
                  redirectCount: 0,
                  status: 418, // HTTP error code for network errors
                  error: 'unexpected end of file', // Network error message
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  fullFinalMatchesDestUrl: false,
                },
                {
                  referencedBy: auditUrl,
                  origSrc: '/normal-page',
                  fullSrc: `${baseUrl}/normal-page`,
                  origDest: '/normal-destination',
                  fullDest: `${baseUrl}/normal-destination`,
                  fullFinal: `${baseUrl}/normal-destination`,
                  redirectCount: 0,
                  status: 200, // Normal status
                  error: '', // No error
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  fullFinalMatchesDestUrl: true,
                },
              ],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').with.lengthOf(1); // Only the normal suggestion should be included
        expect(result.suggestions[0]).to.have.property('sourceUrl', '/normal-page');
        expect(result.suggestions[0]).to.have.property('destinationUrl', '/normal-destination');

        // Verify logging
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generating suggestions for URL ${auditUrl} which has 2 affected entries.`);
        expect(context.log.debug).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Skipping suggestion for network error case: /network-error-page -> /destination-page`);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Skipped 1 entries due to exclusion criteria.`);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generated 1 suggested fixes.`);
      });

      it('should not skip suggestions when only some conditions are met', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [
                {
                  referencedBy: auditUrl,
                  origSrc: '/partial-match-1',
                  fullSrc: `${baseUrl}/partial-match-1`,
                  origDest: '/destination',
                  fullDest: `${baseUrl}/destination`,
                  fullFinal: `${baseUrl}/partial-match-1`, // Same as fullSrc
                  redirectCount: 0,
                  status: 200, // Not 418
                  error: 'unexpected end of file', // Has the error message
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  fullFinalMatchesDestUrl: false,
                },
                {
                  referencedBy: auditUrl,
                  origSrc: '/partial-match-2',
                  fullSrc: `${baseUrl}/partial-match-2`,
                  origDest: '/destination',
                  fullDest: `${baseUrl}/destination`,
                  fullFinal: `${baseUrl}/different-final`, // Different from fullSrc
                  redirectCount: 0,
                  status: 418, // Has 418 status
                  error: 'unexpected end of file', // Has the error message
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  fullFinalMatchesDestUrl: false,
                },
                {
                  referencedBy: auditUrl,
                  origSrc: '/partial-match-3',
                  fullSrc: `${baseUrl}/partial-match-3`,
                  origDest: '/destination',
                  fullDest: `${baseUrl}/destination`,
                  fullFinal: `${baseUrl}/partial-match-3`, // Same as fullSrc
                  redirectCount: 0,
                  status: 418, // Has 418 status
                  error: 'different error message', // Different error message
                  isDuplicateSrc: false,
                  tooQualified: false,
                  hasSameSrcDest: false,
                  fullFinalMatchesDestUrl: false,
                },
              ],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').with.lengthOf(3); // All suggestions should be included
        expect(result.suggestions[0]).to.have.property('sourceUrl', '/partial-match-1');
        expect(result.suggestions[1]).to.have.property('sourceUrl', '/partial-match-2');
        expect(result.suggestions[2]).to.have.property('sourceUrl', '/partial-match-3');

        // Verify logging - no skip messages should be present
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generating suggestions for URL ${auditUrl} which has 3 affected entries.`);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generated 3 suggested fixes.`);

        // Verify that the correct number of suggestions were generated
        expect(result.suggestions).to.have.lengthOf(3);
      });

      it('should handle empty or missing issues array', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            details: {
              issues: [],
            },
          },
        };

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').that.is.empty;
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generating suggestions for URL ${auditUrl} which has 0 affected entries.`);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generated 0 suggested fixes.`);
      });

      it('should handle missing audit data', () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {};

        const result = generateSuggestedFixes(auditUrl, auditData, context);

        expect(result).to.have.property('suggestions');
        expect(result.suggestions).to.be.an('array').that.is.empty;
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generating suggestions for URL ${auditUrl} which has 0 affected entries.`);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Generated 0 suggested fixes.`);
      });

      it('should skip opportunity creation when audit fails', async () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            success: false,
            reasons: [{ value: 'Test failure' }],
          },
        };

        const result = await generateOpportunities(auditUrl, auditData, context);

        expect(result).to.deep.equal(auditData);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - Audit itself failed, skipping opportunity creation`);
      });

      it('should skip opportunity creation when no suggestions exist', async () => {
        const baseUrl = 'https://www.example.com';
        const auditUrl = `${baseUrl}/redirects.json`;
        const auditData = {
          auditResult: {
            success: true,
          },
        };

        const result = await generateOpportunities(auditUrl, auditData, context);

        expect(result).to.deep.equal(auditData);
        expect(context.log.info).to.have.been.calledWith(`${AUDIT_LOGGING_NAME} - No suggested fixes found, skipping opportunity creation`);
      });

      it('should create opportunities for valid suggestions', async () => {
        const auditUrl = 'https://www.example.com/redirects.json';
        const auditData = {
          auditResult: { success: true },
          suggestions: [{ key: 'test-key', fix: 'Test fix' }],
        };

        const result = await handlerModule.generateOpportunities(auditUrl, auditData, context);

        expect(result).to.deep.equal(auditData);
        expect(convertToOpportunityStub).to.have.been.calledOnce;
        expect(syncSuggestionsStub).to.have.been.calledOnce;
      });

      it('should use suggestion key as opportunity key', async () => {
        const auditUrl = 'https://www.example.com/redirects.json';
        const testKey = 'test-suggestion-key';
        const auditData = {
          auditResult: { success: true },
          suggestions: [{
            key: testKey,
            fix: 'Test fix',
            data: {
              origSrc: '/old-page',
              origDest: '/new-page',
            },
          }],
        };

        await handlerModule.generateOpportunities(auditUrl, auditData, context);

        // Verify that syncSuggestions was called with the correct key function
        const syncSuggestionsCall = syncSuggestionsStub.firstCall;
        const { buildKey } = syncSuggestionsCall.args[0];
        const testData = { key: testKey };
        expect(buildKey(testData)).to.equal(testKey);
      });

      it('should correctly map new suggestions with opportunity ID', async () => {
        const auditUrl = 'https://www.example.com/redirects.json';
        const auditData = {
          auditResult: { success: true },
          suggestions: [{ key: 'test-key', fix: 'Test fix' }],
        };

        await handlerModule.generateOpportunities(auditUrl, auditData, context);

        // Get the mapNewSuggestion function that was passed to syncSuggestions
        const syncSuggestionsCall = syncSuggestionsStub.firstCall;
        const { mapNewSuggestion } = syncSuggestionsCall.args[0];

        // Verify the mapping function with a sample issue
        const sampleIssue = {
          origSrc: '/old-page',
          origDest: '/new-page',
          fix: 'Test fix',
          fixType: 'duplicate-src',
          finalUrl: '/final-page',
          canApplyFixAutomatically: true,
          redirectsFile: 'https://www.example.com/redirects.json',
          sourceUrl: '/old-page',
          destinationUrl: '/new-page',
          redirectCount: 2,
          httpStatusCode: 200,
        };

        const mappedSuggestion = mapNewSuggestion(sampleIssue);

        expect(mappedSuggestion).to.deep.equal({
          opportunityId: 'test-opportunity-id',
          type: 'REDIRECT_UPDATE',
          rank: 0,
          data: sampleIssue,
        });
      });
    });
  });

  describe('Main Audit Runner', () => {
    it('should run audit successfully', async () => {
      nock(url)
        .get('/redirects.json')
        .reply(200, sampleRedirectsJson);

      nock(url)
        .head('/old-page')
        .times(2)
        .reply(301, '', { location: '/new-page' });

      nock(url)
        .head('/new-page')
        .times(2)
        .reply(200);

      nock(url)
        .head('/another-old')
        .reply(301, '', { location: '/another-new' });

      nock(url)
        .head('/another-new')
        .reply(200);

      const result = await redirectsAuditRunner(url, context);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success');
    });

    it('should handle missing redirects file', async () => {
      nock(url)
        .get('/redirects.json')
        .reply(404);

      const result = await redirectsAuditRunner(url, context);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success');
    });

    it('should handle network errors', async () => {
      nock(url)
        .get('/redirects.json')
        .replyWithError('Network error');

      const result = await redirectsAuditRunner(url, context);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success');
    });

    it('should mark audit as unsuccessful and set reason if baseUrl is invalid', async () => {
      const invalidUrl = 'not a url';
      const result = await redirectsAuditRunner(invalidUrl, context);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons).to.deep.equal([{ value: invalidUrl, error: 'INVALID URL' }]);
    });
  });

  describe('Opportunity Data Mapper', () => {
    describe('createOpportunityData', () => {
      it('should create opportunity data with correct structure', () => {
        const opportunityData = createOpportunityData();

        expect(opportunityData).to.have.property('runbook');
        expect(opportunityData.runbook).to.include('adobe.'); // Sharepoint | wiki
        expect(opportunityData.runbook).to.include('edirect'); // Redirect | redirect

        expect(opportunityData).to.have.property('origin', 'AUTOMATION');
        expect(opportunityData).to.have.property('title', 'Redirect issues found with the /redirects.json file');

        expect(opportunityData).to.have.property('description');
        expect(opportunityData.description).to.include('This audit identifies issues with the /redirects.json file');

        expect(opportunityData).to.have.property('guidance');
        expect(opportunityData.guidance).to.have.property('steps');
        expect(opportunityData.guidance.steps).to.be.an('array');
        expect(opportunityData.guidance.steps[0]).to.include('check if the redirect is valid');

        expect(opportunityData).to.have.property('tags');
        expect(opportunityData.tags).to.deep.equal(['Traffic Acquisition']);

        expect(opportunityData).to.have.property('data');
        expect(opportunityData.data).to.have.property('dataSources');
        expect(opportunityData.data.dataSources).to.deep.equal([DATA_SOURCES.SITE]);
      });

      it('should create opportunity data with projected traffic metrics when provided', () => {
        const projectedTrafficMetrics = {
          projectedTrafficLost: 30,
          projectedTrafficValue: 45,
        };
        const opportunityData = createOpportunityData(projectedTrafficMetrics);

        expect(opportunityData.data).to.have.property('projectedTrafficLost', 30);
        expect(opportunityData.data).to.have.property('projectedTrafficValue', 45);
      });

      it('should create opportunity data with default projected traffic metrics when not provided', () => {
        const opportunityData = createOpportunityData();

        expect(opportunityData.data).to.have.property('projectedTrafficLost', 0);
        expect(opportunityData.data).to.have.property('projectedTrafficValue', 0);
      });

      it('should create opportunity data with partial projected traffic metrics', () => {
        const projectedTrafficMetrics = {
          projectedTrafficLost: 15,
          // projectedTrafficValue not provided ... expect it to use a default value
        };
        const opportunityData = createOpportunityData(projectedTrafficMetrics);

        expect(opportunityData.data).to.have.property('projectedTrafficLost', 15);
        expect(opportunityData.data).to.have.property('projectedTrafficValue', 0);
      });
    });
  });

  describe('Projected Traffic Calculation', () => {
    it('should calculate correct metrics for 148 issues (example from user)', async () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: { success: true },
        suggestions: Array(148).fill({ key: 'test-key' }),
      };

      const result = await handlerModule.generateOpportunities(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;

      // Verify that convertToOpportunity was called with the correct projected traffic metrics
      const convertCall = convertToOpportunityStub.getCall(0);
      expect(convertCall.args[5]).to.deep.include({
        projectedTrafficLost: 30, // 148 * 0.20 = 29.6, rounded to 30
        projectedTrafficValue: 30, // 30 * $1 = $30
      });
    });

    it('should handle rounding correctly (0.5 rounds up)', async () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: { success: true },
        suggestions: Array(5).fill({ key: 'test-key' }), // 5 issues
      };

      await handlerModule.generateOpportunities(auditUrl, auditData, context);

      const convertCall = convertToOpportunityStub.getCall(0);
      expect(convertCall.args[5]).to.deep.include({
        projectedTrafficLost: 1, // 5 * 0.20 = 1.0, rounded to 1
        projectedTrafficValue: 1, // 1 * $1 = $1
      });
    });

    it('should handle rounding correctly (less than 0.5 truncates)', async () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: { success: true },
        suggestions: Array(2).fill({ key: 'test-key' }), // 2 issues
      };

      await handlerModule.generateOpportunities(auditUrl, auditData, context);

      const convertCall = convertToOpportunityStub.getCall(0);
      expect(convertCall.args[5]).to.deep.include({
        projectedTrafficLost: 0, // 2 * 0.20 = 0.4, rounded to 0
        projectedTrafficValue: 0, // 0 * $1 = $0
      });
    });

    it('should handle zero issues by returning early', async () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: { success: true },
        suggestions: [], // 0 issues
      };

      const result = await handlerModule.generateOpportunities(auditUrl, auditData, context);

      // eslint-disable-next-line max-len
      // When there are no suggestions, generateOpportunities returns early without calling convertToOpportunity
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('should handle multiple issues with various rounding scenarios', async () => {
      const testCases = [
        { issues: 3, expectedTrafficLost: 1, expectedValue: 1 }, // 3 * 0.20 = 0.6, rounds to 1
        { issues: 7, expectedTrafficLost: 1, expectedValue: 1 }, // 7 * 0.20 = 1.4, rounds to 1
        { issues: 8, expectedTrafficLost: 2, expectedValue: 2 }, // 8 * 0.20 = 1.6, rounds to 2
        { issues: 10, expectedTrafficLost: 2, expectedValue: 2 }, // 10 * 0.20 = 2.0, rounds to 2
        { issues: 12, expectedTrafficLost: 2, expectedValue: 2 }, // 12 * 0.20 = 2.4, rounds to 2
        { issues: 13, expectedTrafficLost: 3, expectedValue: 3 }, // 13 * 0.20 = 2.6, rounds to 3
      ];

      for (const { issues, expectedTrafficLost, expectedValue } of testCases) {
        // Reset stubs for each test case
        convertToOpportunityStub.reset();

        const auditUrl = 'https://www.example.com/redirects.json';
        const auditData = {
          auditResult: { success: true },
          suggestions: Array(issues).fill({ key: 'test-key' }),
        };

        // eslint-disable-next-line no-await-in-loop
        await handlerModule.generateOpportunities(auditUrl, auditData, context);

        const convertCall = convertToOpportunityStub.getCall(0);
        expect(convertCall.args[5]).to.deep.include({
          projectedTrafficLost: expectedTrafficLost,
          projectedTrafficValue: expectedValue,
        });
      }
    });
  });

  describe('Issue Filtering', () => {
    describe('filterIssuesToFitIntoSpace', () => {
      it('should return empty array when no issues provided', () => {
        const result = filterIssuesToFitIntoSpace([], context.log);
        expect(result).to.deep.equal({ filteredIssues: [], wasReduced: false });
      });

      it('should return empty array when issues is null', () => {
        const result = filterIssuesToFitIntoSpace(null, context.log);
        expect(result).to.deep.equal({ filteredIssues: [], wasReduced: false });
      });

      it('should return empty array when issues is undefined', () => {
        const result = filterIssuesToFitIntoSpace(undefined, context.log);
        expect(result).to.deep.equal({ filteredIssues: [], wasReduced: false });
      });

      it('should return all issues when they fit within size limit', () => {
        const smallIssues = [
          { origSrc: '/page1', origDest: '/new1' },
          { origSrc: '/page2', origDest: '/new2' }
        ];

        const result = filterIssuesToFitIntoSpace(smallIssues, context.log);
        expect(result.filteredIssues).to.deep.equal(smallIssues);
        expect(result.wasReduced).to.be.false;
        expect(context.log.info).to.have.been.calledWith(
          `${AUDIT_LOGGING_NAME} - All 2 issues fit within 400 KB limit (0 KB used)`
        );
      });

      it('should filter issues when they exceed size limit', () => {
        // Create a large issue that will exceed the 400KB limit
        const largeIssue = {
          origSrc: '/page1',
          origDest: '/new1',
          redirectChain: 'A'.repeat(500000), // 500KB of data
          error: 'B'.repeat(10000)
        };

        const issues = [largeIssue];
        const result = filterIssuesToFitIntoSpace(issues, context.log);

        expect(result.wasReduced).to.be.true;
        expect(result.filteredIssues.length).to.be.lessThan(issues.length);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Total size of all the issues exceed space limit/)
        );
      });

      it('should categorize issues correctly by priority', () => {
        const issues = [
          { isDuplicateSrc: true, origSrc: '/dup1', origDest: '/new1' },
          { tooQualified: true, origSrc: '/qualified', origDest: '/new2' },
          { hasSameSrcDest: true, origSrc: '/same', origDest: '/same' },
          { status: 404, origSrc: '/error', origDest: '/new3' },
          { fullFinalMatchesDestUrl: false, origSrc: '/mismatch', origDest: '/new4' },
          { redirectCount: 3, origSrc: '/redirects', origDest: '/new5' }
        ];

        const result = filterIssuesToFitIntoSpace(issues, context.log);

        // Should log that all issues fit within limit
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/All 6 issues fit within 400 KB limit/)
        );
      });

      it('should handle issues with no non-empty categories', () => {
        const issues = [
          { origSrc: '/normal', origDest: '/new1' } // No issues, so no categories
        ];

        const result = filterIssuesToFitIntoSpace(issues, context.log);
        // Issues with no problems should still be returned as they fit within size limit
        expect(result).to.deep.equal({ filteredIssues: issues, wasReduced: false });
      });

      it('should distribute issues fairly across categories', () => {
        // Create large issues that will exceed the 400KB limit
        const issues = [];
        for (let i = 0; i < 1000; i++) {
          issues.push({
            isDuplicateSrc: i % 2 === 0,
            tooQualified: i % 3 === 0,
            status: i % 5 === 0 ? 404 : 200,
            origSrc: `/page${i}`,
            origDest: `/new${i}`,
            redirectChain: 'A'.repeat(1000) // Large redirect chain
          });
        }

        const result = filterIssuesToFitIntoSpace(issues, context.log);

        expect(result.wasReduced).to.be.true;
        expect(result.filteredIssues.length).to.be.greaterThan(0);
        expect(result.filteredIssues.length).to.be.lessThanOrEqual(issues.length);
      });

      it('should log filtering statistics', () => {
        const issues = [
          { origSrc: '/page1', origDest: '/new1', redirectChain: 'A'.repeat(500000) }
        ];

        filterIssuesToFitIntoSpace(issues, context.log);

        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Filtered \d+ issues/)
        );
      });
    });

    describe('categorizeIssue', () => {
      it('should categorize duplicate source issues', () => {
        // Create large issues that will trigger filtering
        const issues = Array(1000).fill(null).map((_, i) => ({
          isDuplicateSrc: true,
          origSrc: `/dup${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000)
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/category 'duplicate-src'/)
        );
      });

      it('should categorize too qualified issues', () => {
        const issues = Array(1000).fill(null).map((_, i) => ({
          tooQualified: true,
          origSrc: `/qualified${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000)
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/category 'too-qualified'/)
        );
      });

      it('should categorize same source/destination issues', () => {
        const issues = Array(1000).fill(null).map((_, i) => ({
          hasSameSrcDest: true,
          origSrc: `/same${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000)
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/category 'same-src-dest'/)
        );
      });

      it('should categorize HTTP error issues', () => {
        const issues = Array(1000).fill(null).map((_, i) => ({
          status: 404,
          origSrc: `/error${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000)
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/category 'http-errors'/)
        );
      });

      it('should categorize final mismatch issues', () => {
        const issues = Array(1000).fill(null).map((_, i) => ({
          fullFinalMatchesDestUrl: false,
          origSrc: `/mismatch${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000)
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/category 'final-mismatch'/)
        );
      });

      it('should categorize too many redirects issues', () => {
        const issues = Array(1000).fill(null).map((_, i) => ({
          redirectCount: 3,
          origSrc: `/redirects${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000),
          fullFinalMatchesDestUrl: true, // Ensure this doesn't trigger final-mismatch
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/category 'too-many-redirects' - selected \d+ out of \d+ issues/)
        );
      });

      it('should categorize issues with redirectCount > MAX_REDIRECTS_TO_TOLERATE as too-many-redirects', () => {
        const issues = Array(1000).fill(null).map((_, i) => ({
          redirectCount: 2, // > MAX_REDIRECTS_TO_TOLERATE (which is 1)
          origSrc: `/redirects${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000),
          fullFinalMatchesDestUrl: true // Ensure this doesn't trigger final-mismatch
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/category 'too-many-redirects' - selected \d+ out of \d+ issues/)
        );
      });

      it('should categorize issues with no matching conditions as unknown', () => {
        const issues = Array(1000).fill(null).map((_, i) => ({
          // Issue with no flags set and redirectCount <= MAX_REDIRECTS_TO_TOLERATE
          origSrc: `/unknown${i}`,
          origDest: `/new${i}`,
          redirectChain: 'A'.repeat(1000),
          isDuplicateSrc: false,
          tooQualified: false,
          hasSameSrcDest: false,
          status: 200, // Ensure this doesn't trigger http-errors
          fullFinalMatchesDestUrl: true, // Ensure this doesn't trigger final-mismatch
          redirectCount: 1, // <= MAX_REDIRECTS_TO_TOLERATE (which is 1)
        }));
        const result = filterIssuesToFitIntoSpace(issues, context.log);
        // since there are no issues in known categories, there should not be any log about selected issues
        expect(context.log.info).to.not.have.been.calledWith(
          sinon.match(/ - selected \d+ out of \d+ issues/)
        );
      });
    });
  });

  describe('Main Audit Runner Integration', () => {
    it('should not filter issues when they fit within size limit', async () => {
      nock(url)
        .get('/redirects.json')
        .reply(200, {
          data: [{ Source: '/page1', Destination: '/new1' }],
          total: 1
        });

      nock(url)
        .head('/page1')
        .reply(200);

      const result = await redirectsAuditRunner(url, context);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Issues might be reduced/)
      );
    });

    it('should directly test wasReduced logging by calling filterIssuesToFitIntoSpace', () => {
      // Create a single very large issue that will definitely exceed the 400KB limit
      const largeIssues = [{
        origSrc: '/page0',
        origDest: '/new0',
        redirectChain: 'A'.repeat(500000), // 500KB of data - definitely exceeds 400KB limit
        error: 'B'.repeat(10000),
        isDuplicateSrc: false,
        tooQualified: false,
        hasSameSrcDest: false,
        status: 200,
        fullFinalMatchesDestUrl: true,
        redirectCount: 0
      }];

      const result = filterIssuesToFitIntoSpace(largeIssues, context.log);

      // Test that the function returns the expected structure
      expect(result).to.have.property('wasReduced');
      expect(result.wasReduced).to.be.true; // Should be true since the issue exceeds the limit
      expect(result).to.have.property('filteredIssues');
      expect(Array.isArray(result.filteredIssues)).to.be.true;
    });
  });

  describe('Size Analysis Logging', () => {
    it('should log suggestion size analysis', () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: {
          details: {
            issues: [
              {
                origSrc: '/page1',
                origDest: '/new1',
                referencedBy: 'https://www.example.com/redirects.json',
                fullFinal: 'https://www.example.com/final1',
                fullDest: 'https://www.example.com/dest1',
                redirectChain: 'A->B->C',
                error: 'Test error',
                isDuplicateSrc: true,
                tooQualified: false,
                hasSameSrcDest: false,
                status: 200,
                fullFinalMatchesDestUrl: true,
                redirectCount: 0
              },
              {
                origSrc: '/page2',
                origDest: '/new2',
                referencedBy: 'https://www.example.com/redirects.json',
                fullFinal: 'https://www.example.com/final2',
                fullDest: 'https://www.example.com/dest2',
                redirectChain: 'A->B->C',
                error: 'Test error',
                isDuplicateSrc: false,
                tooQualified: true,
                hasSameSrcDest: false,
                status: 200,
                fullFinalMatchesDestUrl: true,
                redirectCount: 0
              }
            ]
          }
        }
      };

      const result = generateSuggestedFixes(auditUrl, auditData, context);

      expect(result).to.have.property('suggestions');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Total size of suggestions/)
      );
    });

    it('should log warning when suggestions exceed 400 KB', () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: {
          details: {
            issues: Array(1000).fill(null).map((_, i) => ({
              origSrc: `/page${i}`,
              origDest: `/new${i}`,
              referencedBy: 'https://www.example.com/redirects.json',
              fullFinal: `https://www.example.com/final${i}`,
              fullDest: `https://www.example.com/dest${i}`,
              redirectChain: 'A'.repeat(1000),
              error: 'B'.repeat(1000),
              isDuplicateSrc: i % 2 === 0,
              tooQualified: i % 3 === 0,
              hasSameSrcDest: false,
              status: 200,
              fullFinalMatchesDestUrl: true,
              redirectCount: 0
            }))
          }
        }
      };

      const result = generateSuggestedFixes(auditUrl, auditData, context);

      expect(result).to.have.property('suggestions');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/WARNING: Total size of all suggestions.*is >= 400 KB/)
      );
    });

    it('should log suggestion size analysis with individual metrics', () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: {
          details: {
            issues: [
              {
                origSrc: '/page1',
                origDest: '/new1',
                referencedBy: 'https://www.example.com/redirects.json',
                fullFinal: 'https://www.example.com/final1',
                fullDest: 'https://www.example.com/dest1',
                redirectChain: 'A->B->C',
                error: 'Test error',
                isDuplicateSrc: true,
                tooQualified: false,
                hasSameSrcDest: false,
                status: 200,
                fullFinalMatchesDestUrl: true,
                redirectCount: 0
              },
              {
                origSrc: '/page2',
                origDest: '/new2',
                referencedBy: 'https://www.example.com/redirects.json',
                fullFinal: 'https://www.example.com/final2',
                fullDest: 'https://www.example.com/dest2',
                redirectChain: 'A->B->C',
                error: 'Test error',
                isDuplicateSrc: false,
                tooQualified: true,
                hasSameSrcDest: false,
                status: 200,
                fullFinalMatchesDestUrl: true,
                redirectCount: 0
              }
            ]
          }
        }
      };

      const result = generateSuggestedFixes(auditUrl, auditData, context);

      expect(result).to.have.property('suggestions');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Suggestion size analysis/)
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Suggestion database capacity/)
      );
    });

    it('should handle suggestions with zero-byte serialization (covers smallestSize = 0 branch)', () => {
      const auditUrl = 'https://www.example.com/redirects.json';
      const auditData = {
        auditResult: {
          details: {
            issues: [
              {
                origSrc: '/page1',
                origDest: '/new1',
                referencedBy: 'https://www.example.com/redirects.json',
                fullFinal: 'https://www.example.com/final1',
                fullDest: 'https://www.example.com/dest1',
                redirectChain: 'A->B->C',
                error: 'Test error',
                isDuplicateSrc: true,
                tooQualified: false,
                hasSameSrcDest: false,
                status: 200,
                fullFinalMatchesDestUrl: true,
                redirectCount: 0
              }
            ]
          }
        }
      };

      // First, let the function generate suggestions normally
      const result = generateSuggestedFixes(auditUrl, auditData, context);

      // Verify that suggestions were generated (this ensures we pass the condition at line 972)
      expect(result).to.have.property('suggestions');
      expect(result.suggestions).to.be.an('array').with.length.greaterThan(0);

      // Now mock JSON.stringify to return empty string for size analysis
      // This will make all suggestionSizes be 0, which will make nonZeroSizes.length === 0
      const originalJSONStringify = JSON.stringify;
      JSON.stringify = sandbox.stub().returns('');

      // Call the function again to trigger the size analysis with mocked JSON.stringify
      const result2 = generateSuggestedFixes(auditUrl, auditData, context);

      expect(result2).to.have.property('suggestions');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Suggestion size analysis: smallest non-zero size = 0 bytes/)
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Suggestion database capacity/)
      );

      // Restore the original function
      JSON.stringify = originalJSONStringify;
    });
  });
});
