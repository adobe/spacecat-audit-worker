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
import esmock from 'esmock';
import { load as cheerioLoad } from 'cheerio';
import {
  extractExternalLinks,
  DOMAIN_RATE_LIMIT_MS,
  FETCH_TIMEOUT_MS,
  MAX_PAGES,
  MAX_EXTERNAL_LINKS_PER_PAGE,
} from '../../src/broken-external-links/helpers.js';

use(sinonChai);

describe('broken-external-links helpers', () => {
  const siteHostname = 'example.com';

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  describe('constants', () => {
    it('exports DOMAIN_RATE_LIMIT_MS = 1000', () => {
      expect(DOMAIN_RATE_LIMIT_MS).to.equal(1000);
    });

    it('exports FETCH_TIMEOUT_MS = 5000', () => {
      expect(FETCH_TIMEOUT_MS).to.equal(5000);
    });

    it('exports MAX_PAGES = 100', () => {
      expect(MAX_PAGES).to.equal(100);
    });

    it('exports MAX_EXTERNAL_LINKS_PER_PAGE = 50', () => {
      expect(MAX_EXTERNAL_LINKS_PER_PAGE).to.equal(50);
    });
  });

  describe('extractExternalLinks', () => {
    it('returns external http/https links', () => {
      const html = `
        <html><body>
          <a href="https://external.com/page1">link1</a>
          <a href="https://other.org/page2">link2</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.include('https://external.com/page1');
      expect(result).to.include('https://other.org/page2');
    });

    it('excludes links to the same hostname', () => {
      const html = `
        <html><body>
          <a href="https://example.com/internal">internal</a>
          <a href="https://external.com/page">external</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.not.include('https://example.com/internal');
      expect(result).to.include('https://external.com/page');
    });

    it('excludes relative links', () => {
      const html = `
        <html><body>
          <a href="/relative/path">relative</a>
          <a href="https://external.com/abs">absolute</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.not.include('/relative/path');
      expect(result).to.include('https://external.com/abs');
    });

    it('excludes mailto: and tel: links', () => {
      const html = `
        <html><body>
          <a href="mailto:test@example.com">email</a>
          <a href="tel:+1234567890">phone</a>
          <a href="https://external.com/ok">ok</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.not.include('mailto:test@example.com');
      expect(result).to.not.include('tel:+1234567890');
      expect(result).to.include('https://external.com/ok');
    });

    it('excludes fragment-only links', () => {
      const html = `
        <html><body>
          <a href="#section">fragment</a>
          <a href="https://external.com/page">external</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.not.include('#section');
      expect(result).to.include('https://external.com/page');
    });

    it('skips href with empty string value', () => {
      const html = `
        <html><body>
          <a href="">empty href</a>
          <a href="https://external.com/ok">valid</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.include('https://external.com/ok');
      expect(result).to.not.include('');
    });

    it('skips href values that start with https:// but are not parseable as URLs', () => {
      const html = `
        <html><body>
          <a href="https://">incomplete url</a>
          <a href="https://valid.com/page">valid url</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.include('https://valid.com/page');
      expect(result).to.not.include('https://');
    });

    it('deduplicates the same URL', () => {
      const html = `
        <html><body>
          <a href="https://external.com/dup">first</a>
          <a href="https://external.com/dup">second</a>
        </body></html>
      `;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      const dupCount = result.filter((u) => u === 'https://external.com/dup').length;
      expect(dupCount).to.equal(1);
    });

    it('limits results to MAX_EXTERNAL_LINKS_PER_PAGE', () => {
      const links = Array.from(
        { length: MAX_EXTERNAL_LINKS_PER_PAGE + 10 },
        (_, i) => `<a href="https://ext${i}.com/page">link</a>`,
      ).join('');
      const html = `<html><body>${links}</body></html>`;
      const $ = cheerioLoad(html);
      const result = extractExternalLinks($, siteHostname);
      expect(result).to.have.length(MAX_EXTERNAL_LINKS_PER_PAGE);
    });

    it('returns empty array when no links present', () => {
      const $ = cheerioLoad('<html><body><p>no links</p></body></html>');
      expect(extractExternalLinks($, siteHostname)).to.deep.equal([]);
    });

    it('returns empty array when only internal links present', () => {
      const html = '<html><body><a href="https://example.com/page">internal</a></body></html>';
      const $ = cheerioLoad(html);
      expect(extractExternalLinks($, siteHostname)).to.deep.equal([]);
    });
  });

  describe('checkExternalLinks', () => {
    let checkExternalLinksWithSleep;
    let sleepStub;

    beforeEach(async () => {
      sleepStub = sinon.stub().resolves();
      const module = await esmock('../../src/broken-external-links/helpers.js', {
        '../../src/support/utils.js': { sleep: sleepStub },
      });
      checkExternalLinksWithSleep = module.checkExternalLinks;
    });

    it('returns broken links (status >= 400)', async () => {
      nock('https://broken.com').get('/404').reply(404);
      nock('https://broken.com').get('/500').reply(500);
      nock('https://ok.com').get('/200').reply(200);

      const log = { warn: sinon.stub() };
      const result = await checkExternalLinksWithSleep(
        ['https://broken.com/404', 'https://broken.com/500', 'https://ok.com/200'],
        log,
      );

      expect(result).to.have.length(2);
      expect(result.find((r) => r.url === 'https://broken.com/404').status).to.equal(404);
      expect(result.find((r) => r.url === 'https://broken.com/500').status).to.equal(500);
    });

    it('excludes successful responses (2xx)', async () => {
      nock('https://ok.com').get('/ok').reply(200);

      const log = { warn: sinon.stub() };
      const result = await checkExternalLinksWithSleep(['https://ok.com/ok'], log);
      expect(result).to.deep.equal([]);
    });

    it('applies rate limit sleep for same-domain sequential requests within rate limit', async () => {
      nock('https://samedom.com').get('/first').reply(404);
      nock('https://samedom.com').get('/second').reply(404);

      const log = { warn: sinon.stub() };
      await checkExternalLinksWithSleep(
        ['https://samedom.com/first', 'https://samedom.com/second'],
        log,
      );

      expect(sleepStub).to.have.been.calledOnce;
    });

    it('skips sleep when elapsed time already exceeds rate limit', async () => {
      // Stub Date.now to simulate enough time having passed between same-domain requests
      let nowCallCount = 0;
      sinon.stub(Date, 'now').callsFake(() => {
        nowCallCount += 1;
        if (nowCallCount === 1) return 0;        // first URL: stored as lastRequestMs
        if (nowCallCount === 2) return 2000;     // second URL: elapsed = 2000 - 0 = 2000 >= 1000
        return 2000;
      });

      nock('https://samedom2.com').get('/first').reply(404);
      nock('https://samedom2.com').get('/second').reply(404);

      const log = { warn: sinon.stub() };
      await checkExternalLinksWithSleep(
        ['https://samedom2.com/first', 'https://samedom2.com/second'],
        log,
      );

      expect(sleepStub).to.not.have.been.called;
    });

    it('does not apply rate limit delay for different-domain requests', async () => {
      nock('https://domain1.com').get('/page').reply(404);
      nock('https://domain2.com').get('/page').reply(404);

      const log = { warn: sinon.stub() };
      await checkExternalLinksWithSleep(
        ['https://domain1.com/page', 'https://domain2.com/page'],
        log,
      );

      expect(sleepStub).to.not.have.been.called;
    });

    it('skips and warns on fetch error', async () => {
      nock('https://errored.com').get('/page').replyWithError('connection refused');
      nock('https://ok.com').get('/ok').reply(200);

      const log = { warn: sinon.stub() };
      const result = await checkExternalLinksWithSleep(
        ['https://errored.com/page', 'https://ok.com/ok'],
        log,
      );

      expect(result).to.deep.equal([]);
      expect(log.warn).to.have.been.calledOnce;
    });

    it('skips URLs that cannot be parsed', async () => {
      const log = { warn: sinon.stub() };
      const result = await checkExternalLinksWithSleep(['not-a-url'], log);
      expect(result).to.deep.equal([]);
    });

    it('returns empty array for empty input', async () => {
      const log = { warn: sinon.stub() };
      const result = await checkExternalLinksWithSleep([], log);
      expect(result).to.deep.equal([]);
    });
  });
});
