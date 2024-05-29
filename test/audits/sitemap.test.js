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

import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import chaiAsPromised from 'chai-as-promised';
import {
  checkSitemap,
  ERROR_CODES,
  findSitemap,
  isSitemapContentValid,
  checkRobotsForSitemap, sitemapAuditRunner, fetchContent, getBaseUrlPagesFromSitemaps,
} from '../../src/sitemap/handler.js';
import { extractDomainAndProtocol } from '../../src/support/utils.js';
import { MockContextBuilder } from '../shared.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;
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

  let topPagesResponse;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(message);

    nock(url)
      .get('/sitemap_foo.xml')
      .reply(200, sampleSitemap);
    nock(url)
      .get('/sitemap_bar.xml')
      .reply(200, sampleSitemapTwo);

    topPagesResponse = {
      result: {
        pages: [
          {
            url: `${url}/foo`,
            sum_traffic: 100,
          },
          {
            url: `${url}/bar`,
            sum_traffic: 200,
          },
          {
            url: `${url}/baz`,
            sum_traffic: 300,
          },
          {
            url: `${url}/cux`,
            sum_traffic: 400,
          },
        ],
      },
    };
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
        .reply(200, `Sitemap: ${url}/sitemap_foo.xml\nSitemap: ${url}/sitemap_bar.xml`);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          success: true,
          paths: {
            [`${url}/sitemap_foo.xml`]: [`${url}/foo`, `${url}/bar`],
            [`${url}/sitemap_bar.xml`]: [`${url}/baz`, `${url}/cux`],
          },
          reasons: [{
            value: 'Sitemaps found and validated successfully.',
          }],
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
      nock(url)
        .get('/sitemap_index.xml')
        .reply(200, sitemapIndex);
      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          success: true,
          paths: {
            [`${url}/sitemap_foo.xml`]: [`${url}/foo`, `${url}/bar`],
            [`${url}/sitemap_bar.xml`]: [`${url}/baz`, `${url}/cux`],
          },
          reasons: [{
            value: 'Sitemaps found and validated successfully.',
          }],
          url,
        },
        fullAuditRef: url,
        url,
      });
    });

    it('runs successfully for text sitemap extracted from robots.txt', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap_foo.txt\nSitemap: ${url}/sitemap_bar.txt`);

      nock(url)
        .get('/sitemap_foo.txt')
        .reply(200, `${url}/foo\n${url}/bar`, { 'content-type': 'text/plain' });
      nock(url)
        .get('/sitemap_bar.txt')
        .reply(200, `${url}/baz\n${url}/cux`, { 'content-type': 'text/plain' });

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          success: true,
          paths: {
            [`${url}/sitemap_foo.txt`]: [`${url}/foo`, `${url}/bar`],
            [`${url}/sitemap_bar.txt`]: [`${url}/baz`, `${url}/cux`],
          },
          reasons: [{
            value: 'Sitemaps found and validated successfully.',
          }],
          url,
        },
        fullAuditRef: url,
        url,
      });
    });

    it('runs successfully for common sitemap url when robots.txt is not available', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(404);

      nock(url)
        .head('/sitemap_index.xml')
        .reply(404);

      nock(url)
        .head('/sitemap.xml')
        .reply(200);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, sampleSitemap);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          success: true,
          paths: {
            [`${url}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
          },
          reasons: [
            {
              error: ERROR_CODES.FETCH_ERROR,
              value: `Error fetching or processing robots.txt: Failed to fetch content from ${url}/robots.txt. Status: 404`,
            },
            {
              value: 'Sitemaps found and validated successfully.',
            },
          ],
          url,
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
          success: false,
          reasons: [
            {
              error: ERROR_CODES.FETCH_ERROR,
              value: `Error fetching or processing robots.txt: Failed to fetch content from ${url}/robots.txt. Status: 404`,
            },
            {
              error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS,
              value: `No sitemap found in robots.txt or common paths for ${url}`,
            },
          ],
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
      nock(url)
        .get('/test')
        .reply(200, mockResponse.payload, { 'content-type': mockResponse.type });

      const result = await fetchContent(`${url}/test`);
      expect(result).to.eql(mockResponse);
    });

    it('should throw error when response is not successful', async () => {
      nock(url)
        .get('/test')
        .reply(404);
      await expect(fetchContent(`${url}/test`)).to.be.rejectedWith(`Failed to fetch content from ${url}/test. Status: 404`);
    });
  });

  describe('checkRobotsForSitemap', () => {
    it('should return error when no sitemap found in robots.txt', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, 'Allow: /');

      const { paths, reasons } = await checkRobotsForSitemap(protocol, domain);
      expect(paths).to.eql([]);
      expect(reasons).to.deep.equal([ERROR_CODES.NO_SITEMAP_IN_ROBOTS]);
    });

    it('should return error when unable to fetch robots.txt', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(404);

      await expect(checkRobotsForSitemap(protocol, domain)).to.be.rejectedWith(`Failed to fetch content from ${url}/robots.txt. Status: 404`);
    });
  });

  describe('isSitemapContentValid', () => {
    it('should return true for valid sitemap content', () => {
      const sitemapContent = { payload: '<?xml', type: 'application/xml' };
      expect(isSitemapContentValid(sitemapContent)).to.be.true;
    });

    it('should return true for valid sitemap content when xml', () => {
      const sitemapContent = {
        payload: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
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
        payload: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
          + '    <url><loc>https://www.adobe.com/</loc></url>\n'
          + '      </urlset>',
        type: 'text/xml',
      };
      expect(isSitemapContentValid(sitemapContent)).to.be.true;
    });
  });

  describe('checkSitemap', () => {
    it('should return SITEMAP_NOT_FOUND when the sitemap does not exist', async () => {
      nock(url)
        .get('/sitemap.xml')
        .reply(404);

      const resp = await checkSitemap(`${url}/sitemap.xml`);
      expect(resp.existsAndIsValid).to.equal(false);
      expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_NOT_FOUND);
    });

    it('should return FETCH_ERROR when there is a network error', async () => {
      nock(url)
        .get('/sitemap.xml')
        .replyWithError('Network error');

      const resp = await checkSitemap(`${url}/sitemap.xml`);
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
      nock(url)
        .get('/non-existent-sitemap.xml')
        .reply(404);

      const result = await checkSitemap(`${url}/non-existent-sitemap.xml`);
      expect(result.existsAndIsValid).to.equal(false);
      expect(result.reasons).to.deep.equal(
        [ERROR_CODES.SITEMAP_NOT_FOUND],
      );
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
      nock(url)
        .get('/sitemap.xml')
        .reply(200, sampleSitemapMoreUrls);
      const result = await getBaseUrlPagesFromSitemaps(url, [`${url}/sitemap.xml`]);
      expect(result).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
      });
    });

    it('should return all pages from sitemap that have the same base url variant', async () => {
      nock(`${protocol}://www.${domain}`)
        .get('/sitemap.xml')
        .reply(200, sampleSitemapMoreUrls);
      const result = await getBaseUrlPagesFromSitemaps(url, [`${protocol}://www.${domain}/sitemap.xml`]);
      expect(result).to.deep.equal({
        [`${protocol}://www.${domain}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
      });
    });

    it('should return all pages from sitemap that include www', async () => {
      nock(`${url}`)
        .get('/sitemap.xml')
        .reply(200, sampleSitemapMoreUrlsWWW);
      const result = await getBaseUrlPagesFromSitemaps(url, [`${url}/sitemap.xml`]);
      expect(result).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${protocol}://www.${domain}/foo`, `${protocol}://www.${domain}/bar`],
      });
    });

    it('should return nothing when sitemap does not contain urls', async () => {
      nock(url)
        .get('/sitemap.xml')
        .reply(200, '<?xml version="1.0" encoding="UTF-8"?>\n'
          + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + '<url></url>\n'
          + '<url></url>\n'
          + '</urlset>');

      const resp = await getBaseUrlPagesFromSitemaps(url, [`${url}/sitemap.xml`]);
      expect(resp).to.deep.equal({});
    });
  });

  describe('findSitemap', () => {
    it('should return error when URL is invalid', async () => {
      const result = await findSitemap('not a valid url');
      expect(result.success).to.equal(false);
      expect(result.reasons).to.deep.equal([{
        error: ERROR_CODES.INVALID_URL,
        value: 'not a valid url',
      }]);
    });

    it('should return success when sitemap is found in robots.txt', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap.xml`);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, sampleSitemap);

      const result = await findSitemap(url);
      expect(result.success).to.equal(true);
      expect(result.paths).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
      });
    });

    it('should return success when sitemap.xml is found', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, 'Allow: /');

      nock(url)
        .head('/sitemap.xml')
        .reply(200);

      nock(url)
        .head('/sitemap_index.xml')
        .reply(200);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, sampleSitemap);

      const result = await findSitemap('https://some-domain.adobe');
      expect(result.success).to.equal(true);
      expect(result.paths).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
      });
    });

    it('should return success when sitemap_index.xml is found', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, 'Allow: /');

      nock(url)
        .head('/sitemap.xml')
        .reply(404);

      nock(url)
        .head('/sitemap_index.xml')
        .reply(200);

      nock(url)
        .get('/sitemap_index.xml')
        .reply(200, sitemapIndex);

      const result = await findSitemap(url);
      expect(result.success).to.equal(true);
      expect(result.paths).to.deep.equal({
        [`${url}/sitemap_foo.xml`]: [`${url}/foo`, `${url}/bar`],
        [`${url}/sitemap_bar.xml`]: [`${url}/baz`, `${url}/cux`],
      });
    });

    it('should return success when sitemap paths have www', async () => {
      nock(`${protocol}://www.${domain}`)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap.xml`);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, sampleSitemapMoreUrlsWWW);

      topPagesResponse.result.pages[0].url = `${protocol}://www.${domain}/foo`;
      topPagesResponse.result.pages[1].url = `${protocol}://www.${domain}/bar`;

      const result = await findSitemap(`${protocol}://www.${domain}`);
      expect(result.success).to.equal(true);
      expect(result.paths).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${protocol}://www.${domain}/foo`, `${protocol}://www.${domain}/bar`],
      });
    });

    it('should return error when no sitemap is found', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, 'Allow: /');

      nock(url)
        .head('/sitemap.xml')
        .reply(404);

      nock(url)
        .head('/sitemap_index.xml')
        .reply(404);

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should return error when no valid paths where extracted from sitemap', async () => {
      const sitemapInvalidPaths = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + '<url> <loc>invalid-url</loc></url>\n'
      + '</urlset>';
      nock(url)
        .get('/robots.txt')
        .reply(200, 'Allow: /');

      nock(url)
        .head('/sitemap.xml')
        .reply(200);

      nock(url)
        .head('/sitemap_index.xml')
        .reply(404);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, sitemapInvalidPaths);

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });
  });
});
