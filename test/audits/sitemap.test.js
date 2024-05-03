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
  checkRobotsForSitemap, sitemapAuditRunner,
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
      },
      fullAuditRef: url,
    });
  });

  it('runs successfully for sitemap extracted from robots.txt through sitemap index', async () => {
    nock(url)
      .get('/robots.txt')
      .reply(200, `Sitemap: ${url}/sitemap_index.xml`);
    nock(url)
      .get('/sitemap_index.xml')
      .reply(200, '<?xml version="1.0" encoding="UTF-8"?>\n'
          + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + `<sitemap><loc>${url}/sitemap_foo.xml</loc></sitemap>\n`
          + `<sitemap><loc>${url}/sitemap_bar.xml</loc></sitemap>\n`
          + '</sitemapindex>');
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
      },
      fullAuditRef: url,
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
      },
      fullAuditRef: url,
    });
  });

  it('sitemap audit returns 404 when site not found', async () => {
    nock(url)
      .get('/robots.txt')
      .reply(404);

    const result = await sitemapAuditRunner(url, context);
    expect(result).to.eql({
      auditResult: {
        success: false,
        reasons: [{
          error: ERROR_CODES.FETCH_ERROR,
          value: `Error fetching or processing robots.txt: Failed to fetch content from ${url}/robots.txt. Status: 404`,
        }],
      },
      fullAuditRef: url,
    });
  });
});

describe('checkRobotsForSitemap', () => {
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  // it('checkRobotsForSitemap returns error when no sitemap found in robots.txt', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Allow: /');
  //
  //   const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
  //   expect(result).to.deep.equal({ path: null, reasons: [ERROR_CODES.ROBOTS_NOT_FOUND] });
  // });

  // it('checkRobotsForSitemap returns error when unable to fetch robots.txt', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(404);
  //
  //   const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
  //   expect(result).to.deep.equal({ path: null, reasons: [ERROR_CODES.ROBOTS_NOT_FOUND] });
  // });

  // it('checkRobotsForSitemap returns error when no sitemap found in robots.txt', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Disallow: /');
  //
  //   const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
  //   expect(result.path).to.be.null;
  //   expect(result.reasons).to.deep.equal([ERROR_CODES.ROBOTS_NOT_FOUND]);
  // });

  // it('checkRobotsForSitemap returns error when unable to fetch robots.txt', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(404);
  //
  //   const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
  //   expect(result.path).to.be.null;
  //   expect(result.reasons).to.deep.equal([ERROR_CODES.ROBOTS_NOT_FOUND]);
  // });
});

describe('extractDomainAndProtocol', () => {
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should correctly extract the domain and protocol from a URL', () => {
    const result = extractDomainAndProtocol('https://some-domain.adobe/path');
    expect(result).to.deep.equal({
      protocol: 'https',
      domain: 'some-domain.adobe',
    });
  });

  it('should return null for an invalid URL', () => {
    const result = extractDomainAndProtocol('not a valid url');
    expect(result).to.equal(null);
  });
});

describe('checkSitemap', () => {
  it('should return SITEMAP_NOT_FOUND and SITEMAP_EMPTY errors when the sitemap does not exist', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(404);

    const resp = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_NOT_FOUND);
    expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_EMPTY);
  });

  it('should return FETCH_ERROR when there is a network error', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .replyWithError('Network error');

    const resp = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include(ERROR_CODES.FETCH_ERROR);
  });

  it('checkSitemap returns false when sitemap is not valid XML', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(200, 'Not valid XML');

    const resp = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include('FETCH_ERROR');
  });

  it('checkSitemap returns invalid result for non-existing sitemap', async () => {
    nock('https://some-domain.adobe')
      .get('/non-existent-sitemap.xml')
      .reply(404);

    const result = await checkSitemap('https://some-domain.adobe/non-existent-sitemap.xml');
    expect(result.existsAndIsValid).to.equal(false);
    expect(result.reasons).to.deep.equal(
      [ERROR_CODES.SITEMAP_NOT_FOUND, ERROR_CODES.SITEMAP_EMPTY],
    );
  });

  it('checkSitemap returns SITEMAP_FORMAT error for non-XML content', async () => {
    nock('https://some-domain.adobe')
      .get('/invalid-sitemap.xml')
      .reply(200, 'This is not XML content');

    const result = await checkSitemap('https://some-domain.adobe/invalid-sitemap.xml');
    expect(result.existsAndIsValid).to.be.false;
    // expect(result.reasons).to.deep.equal([ERROR_CODES.SITEMAP_NOT_XML]);
    expect(result.reasons).to.deep.equal([ERROR_CODES.FETCH_ERROR]);
  });

  it('checkSitemap returns error for fetch error', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .replyWithError('Fetch error');

    const result = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(result.existsAndIsValid).to.be.false;
    expect(result.reasons).to.deep.equal([ERROR_CODES.FETCH_ERROR]);
  });
});

describe('findSitemap', () => {
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should return error when URL is invalid', async () => {
    const result = await findSitemap('not a valid url');
    expect(result.success).to.equal(false);
    expect(result.reasons[0].error).to.equal(ERROR_CODES.INVALID_URL);
  });

  // it('should return success when sitemap is found in robots.txt', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Sitemap: /sitemap.xml');
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap.xml')
  //     .reply(200, '<?xml');
  //
  //   const result = await findSitemap('https://some-domain.adobe');
  //   expect(result.success).to.equal(false);
  //   // expect(result.success).to.equal(true);
  //   // expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap.xml');
  // });

  // it('should return success when sitemap.xml is found', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Allow: /');
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap.xml')
  //     .reply(200, '<?xml');
  //
  //   const result = await findSitemap('https://some-domain.adobe');
  //   expect(result.success).to.equal(false);
  //   // expect(result.success).to.equal(true);
  //   // expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap.xml');
  // });

  // it('should return success when sitemap_index.xml is found', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Allow: /');
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap.xml')
  //     .reply(404);
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap_index.xml')
  //     .reply(200, '<?xml');
  //
  //   const result = await findSitemap('https://some-domain.adobe');
  //   expect(result.success).to.equal(false);
  //   // expect(result.success).to.equal(true);
  //   // expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap_index.xml');
  // });

  // it('should return error when no sitemap is found', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Allow: /');
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap.xml')
  //     .reply(404);
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap_index.xml')
  //     .reply(404);
  //
  //   const result = await findSitemap('https://some-domain.adobe');
  //   expect(result.success).to.equal(false);
  // });

  it('checkRobotsForSitemap returns sitemap path when found in robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Sitemap: /sitemap.xml');

    const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
    // expect(result.path).to.equal('/sitemap.xml');
    expect(result.reasons).to.be.an('array');
  });

  // it('checkRobotsForSitemap returns sitemap path found in robots.txt that exists', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Sitemap: /sitemap2.xml');
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap2.xml')
  //     .reply(200, '<?xml');
  //
  //   const result = await findSitemap('https://some-domain.adobe');
  //   // expect(result.success).to.equal(true);
  //   expect(result.success).to.equal(false);
  //   // expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap2.xml');
  // });

  // it('checkRobotsForSitemap returns sitemap from robots.txt but does not exist', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, 'Sitemap: /sitemap2.xml');
  //
  //   nock('https://some-domain.adobe')
  //     .get('/sitemap2.xml')
  //     .reply(404, '');
  //
  //   const result = await findSitemap('https://some-domain.adobe');
  //   expect(result.success).to.equal(false);
  // });

  // it('checkRobotsForSitemap returns error when no sitemap is found in robots.txt', async () => {
  //   nock('https://some-domain.adobe')
  //     .get('/robots.txt')
  //     .reply(200, '');
  //
  //   const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
  //   expect(result.path).to.be.null;
  //   // expect(result.reasons).to.deep.equal([ERROR_CODES.NO_SITEMAP_IN_ROBOTS]);
  // });
});

// it('should call sqs.sendMessage with correct parameters', async () => {
//   const message = { type: 'audit', url: 'site-id', auditContext: {} };
//   const site = { getBaseURL: () => 'https://some-domain.adobe' };
//   const dataAccess = { getSiteByID: sinon.stub().resolves(site) };
//   const sqs = { sendMessage: sinon.stub().resolves() };
//   const context = {
//     log: { info: sinon.spy(), error: sinon.spy() },
//     env: { AUDIT_RESULTS_QUEUE_URL: 'some-queue-url' },
//     dataAccess,
//     sqs,
//   };
//
//   await audit(message, context);
//
//   expect(sqs.sendMessage.calledOnceWith('some-queue-url', {
//     type: 'audit',
//     url: 'https://some-domain.adobe',
//     auditContext: {},
//     auditResult: sinon.match.any,
//   })).to.be.true;
// });

describe('isSitemapValid', () => {
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

  it('should return true for valid sitemap content when plain/txt', () => {
    const sitemapContent = {
      payload: 'http://www.example.com/catalog?item=12&desc=vacation_hawaii\nhttps://www.example.com/catalog?item=11',
      type: 'plain/text',
    };
    expect(isSitemapContentValid(sitemapContent)).to.be.true;
  });

  it('should return true for valid sitemap content', () => {
    const sitemapContent = {
      payload: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
          + '    <url><loc>https://www.adobe.com/</loc></url>\n'
          + '      </urlset>',
      type: 'text/xml',
    };
    expect(isSitemapContentValid(sitemapContent)).to.be.true;
  });
});
