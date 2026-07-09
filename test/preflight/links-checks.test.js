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

use(sinonChai);

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
    expect(context.log.debug).to.have.been.calledWith(sinon.match(/HEAD request failed/));
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  // SITES-47125: only DNS-resolution failures (ENOTFOUND) are definitively broken.
  // Other network-level failures (connection reset, HTTP/2 stream errors, TLS, timeout)
  // mean the host exists but won't talk to our bot — these are indistinguishable from a
  // valid page that blocks crawlers, so they must NOT be reported as broken.

  it('flags as broken (status 0) when both HEAD and GET fail with a DNS-resolution error (ENOTFOUND)', async () => {
    const dnsError = Object.assign(new Error('getaddrinfo ENOTFOUND www.brokenlinkbrokenlink.za'), { code: 'ENOTFOUND' });
    fetchStub.onFirstCall().rejects(dnsError);
    fetchStub.onSecondCall().rejects(dnsError);

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://www.brokenlinkbrokenlink.za/page">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
    expect(result.auditResult.brokenExternalLinks[0].status).to.equal(0);
    expect(context.log.info).to.have.been.calledWith(sinon.match(/unreachable/));
    expect(context.log.error).to.not.have.been.called;
  });

  it('does NOT flag as broken when a connection-level error blocks the bot (HTTP/2 reset — SITES-47125)', async () => {
    // ups.com resolves fine but resets the HTTP/2 stream to block bots. Valid in a browser.
    const http2Error = Object.assign(
      new Error('Stream closed with error code NGHTTP2_INTERNAL_ERROR'),
      { code: 'ERR_HTTP2_STREAM_ERROR' },
    );
    fetchStub.onFirstCall().rejects(http2Error);
    fetchStub.onSecondCall().rejects(http2Error);

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://www.ups.com/ppwa/doWork?loc=en_US">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    expect(context.log.error).to.not.have.been.called;
    // Assert the inconclusive branch actually ran, not just that nothing was flagged — a refactor
    // that exited before reaching isDnsResolutionFailure would still pass the two checks above.
    expect(context.log.debug).to.have.been.calledWith(sinon.match(/probe inconclusive/));
  });

  it('does NOT flag as broken when both HEAD and GET fail with a generic (non-DNS) network error', async () => {
    fetchStub.onFirstCall().rejects(new Error('network error'));
    fetchStub.onSecondCall().rejects(new Error('still failing'));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/page">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    expect(context.log.error).to.not.have.been.called;
    expect(context.log.debug).to.have.been.calledWith(sinon.match(/probe inconclusive/));
  });

  it('does NOT flag as broken when a non-DNS error message merely contains the substring "ENOTFOUND"', async () => {
    // The message-fallback must only match the canonical Node format ("getaddrinfo ENOTFOUND"),
    // not any message that happens to contain the substring — otherwise a wrapper error like this
    // would re-introduce the false positives this fix removes (MysticatBot review on PR #2727).
    const wrappedError = new Error('Retry after ENOTFOUND was cached'); // no .code, non-canonical
    fetchStub.onFirstCall().rejects(wrappedError);
    fetchStub.onSecondCall().rejects(wrappedError);

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/page">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    expect(context.log.error).to.not.have.been.called;
    expect(context.log.debug).to.have.been.calledWith(sinon.match(/probe inconclusive/));
  });

  // Message-fallback branch: error carries the canonical "getaddrinfo ENOTFOUND" message but no
  // .code (e.g. a fetch wrapper that strips the code). Still a definitive DNS failure → broken.
  it('flags internal link as broken (status 0) on a DNS-resolution error message without a code', async () => {
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

  // ── cq-LinkChecker broken link detection ──────────────────────────────────
  describe('cq-LinkChecker broken link detection', () => {
    it('reports a same-origin cq-LinkChecker--invalid image as a broken internal link without probing', async () => {
      const html = `
        <p>
          <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
               alt="invalid link: /content/site/en/missing.html">
          Missing page
          <img class="cq-LinkChecker cq-LinkChecker--suffix cq-LinkChecker--invalid">
        </p>
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(fetchStub.callCount).to.equal(0);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/content/site/en/missing.html');
      expect(result.auditResult.brokenInternalLinks[0].status).to.equal(404);
      expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    });

    it('reports a cross-origin cq-LinkChecker--invalid image as a broken external link', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: https://external.example.com/gone">
        <img class="cq-LinkChecker cq-LinkChecker--suffix cq-LinkChecker--invalid">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(fetchStub.callCount).to.equal(0);
      expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenExternalLinks[0].urlTo).to.equal('https://external.example.com/gone');
      expect(result.auditResult.brokenExternalLinks[0].status).to.equal(404);
    });

    it('resolves a bare relative href correctly against pageUrl', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: microt.com">
        <img class="cq-LinkChecker cq-LinkChecker--suffix cq-LinkChecker--invalid">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/microt.com');
    });

    it('resolves an absolute content path against pageUrl origin', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/this-page-does-not-exist.html">
        <img class="cq-LinkChecker cq-LinkChecker--suffix cq-LinkChecker--invalid">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/content/site/en/this-page-does-not-exist.html');
    });

    it('reports both a probed broken link and a cq-LinkChecker broken link on the same page', async () => {
      fetchStub.resolves(makeResponse(404));
      const html = `
        <a href="https://external.example.com/probe-me">probe this</a>
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/aem-broken.html">
        <img class="cq-LinkChecker cq-LinkChecker--suffix cq-LinkChecker--invalid">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenExternalLinks[0].urlTo).to.equal('https://external.example.com/probe-me');
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/content/site/en/aem-broken.html');
    });

    it('ignores cq-LinkChecker--prefix image that does not have cq-LinkChecker--invalid class', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix"
             alt="invalid link: /content/site/en/valid.html">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(0);
      expect(fetchStub.callCount).to.equal(0);
    });

    it('ignores cq-LinkChecker--invalid image whose alt does not match the expected pattern', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="some other text">
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(0);
      expect(fetchStub.callCount).to.equal(0);
    });

    it('does not report a cq-LinkChecker--invalid image inside an excludedElementClasses subtree', async () => {
      const html = `
        <div class="skip-me">
          <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
               alt="invalid link: /content/site/en/excluded.html">
        </div>
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/included.html">
      `;
      const result = await runLinksChecks(
        [pageUrl],
        makeScrapedObjects(html),
        context,
        { excludedElementClasses: ['skip-me'] },
      );
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/content/site/en/included.html');
    });

    it('makes no fetch calls for cq-LinkChecker-sourced broken links', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/a.html">
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/b.html">
      `;
      await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(fetchStub.callCount).to.equal(0);
    });

    it('silently skips a cq-LinkChecker--invalid image whose alt contains an unparseable URL', async () => {
      // http://[invalid triggers a URL parse error (malformed IPv6 literal)
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: http://[invalid">
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/valid.html">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/content/site/en/valid.html');
    });

    it('skips non-HTTP schemes (mailto:, tel:) to match the checkLinkStatus protocol guard', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: mailto:noreply@example.com">
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: tel:+15550001234">
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/real-broken.html">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/content/site/en/real-broken.html');
      expect(fetchStub.callCount).to.equal(0);
    });

    it('deduplicates multiple cq-LinkChecker images pointing to the same URL', async () => {
      const html = `
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/missing.html">
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/missing.html">
        <img class="cq-LinkChecker cq-LinkChecker--prefix cq-LinkChecker--invalid"
             alt="invalid link: /content/site/en/missing.html">
      `;
      const result = await runLinksChecks([pageUrl], makeScrapedObjects(html), context);
      expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenInternalLinks[0].urlTo).to.equal('https://www.example.com/content/site/en/missing.html');
      expect(fetchStub.callCount).to.equal(0);
    });
  });
});

describe('preflight/links-checks - probe concurrency (SITES-46696)', () => {
  let sandbox;
  let fetchStub;
  let runLinksChecks;
  let createConcurrencyLimiter;
  let DEFAULT_LINK_CHECK_CONCURRENCY;
  let context;
  const pageUrl = 'https://www.example.com/page';

  const makeScrapedObjects = (html, finalUrl = pageUrl) => [{
    data: { finalUrl, scrapeResult: { rawBody: html } },
  }];

  const makeResponse = (status) => ({
    status,
    statusText: String(status),
    headers: { get: () => null },
  });

  const manyExternalLinks = (n) => {
    let html = '';
    for (let i = 0; i < n; i += 1) {
      html += `<a href="https://other-${i}.com/x">l</a>`;
    }
    return html;
  };

  // Tracks the peak number of concurrently in-flight fetches.
  const makeTracker = () => {
    let active = 0;
    let max = 0;
    const fetchImpl = () => new Promise((resolve) => {
      active += 1;
      if (active > max) {
        max = active;
      }
      setTimeout(() => {
        active -= 1;
        resolve(makeResponse(200));
      }, 5);
    });
    return { fetchImpl, getMax: () => max };
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    fetchStub = sandbox.stub();
    ({
      runLinksChecks,
      createConcurrencyLimiter,
      DEFAULT_LINK_CHECK_CONCURRENCY,
    } = await esmock('../../src/preflight/links-checks.js', {
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

  afterEach(() => sandbox.restore());

  it('createConcurrencyLimiter runs all tasks and returns their results', async () => {
    const limit = createConcurrencyLimiter(2);
    const results = await Promise.all(
      [1, 2, 3].map((nVal) => limit(() => Promise.resolve(nVal * 2))),
    );
    expect(results).to.deep.equal([2, 4, 6]);
  });

  it('createConcurrencyLimiter never exceeds the limit', async () => {
    const limit = createConcurrencyLimiter(2);
    const tracker = makeTracker();
    await Promise.all(Array.from({ length: 6 }, () => limit(tracker.fetchImpl)));
    expect(tracker.getMax()).to.equal(2);
  });

  it('createConcurrencyLimiter propagates task rejection', async () => {
    const limit = createConcurrencyLimiter(1);
    let err;
    try {
      await limit(() => Promise.reject(new Error('boom')));
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an('error').with.property('message', 'boom');
  });

  it('createConcurrencyLimiter falls back to serial for invalid max', async () => {
    const limit = createConcurrencyLimiter(0);
    const tracker = makeTracker();
    await Promise.all(Array.from({ length: 3 }, () => limit(tracker.fetchImpl)));
    expect(tracker.getMax()).to.equal(1);
  });

  it('bounds concurrent probes to options.linkCheckConcurrency', async () => {
    const tracker = makeTracker();
    fetchStub.callsFake(tracker.fetchImpl);
    await runLinksChecks(
      [pageUrl],
      makeScrapedObjects(manyExternalLinks(10)),
      context,
      { pageAuthToken: null, linkCheckConcurrency: 3 },
    );
    expect(tracker.getMax()).to.equal(3);
  });

  it('reads concurrency from env when the option is absent', async () => {
    const tracker = makeTracker();
    fetchStub.callsFake(tracker.fetchImpl);
    context.env = { PREFLIGHT_LINK_CHECK_CONCURRENCY: '2' };
    await runLinksChecks([pageUrl], makeScrapedObjects(manyExternalLinks(8)), context);
    expect(tracker.getMax()).to.equal(2);
  });

  it('defaults to DEFAULT_LINK_CHECK_CONCURRENCY when no option or env is set', async () => {
    const tracker = makeTracker();
    fetchStub.callsFake(tracker.fetchImpl);
    await runLinksChecks([pageUrl], makeScrapedObjects(manyExternalLinks(12)), context);
    expect(tracker.getMax()).to.equal(DEFAULT_LINK_CHECK_CONCURRENCY);
  });
});
