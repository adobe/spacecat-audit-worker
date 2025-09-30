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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import chaiAsPromised from 'chai-as-promised';
import {
  sitemapAuditRunner,
  opportunityAndSuggestions,
  generateSuggestions,
  findSitemap,
  getPagesWithIssues,
  getSitemapsWithIssues,
} from '../../src/sitemap/handler.js';
import {
  ERROR_CODES,
  filterValidUrls,
  isSitemapContentValid,
  checkSitemap,
  checkRobotsForSitemap,
  fetchContent,
  getBaseUrlPagesFromSitemaps,
} from '../../src/sitemap/common.js';
import { extractDomainAndProtocol } from '../../src/support/utils.js';
import { MockContextBuilder } from '../shared.js';
import { DATA_SOURCES } from '../../src/common/constants.js';

use(sinonChai);
use(chaiAsPromised);
const sandbox = sinon.createSandbox();

describe('Sitemap Audit', () => {
  let context;
  const url = 'https://some-domain.adobe';
  const { protocol, domain } = extractDomainAndProtocol(url);
  const message = {
    type: 'sitemap',
    url: 'site-id',
    auditContext: {},
  };
  const sampleSitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + `<url> <loc>${url}/foo</loc></url>\n`
    + `<url> <loc>${url}/bar</loc></url>\n`
    + '</urlset>';

  const sampleSitemapTwo = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + `<url> <loc>${url}/baz</loc></url>\n`
    + `<url> <loc>${url}/cux</loc></url>\n`
    + '</urlset>';

  const sampleSitemapMoreUrlsWWW = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + `<url> <loc>${protocol}://www.${domain}/foo</loc></url>\n`
    + `<url> <loc>${protocol}://www.${domain}/bar</loc></url>\n`
    + '<url> <loc>https://another-url.test/baz</loc></url>\n'
    + '</urlset>';

  const sitemapIndex = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + `<sitemap><loc>${url}/sitemap_foo.xml</loc></sitemap>\n`
    + `<sitemap><loc>${url}/sitemap_bar.xml</loc></sitemap>\n`
    + '</sitemapindex>';

  beforeEach('setup', () => {
    context = new MockContextBuilder().withSandbox(sandbox).build(message);
    nock(url).get('/sitemap_foo.xml').reply(200, sampleSitemap);
    nock(url).get('/sitemap_bar.xml').reply(200, sampleSitemapTwo);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    sandbox.restore();
  });

  describe('sitemapAuditRunner', () => {
    it('runs successfully for sitemaps extracted from robots.txt', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(
          200,
          `Sitemap: ${url}/sitemap_foo.xml\nSitemap: ${url}/sitemap_bar.xml`,
        );

      nock(url).head('/sitemap_foo.xml').reply(200);
      nock(url).head('/sitemap_bar.xml').reply(200);
      nock(url).head('/foo').reply(200);
      nock(url).head('/bar').reply(200);
      nock(url).head('/baz').reply(200);
      nock(url).head('/cux').reply(200);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          details: {
            issues: {},
          },
          extractedPaths: {
            [`${url}/sitemap_bar.xml`]: [
              `${url}/baz`,
              `${url}/cux`,
            ],
            [`${url}/sitemap_foo.xml`]: [
              `${url}/foo`,
              `${url}/bar`,
            ],
          },
          success: true,
          reasons: [
            {
              value: 'Sitemaps found and checked.',
            },
          ],
          url,
        },
        fullAuditRef: url,
        url,
      });
    });

    it('runs successfully for sitemap extracted from robots.txt through sitemap index', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap_index.xml`);

      nock(url).get('/sitemap_index.xml').reply(200, sitemapIndex);
      nock(url).head('/sitemap_foo.xml').reply(200);
      nock(url).head('/sitemap_bar.xml').reply(200);
      nock(url).head('/foo').reply(200);
      nock(url).head('/bar').reply(200);
      nock(url).head('/baz').reply(200);
      nock(url).head('/cux').reply(200);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          details: {
            issues: {},
          },
          extractedPaths: {
            [`${url}/sitemap_bar.xml`]: [
              `${url}/baz`,
              `${url}/cux`,
            ],
            [`${url}/sitemap_foo.xml`]: [
              `${url}/foo`,
              `${url}/bar`,
            ],
          },
          success: true,
          reasons: [
            {
              value: 'Sitemaps found and checked.',
            },
          ],
          url,
        },
        fullAuditRef: url,
        url,
      });
    });

    it('runs successfully for text sitemap extracted from robots.txt', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(
          200,
          `Sitemap: ${url}/sitemap_foo.txt\nSitemap: ${url}/sitemap_bar.txt`,
        );

      nock(url)
        .get('/sitemap_foo.txt')
        .reply(200, `${url}/foo\n${url}/bar`, { 'content-type': 'text/plain' });

      nock(url)
        .get('/sitemap_bar.txt')
        .reply(200, `${url}/baz\n${url}/cux`, { 'content-type': 'text/plain' });

      nock(url).head('/foo').reply(200);
      nock(url).head('/bar').reply(200);
      nock(url).head('/baz').reply(200);
      nock(url).head('/cux').reply(200);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          details: {
            issues: {},
          },
          extractedPaths: {
            [`${url}/sitemap_bar.txt`]: [
              `${url}/baz`,
              `${url}/cux`,
            ],
            [`${url}/sitemap_foo.txt`]: [
              `${url}/foo`,
              `${url}/bar`,
            ],
          },
          success: true,
          reasons: [
            {
              value: 'Sitemaps found and checked.',
            },
          ],
          url,
        },
        fullAuditRef: url,
        url,
      });
    });

    it('should return 404 when robots.txt not found', async () => {
      nock(url).get('/robots.txt').reply(404);
      nock(url).head('/sitemap_index.xml').reply(404);
      nock(url).head('/sitemap.xml').reply(200);
      nock(url).get('/sitemap.xml').reply(200, sampleSitemap);
      nock(url).head('/foo').reply(200);
      nock(url).head('/bar').reply(200);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          reasons: [
            {
              error: ERROR_CODES.FETCH_ERROR,
              value:
                'Fetch error for https://some-domain.adobe/robots.txt Status: 404',
            },
          ],
          success: false,
        },
        fullAuditRef: url,
        url,
      });
    });

    it('should return 404 when site not found', async () => {
      nock(url)
        .persist()
        .head(() => true)
        .reply(404);

      nock(url)
        .get(() => true)
        .reply(404);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          reasons: [
            {
              error: ERROR_CODES.FETCH_ERROR,
              value:
                'Fetch error for https://some-domain.adobe/robots.txt Status: 404',
            },
          ],
          success: false,
        },
        fullAuditRef: url,
        url,
      });
    });
  });

  describe('fetchContent', () => {
    it('should return payload and type when response is successful', async () => {
      const mockResponse = {
        payload: 'test',
        type: 'text/plain',
      };
      nock(url).get('/test').reply(200, mockResponse.payload, {
        'content-type': mockResponse.type,
      });

      const result = await fetchContent(`${url}/test`);
      expect(result).to.eql(mockResponse);
    });

    it('should throw error when response is not successful', async () => {
      nock(url).get('/test').reply(404);
      await expect(fetchContent(`${url}/test`)).to.be.rejectedWith(
        'Fetch error for https://some-domain.adobe/test Status: 404',
      );
    });
  });

  describe('checkRobotsForSitemap', () => {
    it('should return error when no sitemap found in robots.txt', async () => {
      nock(url).get('/robots.txt').reply(200, 'Allow: /');

      const { paths, reasons } = await checkRobotsForSitemap(protocol, domain);
      expect(paths).to.eql([]);
      expect(reasons).to.deep.equal([ERROR_CODES.NO_SITEMAP_IN_ROBOTS]);
    });

    it('should return error when unable to fetch robots.txt', async () => {
      nock(url).get('/robots.txt').reply(404);

      await expect(checkRobotsForSitemap(protocol, domain)).to.be.rejectedWith(
        'Fetch error for https://some-domain.adobe/robots.txt Status: 404',
      );
    });
  });

  describe('isSitemapContentValid', () => {
    it('should return true for valid sitemap content', () => {
      const sitemapContent = { payload: '<?xml', type: 'application/xml' };
      expect(isSitemapContentValid(sitemapContent)).to.be.true;
    });

    it('should return true for valid sitemap content when xml', () => {
      const sitemapContent = {
        payload:
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
          + '    <url><loc>https://www.adobe.com/</loc></url>\n'
          + '      </urlset>',
        type: 'application/xml',
      };
      expect(isSitemapContentValid(sitemapContent)).to.be.true;
    });

    it('should return true for valid sitemap content when content is text', () => {
      const sitemapContent = {
        payload: 'test text',
        type: 'text/plain',
      };
      expect(isSitemapContentValid(sitemapContent)).to.be.true;
    });

    it('should return true for valid sitemap content for text/xml', () => {
      const sitemapContent = {
        payload:
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
          + '    <url><loc>https://www.adobe.com/</loc></url>\n'
          + '      </urlset>',
        type: 'text/xml',
      };
      expect(isSitemapContentValid(sitemapContent)).to.be.true;
    });
  });

  describe('checkSitemap', () => {
    it('should return SITEMAP_NOT_FOUND when the sitemap does not exist', async () => {
      nock(url).get('/sitemap.xml').reply(404);

      const resp = await checkSitemap(`${url}/sitemap.xml`);
      expect(resp.existsAndIsValid).to.equal(false);
      expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_NOT_FOUND);
    });

    it('should return FETCH_ERROR when there is a network error', async () => {
      nock(url).get('/sitemap.xml').replyWithError('Network error');

      const resp = await checkSitemap();
      expect(resp.existsAndIsValid).to.equal(false);
      expect(resp.reasons).to.include(ERROR_CODES.FETCH_ERROR);
    });

    it('checkSitemap returns INVALID_SITEMAP_FORMAT when sitemap is not valid xml', async () => {
      nock(url)
        .get('/sitemap.xml')
        .reply(200, 'Not valid XML', { 'content-type': 'invalid' });

      const resp = await checkSitemap(`${url}/sitemap.xml`);
      expect(resp.existsAndIsValid).to.equal(false);
      expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_FORMAT);
    });

    it('checkSitemap returns invalid result for non-existing sitemap', async () => {
      nock(url).get('/non-existent-sitemap.xml').reply(404);

      const result = await checkSitemap(`${url}/non-existent-sitemap.xml`);
      expect(result.existsAndIsValid).to.equal(false);
      expect(result.reasons).to.deep.equal([ERROR_CODES.SITEMAP_NOT_FOUND]);
    });
  });

  describe('getBaseUrlPagesFromSitemaps', () => {
    const sampleSitemapMoreUrls = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + `<url> <loc>${url}/foo</loc></url>\n`
      + `<url> <loc>${url}/bar</loc></url>\n`
      + '<url> <loc>https://another-url.test/baz</loc></url>\n'
      + '</urlset>';

    it('should return all pages from sitemap that have the same base url', async () => {
      nock(url).get('/sitemap.xml').reply(200, sampleSitemapMoreUrls);
      const result = await getBaseUrlPagesFromSitemaps(url, [
        `${url}/sitemap.xml`,
      ]);
      expect(result).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
      });
    });

    it('should return all pages from sitemap that have the same base url variant', async () => {
      nock(`${protocol}://www.${domain}`)
        .get('/sitemap.xml')
        .reply(200, sampleSitemapMoreUrls);
      const result = await getBaseUrlPagesFromSitemaps(url, [
        `${protocol}://www.${domain}/sitemap.xml`,
      ]);
      expect(result).to.deep.equal({
        [`${protocol}://www.${domain}/sitemap.xml`]: [
          `${url}/foo`,
          `${url}/bar`,
        ],
      });
    });

    it('should return all pages from sitemap that include www', async () => {
      nock(`${url}`).get('/sitemap.xml').reply(200, sampleSitemapMoreUrlsWWW);
      const result = await getBaseUrlPagesFromSitemaps(url, [
        `${url}/sitemap.xml`,
      ]);
      expect(result).to.deep.equal({
        [`${url}/sitemap.xml`]: [
          `${protocol}://www.${domain}/foo`,
          `${protocol}://www.${domain}/bar`,
        ],
      });
    });

    it('should return nothing when sitemap does not contain urls', async () => {
      nock(url)
        .get('/sitemap.xml')
        .reply(
          200,
          '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '<url></url>\n'
            + '<url></url>\n'
            + '</urlset>',
        );

      const resp = await getBaseUrlPagesFromSitemaps(url, [
        `${url}/sitemap.xml`,
      ]);
      expect(resp).to.deep.equal({});
    });

    it('should skip already processed sitemap URLs', async () => {
      const sitemapUrl = `${url}/sitemap.xml`;
      nock(url).get('/sitemap.xml').reply(200, sampleSitemapMoreUrls);

      // Pass the same sitemap URL twice
      const result = await getBaseUrlPagesFromSitemaps(url, [sitemapUrl, sitemapUrl]);
      expect(result).to.deep.equal({
        [sitemapUrl]: [`${url}/foo`, `${url}/bar`],
      });
    });

    it('should handle URLs with whitespace in sitemap XML (ex: crucial.com)', async () => {
      const sampleSitemapWithWhitespace = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + `<url> <loc> ${url}/foo </loc></url>\n`
        + `<url> <loc> ${url}/bar </loc></url>\n`
        + '<url> <loc> https://another-url.test/baz </loc></url>\n'
        + '</urlset>';

      nock(url).get('/sitemap.xml').reply(200, sampleSitemapWithWhitespace);
      const result = await getBaseUrlPagesFromSitemaps(url, [
        `${url}/sitemap.xml`,
      ]);
      expect(result).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
      });
    });
  });

  describe('findSitemap', () => {
    it('should return error when URL is invalid', async () => {
      const result = await findSitemap('not a valid url');
      expect(result.success).to.equal(false);
      expect(result.reasons).to.deep.equal([
        {
          error: ERROR_CODES.INVALID_URL,
          value: 'not a valid url',
        },
      ]);
    });

    it('should return error when no valid pages exist', async () => {
      nock(url).get('/robots.txt').reply(200, `Sitemap: ${url}/sitemap.xml`);
      nock(url).get('/sitemap.xml').reply(200, sampleSitemap);
      nock(url).head('/foo').reply(404);
      nock(url).head('/bar').reply(404);

      const result = await findSitemap(url);

      expect(result.success).to.equal(false);
      expect(result.reasons).to.deep.equal([
        {
          error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
          value: `${url}/sitemap.xml`,
        },
      ]);
      expect(result.paths).to.be.undefined;
    });

    it('should return success when sitemap is found in robots.txt', async () => {
      nock(url).get('/robots.txt').reply(200, `Sitemap: ${url}/sitemap.xml`);
      nock(url).get('/sitemap.xml').reply(200, sampleSitemap);
      nock(url).head('/foo').reply(200);
      nock(url).head('/bar').reply(200);

      const result = await findSitemap(url);
      expect(result.success).to.equal(true);
    });

    it('should fail when sitemap contents have a different URL than the base domain (regardless of www. or not)', async () => {
      nock(url).get('/robots.txt').reply(200, 'Sitemap: ');

      nock(url)
        .get('/sitemap.xml')
        .reply(
          200,
          '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '<url> <loc>https://another-url.test/baz</loc></url>\n'
            + '</urlset>',
        );

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should fail when robots points to an empty string instead of an actual URI', async () => {
      nock(url).get('/robots.txt').reply(200, 'Sitemap: ');

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should fail when sitemap is empty (', async () => {
      nock(url).get('/robots.txt').reply(200, `Sitemap: ${url}/sitemap.xml`);
      nock(url)
        .get('/sitemap.xml')
        .reply(200, () => undefined);

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should return success when sitemap.xml is found', async () => {
      nock(url).get('/robots.txt').reply(200, 'Allow: /');
      nock(url).head('/sitemap.xml').reply(200);
      nock(url).head('/sitemap_index.xml').reply(200);
      nock(url)
        .get('/sitemap.xml')
        .reply(
          200,
          '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + `<url> <loc>${url}/foo</loc></url>\n`
            + `<url> <loc>${url}/bar</loc></url>\n`
            + `<url> <loc>${url}/baz</loc></url>\n`
            + `<url> <loc>${url}/zzz</loc></url>\n`
            + '</urlset>',
        );

      nock(url).head('/foo').reply(200);
      nock(url).head('/bar').reply(200);
      nock(url).head('/zzz').replyWithError('Network error');
      nock(url)
        .head('/baz')
        .reply(301, '', { Location: `${url}/zzz` });

      const result = await findSitemap('https://some-domain.adobe', {
        info: () => {},
      });
      expect(result.success).to.equal(true);
    });

    it('should return success when sitemap_index.xml is found', async () => {
      nock(url).get('/robots.txt').reply(200, 'Allow: /');
      nock(url).head('/sitemap.xml').reply(404);
      nock(url).head('/sitemap_index.xml').reply(200);
      nock(url).get('/sitemap_index.xml').reply(200, sitemapIndex);
      nock(url).head('/sitemap_foo.xml').reply(200);
      nock(url).head('/sitemap_bar.xml').reply(200);
      nock(url).head('/foo').reply(200);
      nock(url).head('/bar').reply(200);
      nock(url).head('/baz').reply(200);
      nock(url).head('/cux').reply(200);

      const result = await findSitemap(url);
      expect(result.success).to.equal(true);
    });

    it('should return success when sitemap paths have www', async () => {
      nock(`${protocol}://www.${domain}`)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap.xml`);
      nock(url).get('/sitemap.xml').reply(200, sampleSitemapMoreUrlsWWW);
      nock(`${protocol}://www.${domain}`).head('/foo').reply(200);
      nock(`${protocol}://www.${domain}`).head('/bar').reply(200);

      const result = await findSitemap(`${protocol}://www.${domain}`);
      expect(result.success).to.equal(true);
    });

    it('should return error when no sitemap is found', async () => {
      nock(url).get('/robots.txt').reply(200, 'Allow: /');
      nock(url).head('/sitemap.xml').reply(404);
      nock(url).head('/sitemap_index.xml').reply(404);

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should return error when no valid paths where extracted from sitemap', async () => {
      const sitemapInvalidPaths = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + '<url> <loc>invalid-url</loc></url>\n'
        + '</urlset>';
      nock(url).get('/robots.txt').reply(200, 'Allow: /');
      nock(url).head('/sitemap.xml').reply(200);
      nock(url).head('/sitemap_index.xml').reply(404);
      nock(url).get('/sitemap.xml').reply(200, sitemapInvalidPaths);

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should handle missing details properties with fallback defaults (lines 41-42)', async () => {
      // Test the exact fallback logic directly by simulating the specific scenario
      // This is what the code does on lines 41-42:
      // const extractedPaths = siteMapUrlsResult.details?.extractedPaths || {};
      // const filteredSitemapUrls = siteMapUrlsResult.details?.filteredSitemapUrls || [];

      // Test case 1: details exists but properties are undefined
      const siteMapUrlsResult1 = {
        success: true,
        reasons: [{ value: 'Extracted URLs successfully' }],
        details: {
          // extractedPaths and filteredSitemapUrls are undefined
        },
      };

      const extractedPaths1 = siteMapUrlsResult1.details?.extractedPaths || {};
      const filteredSitemapUrls1 = siteMapUrlsResult1.details?.filteredSitemapUrls || [];

      expect(extractedPaths1).to.deep.equal({});
      expect(filteredSitemapUrls1).to.deep.equal([]);

      // Test case 2: details is undefined
      const siteMapUrlsResult2 = {
        success: true,
        reasons: [{ value: 'Test scenario' }],
        details: undefined,
      };

      const extractedPaths2 = siteMapUrlsResult2.details?.extractedPaths || {};
      const filteredSitemapUrls2 = siteMapUrlsResult2.details?.filteredSitemapUrls || [];

      expect(extractedPaths2).to.deep.equal({});
      expect(filteredSitemapUrls2).to.deep.equal([]);

      // Test case 3: details is null
      const siteMapUrlsResult3 = {
        success: true,
        reasons: [{ value: 'Test scenario' }],
        details: null,
      };

      const extractedPaths3 = siteMapUrlsResult3.details?.extractedPaths || {};
      const filteredSitemapUrls3 = siteMapUrlsResult3.details?.filteredSitemapUrls || [];

      expect(extractedPaths3).to.deep.equal({});
      expect(filteredSitemapUrls3).to.deep.equal([]);

      // Now use esmock to test the actual findSitemap function with these conditions
      const esmock = (await import('esmock')).default;

      const mockedSitemapHandler = await esmock('../../src/sitemap/handler.js', {
        '../../src/sitemap/common.js': {
          getSitemapUrls: async () => siteMapUrlsResult1,
          ERROR_CODES,
        },
      });

      const result = await mockedSitemapHandler.findSitemap(url);
      expect(result.success).to.equal(false);
      expect(result.reasons[0].error).to.equal(ERROR_CODES.NO_VALID_PATHS_EXTRACTED);
    });
  });

  describe('classifySuggestions', () => {
    const auditAllGood = {
      siteId: 'site-id',
      auditId: 'audit-id',
      auditResult: {
        success: true,
        reasons: [
          {
            value: 'Sitemaps found and checked.',
          },
        ],
        paths: {
          'https://some-domain.adobe/sitemap.xml': [
            'https://some-domain.adobe/foo',
            'https://some-domain.adobe/bar',
          ],
        },
        url: 'https://some-domain.adobe',
        details: {
          issues: {},
        },
      },
    };

    const auditDataWithSitemapFoundWithPagesButTheyRespondWith404 = {
      siteId: 'site-id',
      id: 'audit-id',
      auditResult: {
        success: false,
        reasons: [
          {
            value:
              'Fetch error for https://maidenform.com/robots.txt Status: 403',
            error: 'NO VALID URLs FOUND IN SITEMAP',
          },
        ],
        scores: {},
      },
    };

    const auditDataWithSitemapFoundWithNoPages = {
      siteId: 'site-id',
      id: 'audit-id',
      auditResult: {
        success: false,
        reasons: [
          {
            value: 'https://some-domain.adobe/sitemap.xml',
            error: 'NO VALID URLs FOUND IN SITEMAP',
          },
        ],
        url: 'https://some-domain.adobe',
        details: {
          issues: {},
        },
      },
    };

    const auditNoSitemapsFound = {
      siteId: 'site-id',
      id: 'audit-id',
      auditResult: {
        success: false,
        reasons: [
          {
            value: 'https://some-domain.adobe/robots.txt',
            error: 'NO SITEMAP FOUND IN ROBOTS',
          },
        ],
        details: {
          issues: [
            {
              url: 'https://some-domain.adobe/sitemap.xml',
            },
            {
              url: 'https://some-domain.adobe/sitemap_index.xml',
            },
          ],
        },
      },
    };

    const auditPartiallySuccessfulOnePageNetworkError = {
      siteId: 'site-id',
      id: 'audit-id',
      auditResult: {
        success: true,
        reasons: [
          {
            value: 'Sitemaps found and checked.',
          },
        ],
        paths: {
          'https://some-domain.adobe/sitemap.xml': [
            'https://some-domain.adobe/foo',
          ],
        },
        url: 'https://some-domain.adobe',
        details: {
          issues: {
            'https://some-domain.adobe/sitemap.xml': [
              {
                url: 'https://some-domain.adobe/bar',
              },
            ],
          },
        },
      },
    };

    it('should return empty suggestions when all is ok', async () => {
      const response = generateSuggestions(url, auditAllGood, context);
      expect(response.suggestions.length).to.equal(0);
      expect(response).to.deep.equal({ ...auditAllGood, suggestions: [] });
    });

    it('should report that the expected default sitemap path contains no urls', async () => {
      const response = generateSuggestions(
        url,
        auditDataWithSitemapFoundWithNoPages,
        context,
      );
      expect(response.suggestions.length).to.equal(1);
      expect(response.suggestions[0].type).to.equal('error');
      expect(response.suggestions[0].error).to.equal(
        ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
      );
      expect(response).to.deep.equal({
        ...auditDataWithSitemapFoundWithNoPages,
        suggestions: [
          {
            type: 'error',
            error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
            recommendedAction:
              'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
          },
        ],
      });
    });

    it('should report that the expected default sitemap path contains only urls that are not found', async () => {
      const response = generateSuggestions(
        url,
        auditDataWithSitemapFoundWithPagesButTheyRespondWith404,
        context,
      );
      expect(response.suggestions.length).to.equal(1);
      expect(response.suggestions[0].type).to.equal('error');
      expect(response.suggestions[0].error).to.equal(
        ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
      );
      expect(response).to.deep.equal({
        ...auditDataWithSitemapFoundWithPagesButTheyRespondWith404,
        suggestions: [
          {
            type: 'error',
            error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
            recommendedAction:
              'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
          },
        ],
      });
    });

    it('should report that there are no sitemaps defined in robots.txt and in the fallback', async () => {
      const response = generateSuggestions(url, auditNoSitemapsFound, context);
      expect(response.suggestions.length).to.equal(1);
      expect(response.suggestions[0].type).to.equal('error');
      expect(response.suggestions[0].error).to.equal(
        ERROR_CODES.NO_SITEMAP_IN_ROBOTS,
      );
      expect(response).to.deep.equal({
        ...auditNoSitemapsFound,
        suggestions: [
          {
            type: 'error',
            error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS,
            recommendedAction:
              'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
          },
        ],
      });
    });

    it('should present a suggestion even if the audit is successful as long as there are pages with issues', async () => {
      const sitemap = Object.keys(
        auditPartiallySuccessfulOnePageNetworkError.auditResult.paths,
      )[0];
      const response = generateSuggestions(
        url,
        auditPartiallySuccessfulOnePageNetworkError,
        context,
      );
      expect(response.suggestions.length).to.equal(1);
      expect(response.suggestions[0].type).to.equal('url');
      expect(response.suggestions[0].sitemapUrl).to.equal(sitemap);
      expect(response.suggestions[0].pageUrl).to.equal(
        auditPartiallySuccessfulOnePageNetworkError.auditResult.details.issues[
          sitemap
        ][0].url,
      );
      expect(response.suggestions[0].statusCode).to.equal(0);
      expect(response).to.deep.equal({
        ...auditPartiallySuccessfulOnePageNetworkError,
        suggestions: [
          {
            type: 'url',
            sitemapUrl: sitemap,
            pageUrl:
              auditPartiallySuccessfulOnePageNetworkError.auditResult.details
                .issues[sitemap][0].url,
            statusCode: 0,
            recommendedAction:
              'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
          },
        ],
      });
    });

    it('should create redirect recommendation when urlsSuggested is present', () => {
      const auditDataWithRedirect = {
        siteId: 'site-id',
        id: 'audit-id',
        auditResult: {
          success: true,
          reasons: [{ value: 'Sitemaps found and checked.' }],
          details: {
            issues: {
              'https://example.com/sitemap.xml': [
                {
                  url: 'https://example.com/old-page',
                  statusCode: 301,
                  urlsSuggested: 'https://example.com/new-page',
                },
              ],
            },
          },
        },
      };

      const response = generateSuggestions(
        'https://example.com',
        auditDataWithRedirect,
        context,
      );
      expect(response.suggestions).to.have.lengthOf(1);
      expect(response.suggestions[0]).to.deep.include({
        type: 'url',
        sitemapUrl: 'https://example.com/sitemap.xml',
        pageUrl: 'https://example.com/old-page',
        statusCode: 301,
        urlsSuggested: 'https://example.com/new-page',
        recommendedAction: 'use this url instead: https://example.com/new-page',
      });
    });
  });

  describe('opportunityAndSuggestions', () => {
    let auditDataFailure;
    let auditDataSuccess;
    let auditDataWithSuggestions;

    beforeEach(() => {
      auditDataFailure = {
        siteId: 'site-id',
        id: 'audit-id',
        auditResult: {
          success: false,
          reasons: [
            {
              value: 'https://some-domain.adobe/sitemap.xml',
              error: 'NO VALID URLs FOUND IN SITEMAP',
            },
          ],
          url: 'https://some-domain.adobe',
          details: {
            issues: {
              'https://some-domain.adobe/sitemap.xml': [
                {
                  url: 'https://some-domain.adobe/foo',
                  statusCode: 404,
                },
                {
                  url: 'https://some-domain.adobe/bar',
                  statusCode: 404,
                },
              ],
            },
          },
        },
        suggestions: [
          {
            type: 'error',
            error: 'NO VALID URLs FOUND IN SITEMAP',
            recommendedAction:
              'remove_page_from_sitemap_or_fix_page_redirect_or_make_it_accessible',
          },
          {
            type: 'url',
            sitemapUrl: 'https://some-domain.adobe/sitemap.xml',
            pageUrl: 'https://some-domain.adobe/foo',
            statusCode: 404,
            recommendedAction:
              'remove_page_from_sitemap_or_fix_page_redirect_or_make_it_accessible',
          },
          {
            type: 'url',
            sitemapUrl: 'https://some-domain.adobe/sitemap.xml',
            pageUrl: 'https://some-domain.adobe/bar',
            statusCode: 404,
            recommendedAction:
              'remove_page_from_sitemap_or_fix_page_redirect_or_make_it_accessible',
          },
        ],
      };

      auditDataWithSuggestions = {
        ...JSON.parse(JSON.stringify(auditDataFailure)),
        auditResult: {
          ...JSON.parse(JSON.stringify(auditDataFailure.auditResult)),
          success: true,
        },
      };

      auditDataSuccess = {
        siteId: 'site-id',
        auditId: 'audit-id',
        auditResult: {
          success: true,
          reasons: [
            {
              value: 'Sitemaps found and checked.',
            },
          ],
          paths: {
            'https://some-domain.adobe/sitemap.xml': [
              'https://some-domain.adobe/foo',
              'https://some-domain.adobe/bar',
            ],
          },
          url: 'https://some-domain.adobe',
          details: {
            issues: {},
          },
        },
        suggestions: [],
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should skip opportunity creation when audit result success is false', async () => {
      if (context.dataAccess.Opportunity.create.resetHistory) {
        context.dataAccess.Opportunity.create.resetHistory();
      }

      await opportunityAndSuggestions(
        'https://example.com',
        auditDataFailure,
        context,
      );

      expect(context.log.info).to.have.been.calledWith(
        'Sitemap audit failed, skipping opportunity and suggestions creation',
      );
      // Check that the existing stubs weren't called
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(context.dataAccess.Opportunity.addSuggestions).to.not.have.been.called;
    });

    it('should handle errors when creating opportunity', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([
        context.dataAccess.Opportunity,
      ]);
      context.dataAccess.Opportunity.create.rejects(
        new Error('Creation failed'),
      );

      await expect(
        opportunityAndSuggestions(
          'https://example.com',
          auditDataWithSuggestions,
          context,
        ),
      ).to.be.rejectedWith('Creation failed');

      expect(context.log.error).to.have.been.calledWith(
        'Failed to create new opportunity for siteId site-id and auditId audit-id: Creation failed',
      );
    });

    it('should not create opportunity when there are no suggestions', async () => {
      const mockOpportunity = {
        getType: () => 'sitemap',
        getId: () => 'oppty-id',
        setAuditId: sinon.stub(),
        save: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves([]),
        addSuggestions: sinon.stub().resolves({ createdItems: [] }),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([
        mockOpportunity,
      ]);
      await opportunityAndSuggestions(
        'https://example.com',
        auditDataSuccess,
        context,
      );

      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(mockOpportunity.addSuggestions).to.not.have.been.called;
    });

    it('should create a new opportunity when there is not an existing one', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(
        context.dataAccess.Opportunity,
      );
      context.dataAccess.Opportunity.getSuggestions.resolves([]);
      context.dataAccess.Opportunity.addSuggestions.resolves({
        createdItems: [],
      });

      await opportunityAndSuggestions(
        'https://example.com',
        auditDataWithSuggestions,
        context,
      );

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(
        {
          siteId: 'site-id',
          auditId: 'audit-id',
          runbook:
            'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Sitemap_Runbook.docx?d=w6e82533ac43841949e64d73d6809dff3&csf=1&web=1&e=GDaoxS',
          type: 'sitemap',
          origin: 'AUTOMATION',
          title: 'Sitemap issues found',
          description: '',
          guidance: {
            steps: [
              'Verify each URL in the sitemap, identifying any that do not return a 200 (OK) status code.',
              'Check RUM data to identify any sitemap pages with unresolved 3xx, 4xx or 5xx status codes – it should be none of them.',
            ],
          },
          tags: ['Traffic Acquisition'],
          data: {
            dataSources: [DATA_SOURCES.SITE],
          },
        },
      );
    });

    it('should handle updating when opportunity was already defined', async () => {
      const opptyId = 'oppty-id';
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([
        context.dataAccess.Opportunity,
      ]);
      context.dataAccess.Opportunity.getType.returns('sitemap');
      context.dataAccess.Opportunity.getId.returns(opptyId);
      context.dataAccess.Opportunity.save.resolves();
      context.dataAccess.Opportunity.getSuggestions.resolves([]);
      context.dataAccess.Opportunity.addSuggestions.resolves({
        createdItems: auditDataWithSuggestions.suggestions,
      });
      await opportunityAndSuggestions(
        'https://example.com',
        auditDataWithSuggestions,
        context,
      );

      expect(
        context.dataAccess.Opportunity.setAuditId,
      ).to.have.been.calledOnceWith('audit-id');
      expect(context.dataAccess.Opportunity.save).to.have.been.calledOnce;
      expect(
        context.dataAccess.Opportunity.addSuggestions,
      ).to.have.been.calledOnceWith(
        auditDataWithSuggestions.suggestions.map((suggestion) => ({
          opportunityId: opptyId,
          type: 'REDIRECT_UPDATE',
          rank: 0,
          data: suggestion,
        })),
      );
    });

    it('should handle updating when opportunity was already defined with new suggestions', async () => {
      const opptyId = 'oppty-id';
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([
        context.dataAccess.Opportunity,
      ]);
      context.dataAccess.Opportunity.getType.returns('sitemap');
      context.dataAccess.Opportunity.getId.returns(opptyId);
      context.dataAccess.Opportunity.save.resolves();
      const suggestionData = {
        type: 'url',
        sitemapUrl: 'https://some-domain2.adobe/sitemap.xml',
        pageUrl: 'https://some-domain2.adobe/foo',
        statusCode: 404,
        recommendedAction:
          'remove_page_from_sitemap_or_fix_page_redirect_or_make_it_accessible',
      };
      const existingSuggestions = [
        {
          id: '1',
          data: suggestionData,
          remove: sinon.stub(),
          getData: sinon.stub().returns(suggestionData),
          setData: sinon.stub(),
          save: sinon.stub().resolves(),
          getStatus: sinon.stub().returns('NEW'),
        },
      ];
      context.dataAccess.Opportunity.getSuggestions.resolves(existingSuggestions);
      context.dataAccess.Opportunity.addSuggestions.resolves({
        createdItems: auditDataWithSuggestions.suggestions,
      });
      await opportunityAndSuggestions(
        'https://example.com',
        auditDataWithSuggestions,
        context,
      );

      expect(
        context.dataAccess.Opportunity.setAuditId,
      ).to.have.been.calledOnceWith('audit-id');
      expect(context.dataAccess.Opportunity.save).to.have.been.calledOnce;
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(existingSuggestions, 'OUTDATED');
      expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnceWith(
        auditDataWithSuggestions.suggestions.map((suggestion) => ({
          opportunityId: opptyId,
          type: 'REDIRECT_UPDATE',
          rank: 0,
          data: suggestion,
        })),
      );
    });
  });
});

describe('getSitemapsWithIssues', () => {
  it('should return empty array when no issues exist', () => {
    const auditData = {
      auditResult: {
        details: {
          issues: {},
        },
      },
    };
    expect(getSitemapsWithIssues(auditData)).to.deep.equal([]);
  });

  it('should return empty array when details is undefined', () => {
    const auditData = {
      auditResult: {},
    };
    expect(getSitemapsWithIssues(auditData)).to.deep.equal([]);
  });
});

describe('filterValidUrls with redirect handling', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it('should return empty arrays when given no URLs', async () => {
    const result = await filterValidUrls([]);
    expect(result).to.deep.equal({
      ok: [],
      notOk: [],
      networkErrors: [],
      otherStatusCodes: [],
    });
  });

  it('should capture final redirect URLs for 301/302 responses', async () => {
    const urls = [
      'https://example.com/ok',
      'https://example.com/permanent-redirect',
      'https://example.com/temporary-redirect',
      'https://example.com/not-found',
    ];

    nock('https://example.com').head('/ok').reply(200);
    nock('https://example.com')
      .head('/permanent-redirect')
      .reply(301, '', { Location: 'https://example.com/new-location' });
    nock('https://example.com')
      .head('/permanent-redirect')
      .reply(301, '', { Location: 'https://example.com/new-location' });
    nock('https://example.com').head('/new-location').reply(200);

    nock('https://example.com')
      .head('/temporary-redirect')
      .reply(302, '', { Location: 'https://example.com/temp-location' });
    nock('https://example.com')
      .head('/temporary-redirect')
      .reply(302, '', { Location: 'https://example.com/temp-location' });
    nock('https://example.com').head('/temp-location').reply(200);
    nock('https://example.com').head('/not-found').reply(404);

    const result = await filterValidUrls(urls);

    expect(result.ok).to.deep.equal(['https://example.com/ok']);
    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/permanent-redirect',
        statusCode: 301,
        urlsSuggested: 'https://example.com/new-location',
      },
      {
        url: 'https://example.com/temporary-redirect',
        statusCode: 302,
        urlsSuggested: 'https://example.com/temp-location',
      },
      {
        url: 'https://example.com/not-found',
        statusCode: 404,
      },
    ]);
  });

  it('should suggest homepage URL for redirects to 404 status pages', async () => {
    const urls = [
      'https://example.com/redirect-to-404',
      'https://example.com/redirect-to-200',
      'https://example.com/redirect-to-404-custom-path',
      'https://subdomain.example.com/redirect-to-404',
    ];

    // Redirect to a page that returns 404
    nock('https://example.com')
      .head('/redirect-to-404')
      .reply(301, '', { Location: 'https://example.com/not-found' });
    nock('https://example.com').head('/not-found').reply(404);

    // Redirect to a page that returns 200
    nock('https://example.com')
      .head('/redirect-to-200')
      .reply(302, '', { Location: 'https://example.com/valid-page' });
    nock('https://example.com').head('/valid-page').reply(200);

    // Redirect to a URL that contains '404.html' in the path
    nock('https://example.com')
      .head('/redirect-to-404-custom-path')
      .reply(301, '', { Location: 'https://example.com/errors/404.html' });
    nock('https://example.com').head('/errors/404.html').reply(200); // Even with 200 response, path detection should work

    // Test with subdomain
    nock('https://subdomain.example.com')
      .head('/redirect-to-404')
      .reply(302, '', { Location: 'https://subdomain.example.com/not-found' });
    nock('https://subdomain.example.com').head('/not-found').reply(404);

    const result = await filterValidUrls(urls);

    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/redirect-to-404',
        statusCode: 301,
        urlsSuggested: 'https://example.com',
      },
      {
        url: 'https://example.com/redirect-to-200',
        statusCode: 302,
        urlsSuggested: 'https://example.com/valid-page',
      },
      {
        url: 'https://example.com/redirect-to-404-custom-path',
        statusCode: 301,
        urlsSuggested: 'https://example.com',
      },
      {
        url: 'https://subdomain.example.com/redirect-to-404',
        statusCode: 302,
        urlsSuggested: 'https://subdomain.example.com',
      },
    ]);
  });

  it('should handle failed redirect follows with 404 detection', async () => {
    const urls = ['https://example.com/broken-redirect'];

    // First request succeeds with redirect
    nock('https://example.com')
      .head('/broken-redirect')
      .reply(301, '', { Location: 'https://example.com/error' });

    // Second request fails with network error
    nock('https://example.com')
      .head('/error')
      .replyWithError('Network error');

    const result = await filterValidUrls(urls);

    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/broken-redirect',
        urlsSuggested: 'https://example.com/error',
        statusCode: 301,
      },
    ]);
  });

  it('should handle network errors and add them to networkErrors array', async () => {
    const urls = [
      'https://example.com/network-error',
      'https://example.com/ok',
      'https://example.com/another-error',
    ];

    nock('https://example.com')
      .head('/network-error')
      .replyWithError('Network error');

    nock('https://example.com').head('/ok').reply(200);

    nock('https://example.com')
      .head('/another-error')
      .replyWithError('DNS error');

    const result = await filterValidUrls(urls);

    expect(result.ok).to.deep.equal(['https://example.com/ok']);
    expect(result.notOk).to.deep.equal([]);
    expect(result.networkErrors).to.deep.equal([
      {
        url: 'https://example.com/network-error',
        error: 'NETWORK_ERROR',
      },
      {
        url: 'https://example.com/another-error',
        error: 'NETWORK_ERROR',
      },
    ]);
  });

  it('should handle mixed responses including network errors, redirects and success', async () => {
    const urls = [
      'https://example.com/ok',
      'https://example.com/redirect',
      'https://example.com/network-error',
      'https://example.com/not-found',
    ];

    nock('https://example.com').head('/ok').reply(200);

    nock('https://example.com')
      .head('/redirect')
      .reply(301, '', { Location: 'https://example.com/new-location' });

    nock('https://example.com').head('/new-location').reply(200);

    nock('https://example.com')
      .head('/network-error')
      .replyWithError('Network error');

    nock('https://example.com').head('/not-found').reply(404);

    const result = await filterValidUrls(urls);

    expect(result.ok).to.deep.equal(['https://example.com/ok']);
    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/redirect',
        statusCode: 301,
        urlsSuggested: 'https://example.com/new-location',
      },
      {
        url: 'https://example.com/not-found',
        statusCode: 404,
      },
    ]);
    expect(result.networkErrors).to.deep.equal([
      {
        url: 'https://example.com/network-error',
        error: 'NETWORK_ERROR',
      },
    ]);
  });

  it('should handle batch processing with network errors', async () => {
    // Create an array of 60 URLs (exceeds batchSize of 50)
    const urls = Array.from(
      { length: 60 },
      (_, i) => `https://example.com/url${i + 1}`,
    );

    // Mock responses for all URLs
    urls.forEach((url, i) => {
      if (i % 3 === 0) {
        // Every third URL is a network error
        nock('https://example.com')
          .head(`/url${i + 1}`)
          .replyWithError('Network error');
      } else if (i % 3 === 1) {
        // Every other third URL is OK
        nock('https://example.com')
          .head(`/url${i + 1}`)
          .reply(200);
      } else {
        nock('https://example.com')
          .head(`/url${i + 1}`)
          .reply(404);
      }
    });

    const result = await filterValidUrls(urls);

    expect(result.ok.length).to.equal(20); // Only OK URLs
    expect(result.notOk.length).to.equal(20);
    expect(result.networkErrors.length).to.equal(20);

    result.networkErrors.forEach((error) => {
      expect(error).to.have.property('url');
      expect(error).to.have.property('error', 'NETWORK_ERROR');
    });
  });

  it('should not flag redirects to login pages as issues', async () => {
    const urls = [
      'https://example.com/myaccount',
      'https://example.com/profile',
      'https://example.com/cart/checkout',
      'https://example.com/normal-redirect',
    ];

    // Redirect to login pages
    nock('https://example.com')
      .head('/myaccount')
      .reply(302, '', { Location: 'https://example.com/login.html' });

    nock('https://example.com')
      .head('/profile')
      .reply(302, '', { Location: 'https://example.com/signin' });

    nock('https://example.com')
      .head('/cart/checkout')
      .reply(302, '', { Location: 'https://example.com/auth/user' });

    // Normal redirect to non-login page
    nock('https://example.com')
      .head('/normal-redirect')
      .reply(302, '', { Location: 'https://example.com/some-page' });

    nock('https://example.com').head('/some-page').reply(200);

    const result = await filterValidUrls(urls);

    // login redirects should be treated as OK
    expect(result.ok).to.include('https://example.com/myaccount');
    expect(result.ok).to.include('https://example.com/profile');
    expect(result.ok).to.include('https://example.com/cart/checkout');

    // normal redirects should still be in notOk
    expect(result.notOk).to.deep.include({
      url: 'https://example.com/normal-redirect',
      statusCode: 302,
      urlsSuggested: 'https://example.com/some-page',
    });
  });

  it('should suggest homepage for redirects with no location header', async () => {
    const urls = ['https://example.com/redirect-no-location'];
    nock('https://example.com')
      .head('/redirect-no-location')
      .reply(301, ''); // No location header
    const result = await filterValidUrls(urls);
    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/redirect-no-location',
        statusCode: 301,
        urlsSuggested: 'https://example.com',
      },
    ]);
  });
});

describe('getPagesWithIssues', () => {
  it('should include urlsSuggested in the output when present in the input', () => {
    const auditData = {
      auditResult: {
        details: {
          issues: {
            'https://example.com/sitemap.xml': [
              {
                url: 'https://example.com/old-page',
                statusCode: 301,
                urlsSuggested: 'https://example.com/new-page',
              },
              {
                url: 'https://example.com/not-found',
                statusCode: 404,
              },
            ],
          },
        },
      },
    };

    const result = getPagesWithIssues(auditData);
    expect(result).to.have.lengthOf(2);
    expect(result[0]).to.deep.equal({
      type: 'url',
      sitemapUrl: 'https://example.com/sitemap.xml',
      pageUrl: 'https://example.com/old-page',
      statusCode: 301,
      urlsSuggested: 'https://example.com/new-page',
    });
    expect(result[1]).to.deep.equal({
      type: 'url',
      sitemapUrl: 'https://example.com/sitemap.xml',
      pageUrl: 'https://example.com/not-found',
      statusCode: 404,
    });
  });

  it('should handle empty issues array', () => {
    const auditData = {
      auditResult: {
        details: {
          issues: {},
        },
      },
    };
    expect(getPagesWithIssues(auditData)).to.deep.equal([]);
  });
});

describe('filterValidUrls with status code tracking', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it('should only track specified status codes (301, 302, 404)', async () => {
    const urls = [
      'https://example.com/ok',
      'https://example.com/permanent-redirect',
      'https://example.com/temp-redirect',
      'https://example.com/not-found',
      'https://example.com/server-error',
      'https://example.com/forbidden',
    ];

    nock('https://example.com').head('/ok').reply(200);
    nock('https://example.com')
      .head('/permanent-redirect')
      .reply(301, '', { Location: 'https://example.com/new' });
    nock('https://example.com')
      .head('/temp-redirect')
      .reply(302, '', { Location: 'https://example.com/temp' });
    nock('https://example.com').head('/not-found').reply(404);
    nock('https://example.com').head('/server-error').reply(500);
    nock('https://example.com').head('/forbidden').reply(403);

    const result = await filterValidUrls(urls);

    expect(result.ok).to.deep.equal(['https://example.com/ok']);

    // Should only include tracked status codes in notOk array
    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/permanent-redirect',
        statusCode: 301,
        urlsSuggested: 'https://example.com/new',
      },
      {
        url: 'https://example.com/temp-redirect',
        statusCode: 302,
        urlsSuggested: 'https://example.com/temp',
      },
      {
        url: 'https://example.com/not-found',
        statusCode: 404,
      },
    ]);

    // Should not include untracked status codes (500, 403) in notOk array
    expect(result.notOk.some((item) => item.statusCode === 500)).to.be.false;
    expect(result.notOk.some((item) => item.statusCode === 403)).to.be.false;
  });

  it('should suggest homepage for redirects to 404 patterns and final URL for normal redirects', async () => {
    const urls = [
      'https://example.com/redirect-to-404-page',
      'https://example.com/redirect-to-404-path',
      'https://example.com/redirect-to-errors-404',
      'https://example.com/normal-redirect',
    ];

    // Mock redirects to URLs with 404 patterns
    nock('https://example.com')
      .head('/redirect-to-404-page')
      .reply(301, '', { Location: 'https://example.com/404.html' });

    nock('https://example.com')
      .head('/redirect-to-404-path')
      .reply(301, '', { Location: 'https://example.com/404/not-found' });

    nock('https://example.com')
      .head('/redirect-to-errors-404')
      .reply(301, '', { Location: 'https://example.com/errors/404/page' });

    // Mock normal redirect
    nock('https://example.com')
      .head('/normal-redirect')
      .reply(301, '', { Location: 'https://example.com/valid-page' });

    const result = await filterValidUrls(urls);

    expect(result.notOk).to.have.length(4);

    // Redirects to 404 patterns should suggest homepage URL
    const redirectsTo404 = result.notOk.filter(
      (item) => item.url.includes('redirect-to-404')
        || item.url.includes('redirect-to-errors-404'),
    );

    redirectsTo404.forEach((item) => {
      expect(item.statusCode).to.equal(301);
      expect(item.urlsSuggested).to.equal('https://example.com');
    });

    // Normal redirect should suggest the final URL
    const normalRedirect = result.notOk.find((item) => item.url.includes('normal-redirect'));
    expect(normalRedirect.statusCode).to.equal(301);
    expect(normalRedirect.urlsSuggested).to.equal('https://example.com/valid-page');
  });
});

describe('filterValidUrls with HEAD to GET fallback', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  it('should fallback to GET when HEAD returns 404 but GET returns 200', async () => {
    const urls = ['https://example.com/head-404-get-200'];

    // HEAD returns 404, but GET returns 200
    nock('https://example.com').head('/head-404-get-200').reply(404);
    nock('https://example.com').get('/head-404-get-200').reply(200);

    const result = await filterValidUrls(urls);

    expect(result.ok).to.deep.equal(['https://example.com/head-404-get-200']);
    expect(result.notOk).to.be.empty;
  });

  it('should still return 404 when both HEAD and GET return 404', async () => {
    const urls = ['https://example.com/truly-not-found'];

    // Both HEAD and GET return 404
    nock('https://example.com').head('/truly-not-found').reply(404);
    nock('https://example.com').get('/truly-not-found').reply(404);

    const result = await filterValidUrls(urls);

    expect(result.ok).to.be.empty;
    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/truly-not-found',
        statusCode: 404,
      },
    ]);
  });

  it('should not fallback to GET when HEAD returns non-404 status', async () => {
    const urls = ['https://example.com/head-403'];

    // HEAD returns 403, no GET fallback should happen
    nock('https://example.com').head('/head-403').reply(403);

    const result = await filterValidUrls(urls);

    expect(result.ok).to.be.empty;
    expect(result.notOk).to.be.empty;
    expect(result.otherStatusCodes).to.deep.equal([
      {
        url: 'https://example.com/head-403',
        statusCode: 403,
      },
    ]);
  });

  it('should apply HEAD to GET fallback for redirect URL validation', async () => {
    const urls = ['https://example.com/redirect-to-head-404-get-200'];

    // Original URL redirects
    nock('https://example.com')
      .head('/redirect-to-head-404-get-200')
      .reply(301, '', { Location: 'https://example.com/target-page' });

    // Target page returns 404 for HEAD but 200 for GET
    nock('https://example.com').head('/target-page').reply(404);
    nock('https://example.com').get('/target-page').reply(200);

    const result = await filterValidUrls(urls);

    expect(result.notOk).to.deep.equal([
      {
        url: 'https://example.com/redirect-to-head-404-get-200',
        statusCode: 301,
        urlsSuggested: 'https://example.com/target-page',
      },
    ]);
  });
});
