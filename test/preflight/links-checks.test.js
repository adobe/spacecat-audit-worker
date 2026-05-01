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
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/HEAD request failed/));
    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
  });

  it('returns null (not broken) when both HEAD and GET throw network errors', async () => {
    fetchStub.onFirstCall().rejects(new Error('network error'));
    fetchStub.onSecondCall().rejects(new Error('still failing'));

    const result = await runLinksChecks(
      [pageUrl],
      makeScrapedObjects('<a href="https://other.com/page">link</a>'),
      context,
    );

    expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(0);
    expect(context.log.error).to.have.been.called;
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
});
