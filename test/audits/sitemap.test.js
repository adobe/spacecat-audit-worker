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
  checkSitemap,
  ERROR_CODES,
  findSitemap,
  isSitemapContentValid,
  checkRobotsForSitemap, sitemapAuditRunner, fetchContent, getBaseUrlPagesFromSitemaps,
  convertToOpportunity, classifyOpportunities, getSitemapsWithIssues, handleClassifiedOpportunity,
} from '../../src/sitemap/handler.js';
import { extractDomainAndProtocol } from '../../src/support/utils.js';
import { MockContextBuilder } from '../shared.js';

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
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(message);

    nock(url)
      .get('/sitemap_foo.xml')
      .reply(200, sampleSitemap);
    nock(url)
      .get('/sitemap_bar.xml')
      .reply(200, sampleSitemapTwo);
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

      nock(url)
        .head('/sitemap_foo.xml')
        .reply(200);

      nock(url)
        .head('/sitemap_bar.xml')
        .reply(200);

      nock(url)
        .head('/foo')
        .reply(200);

      nock(url)
        .head('/bar')
        .reply(200);

      nock(url)
        .head('/baz')
        .reply(200);

      nock(url)
        .head('/cux')
        .reply(200);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          details: {
            issues: {},
          },
          success: true,
          paths: {
            [`${url}/sitemap_foo.xml`]: [`${url}/foo`, `${url}/bar`],
            [`${url}/sitemap_bar.xml`]: [`${url}/baz`, `${url}/cux`],
          },
          reasons: [{
            value: 'Sitemaps found and checked.',
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

      nock(url)
        .head('/sitemap_foo.xml')
        .reply(200);

      nock(url)
        .head('/sitemap_bar.xml')
        .reply(200);

      nock(url)
        .head('/foo')
        .reply(200);

      nock(url)
        .head('/bar')
        .reply(200);

      nock(url)
        .head('/baz')
        .reply(200);

      nock(url)
        .head('/cux')
        .reply(200);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          details: {
            issues: {},
          },
          success: true,
          paths: {
            [`${url}/sitemap_foo.xml`]: [`${url}/foo`, `${url}/bar`],
            [`${url}/sitemap_bar.xml`]: [`${url}/baz`, `${url}/cux`],
          },
          reasons: [{
            value: 'Sitemaps found and checked.',
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

      nock(url)
        .head('/foo')
        .reply(200);

      nock(url)
        .head('/bar')
        .reply(200);

      nock(url)
        .head('/baz')
        .reply(200);

      nock(url)
        .head('/cux')
        .reply(200);

      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          details: {
            issues: {},
          },
          success: true,
          paths: {
            [`${url}/sitemap_foo.txt`]: [`${url}/foo`, `${url}/bar`],
            [`${url}/sitemap_bar.txt`]: [`${url}/baz`, `${url}/cux`],
          },
          reasons: [{
            value: 'Sitemaps found and checked.',
          }],
          url,
        },
        fullAuditRef: url,
        url,
      });
    });

    it('should return 404 when robots.txt not found', async () => {
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
      nock(url)
        .head('/foo')
        .reply(200);
      nock(url)
        .head('/bar')
        .reply(200);
      const result = await sitemapAuditRunner(url, context);
      expect(result).to.eql({
        auditResult: {
          reasons: [
            {
              error: ERROR_CODES.FETCH_ERROR,
              value: 'Fetch error for https://some-domain.adobe/robots.txt Status: 404',
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
              value: 'Fetch error for https://some-domain.adobe/robots.txt Status: 404',
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
      await expect(fetchContent(`${url}/test`)).to.be.rejectedWith('Fetch error for https://some-domain.adobe/test Status: 404');
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

      await expect(checkRobotsForSitemap(protocol, domain)).to.be.rejectedWith('Fetch error for https://some-domain.adobe/robots.txt Status: 404');
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

    it('should return error when no valid pages exist', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap.xml`);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, sampleSitemap);

      nock(url)
        .head('/foo')
        .reply(404);

      nock(url)
        .head('/bar')
        .reply(404);

      const result = await findSitemap(url);

      expect(result.success).to.equal(false);
      expect(result.reasons).to.deep.equal([{
        error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
        value: `${url}/sitemap.xml`,
      }]);
      expect(result.paths).to.be.undefined;
    });

    it('should return success when sitemap is found in robots.txt', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap.xml`);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, sampleSitemap);

      nock(url)
        .head('/foo')
        .reply(200);

      nock(url)
        .head('/bar')
        .reply(200);

      const result = await findSitemap(url);
      expect(result.success).to.equal(true);
      expect(result.paths).to.deep.equal({
        [`${url}/sitemap.xml`]: [`${url}/foo`, `${url}/bar`],
      });
    });

    it('should fail when sitemap contents have a different URL than the base domain (regardless of www. or not)', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, 'Sitemap: ');

      nock(url)
        .get('/sitemap.xml')
        .reply(200, '<?xml version="1.0" encoding="UTF-8"?>\n'
          + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + '<url> <loc>https://another-url.test/baz</loc></url>\n'
          + '</urlset>');

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should fail when robots points to an empty string instead of an actual URI', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, 'Sitemap: ');

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
    });

    it('should fail when sitemap is empty (', async () => {
      nock(url)
        .get('/robots.txt')
        .reply(200, `Sitemap: ${url}/sitemap.xml`);

      nock(url)
        .get('/sitemap.xml')
        .reply(200, () => undefined);

      const result = await findSitemap(url);
      expect(result.success).to.equal(false);
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
        .reply(200, '<?xml version="1.0" encoding="UTF-8"?>\n'
          + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + `<url> <loc>${url}/foo</loc></url>\n`
          + `<url> <loc>${url}/bar</loc></url>\n`
          + `<url> <loc>${url}/baz</loc></url>\n`
          + `<url> <loc>${url}/zzz</loc></url>\n`
          + '</urlset>');

      nock(url)
        .head('/foo')
        .reply(200);

      nock(url)
        .head('/bar')
        .reply(200);

      nock(url)
        .head('/zzz')
        .replyWithError('Network error');

      nock(url)
        .head('/baz')
        .reply(301, '', { Location: `${url}/zzz` });

      const result = await findSitemap('https://some-domain.adobe', {
        info: () => {},
      });
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

      nock(url)
        .head('/sitemap_foo.xml')
        .reply(200);

      nock(url)
        .head('/sitemap_bar.xml')
        .reply(200);

      nock(url)
        .head('/foo')
        .reply(200);

      nock(url)
        .head('/bar')
        .reply(200);

      nock(url)
        .head('/baz')
        .reply(200);

      nock(url)
        .head('/cux')
        .reply(200);

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

      nock(`${protocol}://www.${domain}`)
        .head('/foo')
        .reply(200);

      nock(`${protocol}://www.${domain}`)
        .head('/bar')
        .reply(200);

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

  describe('classifyOpportunities', () => {
    const auditAllGood = {
      siteId: 'site-id',
      auditId: 'audit-id',
      auditResult: {
        success: true,
        reasons: [{
          value: 'Sitemaps found and checked.',
        }],
        paths: {
          'https://some-domain.adobe/sitemap.xml': ['https://some-domain.adobe/foo', 'https://some-domain.adobe/bar'],
        },
        url: 'https://some-domain.adobe',
        details: {
          issues: { },
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
            value: 'Fetch error for https://maidenform.com/robots.txt Status: 403',
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
        reasons: [{
          value: 'https://some-domain.adobe/sitemap.xml',
          error: 'NO VALID URLs FOUND IN SITEMAP',
        }],
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
        reasons: [{
          value: 'https://some-domain.adobe/robots.txt',
          error: 'NO SITEMAP FOUND IN ROBOTS',
        }],
        details: {
          issues: [{
            url: 'https://some-domain.adobe/sitemap.xml',
          }, {
            url: 'https://some-domain.adobe/sitemap_index.xml',
          }],
        },
      },
    };

    const auditPartiallySuccessfulOnePageNetworkError = {
      siteId: 'site-id',
      id: 'audit-id',
      auditResult: {
        success: true,
        reasons: [{
          value: 'Sitemaps found and checked.',
        }],
        paths: {
          'https://some-domain.adobe/sitemap.xml': ['https://some-domain.adobe/foo'],
        },
        url: 'https://some-domain.adobe',
        details: {
          issues: {
            'https://some-domain.adobe/sitemap.xml': [{
              url: 'https://some-domain.adobe/bar',
            }],
          },
        },
      },
    };

    it('should return empty when all is ok', async () => {
      const response = await classifyOpportunities(url, auditAllGood, context.log);
      expect(response.length)
        .to
        .equal(0);
    });

    it('should report that the expected default sitemap path contains no urls', async () => {
      const response = await classifyOpportunities(
        url,
        auditDataWithSitemapFoundWithNoPages,
        context.log,
      );
      expect(response.length).to.equal(1);
      expect(response[0].type).to.equal('sitemap-no-valid-paths-extracted');

      const newData = response[0].getData();
      expect(newData.length).to.equal(1);
      expect(newData[0]).deep.equal({
        sourceSitemapUrl: 'https://some-domain.adobe/sitemap.xml',
        pageUrl: '',
        statusCode: 404,
      });

      const builtKey = response[0].buildKey(newData[0]);
      expect(builtKey).to.equal('site-id|sitemap-no-valid-paths-extracted|https://some-domain.adobe/sitemap.xml');
    });

    it('should report that the expected default sitemap path contains only urls that are not found', async () => {
      const response = await classifyOpportunities(
        url,
        auditDataWithSitemapFoundWithPagesButTheyRespondWith404,
        context.log,
      );
      expect(response.length).to.equal(1);
      expect(response[0].type).to.equal('sitemap-no-valid-paths-extracted');

      const newData = response[0].getData();
      expect(newData.length).to.equal(2);

      expect(newData[0]).deep.equal({
        sourceSitemapUrl: 'https://some-domain.adobe/sitemap.xml',
        pageUrl: 'https://some-domain.adobe/foo',
        statusCode: 404,
      });

      expect(newData[1]).deep.equal({
        sourceSitemapUrl: 'https://some-domain.adobe/sitemap.xml',
        pageUrl: 'https://some-domain.adobe/bar',
        statusCode: 404,
      });

      const baseKey = 'site-id|sitemap-no-valid-paths-extracted|https://some-domain.adobe/sitemap.xml';
      expect(response[0].buildKey(newData[0])).to.equal(`${baseKey}|https://some-domain.adobe/foo`);
      expect(response[0].buildKey(newData[1])).to.equal(`${baseKey}|https://some-domain.adobe/bar`);
    });

    it('should report that there are no sitemaps defined in robots.txt and in the fallback', async () => {
      const response = await classifyOpportunities(url, auditNoSitemapsFound, context.log);
      expect(response.length).to.equal(1);
      expect(response[0].type).to.equal('sitemap-not-available');

      const newData = response[0].getData();
      expect(newData.length).to.equal(1);
      expect(response[0].buildKey(newData[0]))
        .to
        .equal('site-id|sitemap-not-available|https://some-domain.adobe/robots.txt');
    });

    it('should present a opportunity even if the audit is successful as long as there are pages with issues', async () => {
      // eslint-disable-next-line max-len
      const response = await classifyOpportunities(url, auditPartiallySuccessfulOnePageNetworkError, context.log);
      expect(response.length).to.equal(1);
      expect(response[0].type).to.equal('pages-in-sitemap-have-errors');

      const newData = response[0].getData();
      expect(newData.length).to.equal(1);
      expect(response[0].buildKey(newData[0]))
        .to
        .equal('site-id|pages-in-sitemap-have-errors|https://some-domain.adobe/sitemap.xml|https://some-domain.adobe/bar');
    });
  });

  describe('convertToOpportunity', () => {
    let mockDataAccess;
    let mockLog;
    let opportunity;
    let auditDataFailure;
    let auditDataSuccess;
    let otherOpportunity;
    let existingOpportunity;

    beforeEach(() => {
      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
      };

      opportunity = {
        getType: () => 'sitemap-pages-with-issues',
        getId: () => 'oppty-id',
        getSiteId: () => 'site-id',
        addSuggestions: sandbox.stub(),
        getSuggestions: sandbox.stub(),
        setAuditId: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      otherOpportunity = {
        getType: () => 'other',
      };

      mockDataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub(),
          create: sandbox.stub(),
        },
      };

      context = {
        log: mockLog,
        dataAccess: mockDataAccess,
      };

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
              'https://some-domain.adobe/sitemap.xml': [{
                url: 'https://some-domain.adobe/foo',
                statusCode: 404,
              }, {
                url: 'https://some-domain.adobe/bar',
                statusCode: 404,
              }],
            },
          },
        },
      };

      auditDataSuccess = {
        siteId: 'site-id',
        auditId: 'audit-id',
        auditResult: {
          success: true,
          reasons: [{
            value: 'Sitemaps found and checked.',
          }],
          paths: {
            'https://some-domain.adobe/sitemap.xml': ['https://some-domain.adobe/foo', 'https://some-domain.adobe/bar'],
          },
          url: 'https://some-domain.adobe',
          details: {
            issues: { },
          },
        },
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should handle errors when creating opportunity', async () => {
      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([otherOpportunity]);
      mockDataAccess.Opportunity.create.rejects(new Error('Creation failed'));

      await expect(convertToOpportunity('https://example.com', auditDataFailure, context))
        .to.be.rejectedWith('Creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new opportunity for siteId site-id and auditId audit-id: Creation failed',
      );
    });

    it('should not create opportunity when there are no issues', async () => {
      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([otherOpportunity]);
      await convertToOpportunity('https://example.com', auditDataSuccess, context);

      expect(mockDataAccess.Opportunity.create).to.not.have.been.called;
      expect(opportunity.addSuggestions).to.not.have.been.called;
    });

    it('should handle updateing when opportunity was already defined', async () => {
      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([otherOpportunity]);
      mockDataAccess.Opportunity.create.rejects(new Error('Creation failed'));

      await expect(convertToOpportunity('https://example.com', auditDataFailure, context))
        .to.be.rejectedWith('Creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new opportunity for siteId site-id and auditId audit-id: Creation failed',
      );
    });

    it('should handle creating an opportunity is not already defined', async () => {
      existingOpportunity = {
        getType: () => 'sitemap-something-else',
        setAuditId: sandbox.stub(),
        save: sandbox.stub(),
        getId: sandbox.stub(),
        getSuggestions: sandbox.stub(),
        addSuggestions: sandbox.stub(),
      };

      const opp = {
        siteId: 'site-id',
        auditId: 'audit-id',
        type: 'sitemap-pages-not-found',
        title: 'Sitemap pages not found',
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Sitemap_Runbook.docx?d=w6e82533ac43841949e64d73d6809dff3&csf=1&web=1&e=FTWy7t',
        guidance: {
          steps: [
            'Verify each URL in the sitemap, identifying any that do not return a 200 (OK) status code.',
            'Check RUM data to identify any sitemap pages with unresolved 3xx, 4xx or 5xx status codes – it should be none of them.',
          ],
        },
        tags: ['Traffic Acquisition', 'Sitemap'],
        setAuditId: sandbox.stub(),
        save: sandbox.stub(),
        getId: sandbox.stub(),
        getSuggestions: sandbox.stub(),
        addSuggestions: sandbox.stub(),
      };

      opp.getSuggestions.returns([]);
      opp.addSuggestions.returns({
        errorItems: [],
        createdItems: [{ a: 'b' }],
      });
      opp.getId.returns('oppty-id');

      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      mockDataAccess.Opportunity.create.returns(opp);

      await convertToOpportunity('https://example.com', auditDataFailure, context);

      expect(mockLog.error).to.not.have.been.called;
    });

    it('should not create opportunity when there are no issues', async () => {
      existingOpportunity = {
        getType: () => 'sitemap-no-valid-paths-extracted',
        setAuditId: sandbox.stub(),
        save: sandbox.stub(),
        getId: sandbox.stub(),
        getSuggestions: sandbox.stub(),
        addSuggestions: sandbox.stub(),
      };

      existingOpportunity.setAuditId.returns(existingOpportunity);
      existingOpportunity.getSuggestions.returns([]);
      existingOpportunity.addSuggestions.returns({
        errorItems: [],
        createdItems: [{ a: 'b' }],
      });
      existingOpportunity.getId.returns('oppty-id');

      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      await convertToOpportunity('https://example.com', auditDataFailure, context);

      expect(existingOpportunity.setAuditId).to.have.been.calledWith('audit-id');
      expect(existingOpportunity.save).to.have.been.called;
      expect(mockDataAccess.Opportunity.create).to.not.have.been.called;
      expect(opportunity.addSuggestions).to.not.have.been.called;
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

describe('handleClassifiedOpportunity', () => {
  let mockDataAccess;
  let mockLog;
  let detectedEntry;
  let existingEntries;
  const siteId = 'site-id';
  const auditId = 'audit-id';

  beforeEach(() => {
    mockLog = {
      error: sinon.spy(),
    };

    mockDataAccess = {
      Opportunity: {
        create: sinon.stub(),
      },
    };

    detectedEntry = {
      getData: () => [{
        sourceSitemapUrl: 'https://example.com/sitemap.xml',
        pageUrl: 'https://example.com/page',
        statusCode: 404,
      }],
      type: 'test-type',
      title: 'Test Title',
    };

    existingEntries = [];
  });

  it('should handle errors when creating opportunity', async () => {
    mockDataAccess.Opportunity.create.rejects(new Error('Creation failed'));

    await expect(handleClassifiedOpportunity(
      detectedEntry,
      existingEntries,
      mockLog,
      siteId,
      auditId,
      mockDataAccess,
    )).to.be.rejectedWith('Creation failed');

    expect(mockLog.error).to.have.been.calledWith(
      'Failed to create new opportunity for siteId site-id and auditId audit-id: Creation failed',
    );
  });
});
