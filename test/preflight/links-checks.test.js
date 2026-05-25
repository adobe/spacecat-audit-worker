/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';
import {
  matchesExcludedDomain,
  matchesExcludedPattern,
  normalizeHrefDomains,
  normalizeHrefPatterns,
  compileHrefPatterns,
} from '../../src/preflight/links-checks.js';

use(sinonChai);

describe('preflight/links-checks - helpers (direct)', () => {
  describe('matchesExcludedDomain', () => {
    it('returns false for an unparseable href (defensive)', () => {
      expect(matchesExcludedDomain('not a url', ['wal-mart.com'])).to.equal(false);
    });
    it('returns false when no domains configured', () => {
      expect(matchesExcludedDomain('https://wal-mart.com/x', [])).to.equal(false);
      expect(matchesExcludedDomain('https://wal-mart.com/x', undefined)).to.equal(false);
    });
  });

  describe('matchesExcludedPattern', () => {
    it('returns false when no patterns configured', () => {
      expect(matchesExcludedPattern('https://x.com/y', [])).to.equal(false);
      expect(matchesExcludedPattern('https://x.com/y', undefined)).to.equal(false);
    });
  });

  describe('normalizeHrefDomains', () => {
    it('accepts array input, lowercases, dedupes, strips protocol and path', () => {
      expect(normalizeHrefDomains(['Wal-Mart.com', 'https://wal-mart.com/owa', 'walmart.net']))
        .to.deep.equal(['wal-mart.com', 'walmart.net']);
    });
    it('accepts comma-separated string input', () => {
      expect(normalizeHrefDomains('foo.com, BAR.com, foo.com'))
        .to.deep.equal(['foo.com', 'bar.com']);
    });
    it('returns [] for non-string non-array input', () => {
      expect(normalizeHrefDomains(undefined)).to.deep.equal([]);
      expect(normalizeHrefDomains(123)).to.deep.equal([]);
    });
    it('filters out non-string array entries and empties', () => {
      expect(normalizeHrefDomains(['a.com', 123, null, '', '  '])).to.deep.equal(['a.com']);
    });
  });

  describe('normalizeHrefPatterns', () => {
    it('accepts array input, trims, drops empties', () => {
      expect(normalizeHrefPatterns(['^a', '  ', 'b$'])).to.deep.equal(['^a', 'b$']);
    });
    it('accepts a single string as a one-element array', () => {
      expect(normalizeHrefPatterns('^a')).to.deep.equal(['^a']);
    });
    it('returns [] for non-string non-array input', () => {
      expect(normalizeHrefPatterns(undefined)).to.deep.equal([]);
      expect(normalizeHrefPatterns({})).to.deep.equal([]);
    });
    it('filters out non-string array entries', () => {
      expect(normalizeHrefPatterns(['a', 123, null])).to.deep.equal(['a']);
    });
  });

  describe('compileHrefPatterns', () => {
    it('returns [] when nothing to compile', () => {
      const log = { warn: () => {} };
      expect(compileHrefPatterns([], log)).to.deep.equal([]);
      expect(compileHrefPatterns(undefined, log)).to.deep.equal([]);
    });
  });
});

describe('preflight/links-checks - runLinksChecks', () => {
  let sandbox;
  let fetchStub;
  let runLinksChecks;
  let context;

  const pageUrl = 'https://www.example.com/page';

  const makeScrapedObjects = (html, finalUrl = pageUrl) => [{
    data: {
      finalUrl,
      scrapeResult: { rawBody: html },
    },
  }];

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    fetchStub = sandbox.stub();

    ({ runLinksChecks } = await esmock('../../src/preflight/links-checks.js', {
      '@adobe/spacecat-shared-utils': {
        stripTrailingSlash: (url) => url.replace(/\/$/, ''),
        tracingFetch: fetchStub,
      },
    }));

    context = {
      log: {
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ── Helper: build a minimal Response-like object ──────────────────────────
  function makeResponse(status) {
    return { status, statusText: String(status), headers: { get: () => null } };
  }

  // ── User-Agent ─────────────────────────────────────────────────────────────

  it('sends a browser-like User-Agent header on HEAD requests', async () => {
    fetchStub.resolves(makeResponse(200));

    await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`<a href="${pageUrl}/other">link</a>`),
      context,
    );

    const [, headOptions] = fetchStub.firstCall.args;
    expect(headOptions.method).to.equal('HEAD');
    expect(headOptions.headers['User-Agent']).to.match(/Spacecat/);
  });

  // ── 404 / 410 / 5xx — broken only when GET confirms ───────────────────────
  // SITES-43720: HEAD is a fast-path optimization, GET is the source of truth.
  // Real servers (misconfigured Apache origins, SSO endpoints, etc.) commonly
  // return 4xx/5xx to HEAD on routes that respond 200 to GET, so we always
  // GET-confirm before reporting a link as broken.

  it('flags a 404 external link as broken when both HEAD and GET return 404', async () => {
    fetchStub.resolves(makeResponse(404));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/missing">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenExternalLinks[0].status).to.equal(404);
    expect(fetchStub.callCount).to.equal(2); // HEAD then GET-confirm
    expect(fetchStub.firstCall.args[1].method).to.equal('HEAD');
    expect(fetchStub.secondCall.args[1].method).to.equal('GET');
  });

  it('does NOT flag as broken when HEAD returns 404 but GET returns 200 (sparkshop pattern)', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(404)); // HEAD → 404 (misconfigured origin)
    fetchStub.onSecondCall().resolves(makeResponse(200)); // GET → 200

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://www.sparkshop.com/">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(fetchStub.secondCall.args[1].method).to.equal('GET');
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  it('flags a 410 external link as broken when both HEAD and GET return 410', async () => {
    fetchStub.resolves(makeResponse(410));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/gone">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenExternalLinks[0].status).to.equal(410);
    expect(fetchStub.callCount).to.equal(2);
    expect(fetchStub.firstCall.args[1].method).to.equal('HEAD');
    expect(fetchStub.secondCall.args[1].method).to.equal('GET');
  });

  it('does NOT flag as broken when HEAD returns 500 but GET returns 200', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(500));
    fetchStub.onSecondCall().resolves(makeResponse(200));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://flaky.com/page">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(fetchStub.firstCall.args[1].method).to.equal('HEAD');
    expect(fetchStub.secondCall.args[1].method).to.equal('GET');
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  it('flags a 500 external link as broken when both HEAD and GET return 500', async () => {
    fetchStub.resolves(makeResponse(500));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/error">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenExternalLinks[0].status).to.equal(500);
    expect(fetchStub.callCount).to.equal(2);
    expect(fetchStub.firstCall.args[1].method).to.equal('HEAD');
    expect(fetchStub.secondCall.args[1].method).to.equal('GET');
  });

  // ── Range header — only on the GET retry, never on HEAD ────────────────────

  it('sends Range: bytes=0-0 only on the GET retry, not on HEAD', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(404)); // HEAD
    fetchStub.onSecondCall().resolves(makeResponse(200)); // GET (sparkshop pattern)

    await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/page">link</a>'),
      context,
    );

    expect(fetchStub.firstCall.args[1].headers.Range).to.be.undefined;
    expect(fetchStub.secondCall.args[1].headers.Range).to.equal('bytes=0-0');
  });

  // ── 405 — Method Not Allowed: HEAD unsupported, retry GET ─────────────────

  it('retries with GET when HEAD returns 405 and does not flag as broken when GET succeeds', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(405)); // HEAD → 405
    fetchStub.onSecondCall().resolves(makeResponse(200)); // GET → 200

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://ui.idp.vonage.com/sign-up">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(fetchStub.secondCall.args[1].method).to.equal('GET');
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  it('flags as broken when HEAD returns 405 and GET returns 404', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(405));
    fetchStub.onSecondCall().resolves(makeResponse(404));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/page">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenExternalLinks[0].status).to.equal(404);
  });

  // ── 400 — Bad Request: likely bot detection, retry GET ────────────────────

  it('retries with GET when HEAD returns 400 and does not flag as broken when GET succeeds', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(400)); // HEAD → 400 (bot detection / AEM author)
    fetchStub.onSecondCall().resolves(makeResponse(200)); // GET → 200

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://author-p142502-e1512433.adobeaemcloud.com/content/page.html">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  it('does not flag as broken when GET also returns 400 (access restriction, not missing content)', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(400));
    fetchStub.onSecondCall().resolves(makeResponse(400));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://auth-gated.com/page">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  // ── 401 / 403 / 429 / 451 — Auth / bot-protection codes ──────────────────

  it('retries with GET when HEAD returns 401 and does not flag as broken when GET succeeds', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(401));
    fetchStub.onSecondCall().resolves(makeResponse(200));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://protected.com/page">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  it('retries with GET when HEAD returns 403 and flags broken if GET returns 404', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(403));
    fetchStub.onSecondCall().resolves(makeResponse(404));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://example.com/gone">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenExternalLinks[0].status).to.equal(404);
  });

  it('retries with GET when HEAD returns 429 (rate limited)', async () => {
    fetchStub.onFirstCall().resolves(makeResponse(429));
    fetchStub.onSecondCall().resolves(makeResponse(200));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://rate-limited.com/page">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  // ── Network errors ─────────────────────────────────────────────────────────

  it('retries with GET when HEAD throws a network error', async () => {
    fetchStub.onFirstCall().rejects(new Error('network timeout'));
    fetchStub.onSecondCall().resolves(makeResponse(200));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/page">link</a>'),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/HEAD request failed/));
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  it('flags as broken (status 0) when both HEAD and GET throw network errors', async () => {
    fetchStub.onFirstCall().rejects(new Error('network error'));
    fetchStub.onSecondCall().rejects(new Error('still failing'));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/page">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenExternalLinks[0].status).to.equal(0);
    expect(context.log.info).to.have.been.calledWith(sinon.match(/unreachable/));
    expect(context.log.error).to.not.have.been.called;
  });

  it('flags internal link as broken (status 0) when both HEAD and GET throw network errors', async () => {
    fetchStub.onFirstCall().rejects(new Error('getaddrinfo ENOTFOUND internal.example.com'));
    fetchStub.onSecondCall().rejects(new Error('getaddrinfo ENOTFOUND internal.example.com'));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`<a href="${pageUrl}/unreachable">internal broken</a>`),
      context,
    );

    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenInternalLinks[0].status).to.equal(0);
    expect(context.log.info).to.have.been.calledWith(sinon.match(/unreachable/));
  });

  // ── Broken internal links ─────────────────────────────────────────────────

  it('flags a broken internal link (404) in brokenInternalLinks', async () => {
    fetchStub.resolves(makeResponse(404));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`<a href="${pageUrl}/missing">internal broken</a>`),
      context,
    );

    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenInternalLinks[0].status).to.equal(404);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  // ── Internal links use Authorization header ────────────────────────────────

  it('includes Authorization header for internal links when pageAuthToken is provided', async () => {
    fetchStub.resolves(makeResponse(200));

    await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`<a href="${pageUrl}/internal">link</a>`),
      context,
      { pageAuthToken: 'Bearer token123' },
    );

    const [, headOptions] = fetchStub.firstCall.args;
    expect(headOptions.headers.Authorization).to.equal('Bearer token123');
  });

  it('does not include Authorization header for external links', async () => {
    fetchStub.resolves(makeResponse(200));

    await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://external.com/page">link</a>'),
      context,
      { pageAuthToken: 'Bearer token123' },
    );

    const [, headOptions] = fetchStub.firstCall.args;
    expect(headOptions.headers.Authorization).to.be.undefined;
  });

  it('does not include Authorization header on GET retry for external links when pageAuthToken is provided', async () => {
    // HEAD returns 405, triggering a GET retry. The auth token must not leak
    // onto the GET call even though pageAuthToken is present in options.
    fetchStub.onFirstCall().resolves(makeResponse(405)); // HEAD
    fetchStub.onSecondCall().resolves(makeResponse(200)); // GET

    await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://external.com/page">link</a>'),
      context,
      { pageAuthToken: 'Bearer token123' },
    );

    expect(fetchStub.callCount).to.equal(2);
    // Both HEAD and GET share the same headers object — Authorization must be absent
    expect(fetchStub.firstCall.args[1].headers.Authorization).to.be.undefined;
    expect(fetchStub.secondCall.args[1].headers.Authorization).to.be.undefined;
  });

  // ── OK responses ───────────────────────────────────────────────────────────

  it('returns no broken links when all links return 200', async () => {
    fetchStub.resolves(makeResponse(200));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`
        <a href="${pageUrl}/internal">internal</a>
        <a href="https://other.com/external">external</a>
      `),
      context,
    );

    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(0);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  // ── Invalid hrefs are silently skipped ────────────────────────────────────

  it('does not flag mailto: links as broken', async () => {
    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="mailto:someone@example.com">email</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    expect(fetchStub.callCount).to.equal(0);
  });

  it('does not flag tel: links as broken', async () => {
    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="tel:+18005551212">call us</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    expect(fetchStub.callCount).to.equal(0);
  });

  it('does not flag javascript: links as broken', async () => {
    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="javascript:void(0)">click</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    expect(fetchStub.callCount).to.equal(0);
  });

  it('silently skips hrefs that cannot be parsed as URLs', async () => {
    fetchStub.resolves(makeResponse(200));

    const result = await runLinksChecks(
      [pageUrl],
      // 'http://[' is an invalid URL that throws inside new URL() — should be silently skipped
      makeScrapedObjects('<a href="http://[">unparseable</a><a href="https://other.com/valid">valid</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    // only the valid link should have triggered a fetch
    expect(fetchStub.callCount).to.equal(1);
  });

  // ── SITES-42383 regression: Vonage false positives ────────────────────────

  it('SITES-42383: does not flag Vonage sign-up URL as broken when HEAD returns 405 and GET returns 200', async () => {
    // https://ui.idp.vonage.com/sign-up/dashboard returns 405 to HEAD (Method Not Allowed)
    // but 200 to GET — it is a valid link, not a broken one.
    const vonageUrl = 'https://ui.idp.vonage.com/sign-up/dashboard?icid=tryitfree_comm-apis_apidevsignup_other&utm_campaign=bizdirect&attribution_campaign=bizdirect';
    fetchStub.onFirstCall().resolves(makeResponse(405)); // HEAD
    fetchStub.onSecondCall().resolves(makeResponse(200)); // GET

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`<a href="${vonageUrl}">Sign up</a>`),
      context,
    );

    expect(fetchStub.callCount).to.equal(2);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  // ── Chrome (header/footer) links are checked, not skipped ─────────────────
  // Preflight audits a single page and is expected to give full coverage of that
  // page's links, including its header and footer. The bulk-audit dedup rationale
  // that motivated the original chrome-skip does not apply here. See SITES-43720.

  it('checks links inside header and footer elements', async () => {
    // 404 on both HEAD and GET → both links flagged as broken.
    // 2 links × (HEAD + GET-confirm) = 4 fetch calls.
    fetchStub.resolves(makeResponse(404));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`
        <header><a href="https://other.com/nav">nav</a></header>
        <footer><a href="https://other.com/footer">footer</a></footer>
      `),
      context,
    );

    expect(fetchStub.callCount).to.equal(4);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(2);
  });

  it('checks links inside ARIA banner and contentinfo landmarks', async () => {
    fetchStub.resolves(makeResponse(404));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`
        <div role="banner"><a href="https://other.com/nav">nav</a></div>
        <div role="contentinfo"><a href="https://other.com/footer">footer</a></div>
      `),
      context,
    );

    expect(fetchStub.callCount).to.equal(4);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(2);
  });

  it('checks links inside AEM experience-fragment header/footer wrappers', async () => {
    fetchStub.resolves(makeResponse(404));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(`
        <div class="cmp-experiencefragment cmp-experiencefragment--header">
          <div class="header">
            <a href="https://outlook.example.com/owa/">email</a>
          </div>
        </div>
        <div class="cmp-experiencefragment cmp-experiencefragment--footer">
          <div class="footer">
            <a href="https://x.com/example">social</a>
          </div>
        </div>
        <main><a href="https://other.com/article">content</a></main>
      `),
      context,
    );

    // All three links checked × (HEAD + GET-confirm) = 6 fetch calls.
    expect(fetchStub.callCount).to.equal(6);
    const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))].sort();
    expect(fetchedUrls).to.deep.equal([
      'https://other.com/article',
      'https://outlook.example.com/owa/',
      'https://x.com/example',
    ]);
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(3);
  });

  // ── excludedElementClasses ─────────────────────────────────────────────────

  describe('excludedElementClasses', () => {
    it('skips anchors inside an element with an excluded class', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <div class="cmp-feature-apps">
          <a href="https://corp-only.example.com/a">intranet a</a>
          <a href="https://corp-only.example.com/b">intranet b</a>
        </div>
        <a href="https://public.example.com/article">public</a>
      `;

      const result = await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedElementClasses: ['cmp-feature-apps'] },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://public.example.com/article']);
      expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenExternalLinks[0].urlTo)
        .to.equal('https://public.example.com/article');
    });

    it('skips anchors nested deep under an excluded ancestor', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <section class="no-audit">
          <div><ul><li><a href="https://deep.example.com/x">deep</a></li></ul></div>
        </section>
        <a href="https://public.example.com/y">public</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedElementClasses: ['no-audit'] },
      );

      const fetchedUrls = fetchStub.getCalls().map((c) => c.args[0]);
      expect(fetchedUrls).to.not.include('https://deep.example.com/x');
      expect(fetchedUrls).to.include('https://public.example.com/y');
    });

    it('handles nested excluded wrappers safely (deepest-first removal)', async () => {
      fetchStub.resolves(makeResponse(404));

      // Outer + inner both match. Inner is removed first; outer removal must not throw.
      const html = `
        <div class="excluded">
          <div class="excluded">
            <a href="https://inner.example.com/a">inner</a>
          </div>
          <a href="https://outer.example.com/b">outer</a>
        </div>
        <a href="https://keep.example.com/c">keep</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedElementClasses: ['excluded'] },
      );

      const fetchedUrls = fetchStub.getCalls().map((c) => c.args[0]);
      expect(fetchedUrls).to.deep.equal(['https://keep.example.com/c', 'https://keep.example.com/c']);
    });

    it('matches a token among multi-class elements', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <div class="container  cmp-feature-apps  bg-light">
          <a href="https://skip.example.com/a">skip</a>
        </div>
        <a href="https://keep.example.com/b">keep</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedElementClasses: ['cmp-feature-apps'] },
      );

      const fetchedUrls = fetchStub.getCalls().map((c) => c.args[0]);
      expect(fetchedUrls).to.not.include('https://skip.example.com/a');
      expect(fetchedUrls).to.include('https://keep.example.com/b');
    });

    it('is a no-op when no classes are configured', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <div class="cmp-feature-apps"><a href="https://a.example.com/x">a</a></div>
        <a href="https://b.example.com/y">b</a>
      `;

      // No excludedElementClasses option at all
      await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      const fetchedUrls1 = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))].sort();
      expect(fetchedUrls1).to.deep.equal(['https://a.example.com/x', 'https://b.example.com/y']);

      fetchStub.resetHistory();

      // Explicit empty array
      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedElementClasses: [] },
      );
      const fetchedUrls2 = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))].sort();
      expect(fetchedUrls2).to.deep.equal(['https://a.example.com/x', 'https://b.example.com/y']);
    });

    it('ignores elements whose class attribute is empty or whitespace', async () => {
      fetchStub.resolves(makeResponse(404));

      // Both forms are valid HTML. The defensive `if (!classAttr)` branch covers
      // the empty-string case; the no-match branch covers whitespace-only.
      const html = `
        <div class=""><a href="https://a.example.com/x">empty-class</a></div>
        <div class=" "><a href="https://b.example.com/y">whitespace-class</a></div>
        <a href="https://c.example.com/z">plain</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedElementClasses: ['anything'] },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))].sort();
      expect(fetchedUrls).to.deep.equal([
        'https://a.example.com/x',
        'https://b.example.com/y',
        'https://c.example.com/z',
      ]);
    });
  });

  // ── excludedHrefDomains ────────────────────────────────────────────────────

  describe('excludedHrefDomains', () => {
    it('skips anchors whose hostname is exactly an excluded domain', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <a href="https://wal-mart.com/about">root</a>
        <a href="https://public.example.com/article">public</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedHrefDomains: ['wal-mart.com'] },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://public.example.com/article']);
    });

    it('suffix-matches subdomains of an excluded domain', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <a href="https://timesheet.wal-mart.com/etm">sub</a>
        <a href="https://outlook.wal-mart.com/owa">sub2</a>
        <a href="https://public.example.com/article">public</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedHrefDomains: ['wal-mart.com'] },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://public.example.com/article']);
    });

    it('does NOT match adversarial lookalike hostnames', async () => {
      fetchStub.resolves(makeResponse(404));

      // wal-mart.com must NOT match evilwal-mart.com or wal-mart.com.evil.io
      const html = `
        <a href="https://evilwal-mart.com/phish">phish</a>
        <a href="https://wal-mart.com.evil.io/oops">trick</a>
        <a href="https://timesheet.wal-mart.com/etm">legit-skip</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedHrefDomains: ['wal-mart.com'] },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))].sort();
      expect(fetchedUrls).to.deep.equal([
        'https://evilwal-mart.com/phish',
        'https://wal-mart.com.evil.io/oops',
      ]);
    });

    it('handles multiple excluded domains', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <a href="https://timesheet.wal-mart.com/etm">a</a>
        <a href="https://workforce.us-walmart.prod.polaris.walmart.com/x">b</a>
        <a href="https://public.example.com/article">public</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedHrefDomains: ['wal-mart.com', 'walmart.com'] },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://public.example.com/article']);
    });

    it('is a no-op when not configured', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = '<a href="https://timesheet.wal-mart.com/etm">x</a>';

      await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://timesheet.wal-mart.com/etm']);
    });
  });

  // ── excludedHrefPatterns ───────────────────────────────────────────────────

  describe('excludedHrefPatterns', () => {
    it('skips anchors whose href matches a regex pattern', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <a href="https://internal.example.com/tools/x">internal</a>
        <a href="https://public.example.com/article">public</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedHrefPatterns: ['^https?://internal\\.'] },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://public.example.com/article']);
    });

    it('drops invalid regexes with a warn but keeps valid ones working', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <a href="https://internal.example.com/x">match</a>
        <a href="https://public.example.com/y">public</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedHrefPatterns: ['[unclosed', '^https?://internal\\.'] },
      );

      // Bad pattern dropped with a warn — audit not crashed
      expect(context.log.warn).to.have.been.calledWithMatch(/invalid excludedHrefPattern/);
      // Valid pattern still applied
      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://public.example.com/y']);
    });

    it('is a no-op when not configured', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = '<a href="https://internal.example.com/x">x</a>';

      await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://internal.example.com/x']);
    });
  });

  // ── combined filters compose ───────────────────────────────────────────────

  describe('all three filters compose', () => {
    it('skips anchors matching any of element-class / domain / pattern', async () => {
      fetchStub.resolves(makeResponse(404));

      const html = `
        <div class="cmp-feature-apps">
          <a href="https://anything.com/inside-excluded-subtree">x1</a>
        </div>
        <a href="https://timesheet.wal-mart.com/etm">x2</a>
        <a href="https://internal.example.com/tools">x3</a>
        <a href="https://public.example.com/article">survives</a>
      `;

      await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        {
          excludedElementClasses: ['cmp-feature-apps'],
          excludedHrefDomains: ['wal-mart.com'],
          excludedHrefPatterns: ['^https?://internal\\.'],
        },
      );

      const fetchedUrls = [...new Set(fetchStub.getCalls().map((c) => c.args[0]))];
      expect(fetchedUrls).to.deep.equal(['https://public.example.com/article']);
    });
  });
});
