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

describe('preflight/links - default runner: excludedElementClasses plumbing', () => {
  let sandbox;
  let runLinksChecksStub;
  let saveIntermediateResultsStub;
  let generateSuggestionDataStub;
  let linksRunner;

  const previewUrl = 'https://example.com/page1';

  const buildAuditContext = (rawBody = '<html><body></body></html>') => ({
    previewBaseURL: 'https://example.com',
    previewUrls: [previewUrl],
    step: 'identify',
    audits: new Map([
      [previewUrl, {
        audits: [{ name: 'links', type: 'seo', opportunities: [] }],
      }],
    ]),
    auditsResult: [{ pageUrl: previewUrl, audits: [] }],
    scrapedObjects: [{
      data: {
        finalUrl: previewUrl,
        scrapeResult: { rawBody },
      },
    }],
    urls: [previewUrl],
    pageAuthToken: null,
    timeExecutionBreakdown: [],
  });

  const buildContext = (siteConfigOverride) => ({
    site: {
      getId: () => 'site-123',
      getBaseURL: () => 'https://example.com',
      getConfig: () => siteConfigOverride,
    },
    job: { getId: () => 'job-123' },
    log: {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    runLinksChecksStub = sandbox.stub().resolves({
      auditResult: {
        brokenInternalLinks: [],
        brokenExternalLinks: [],
      },
    });
    saveIntermediateResultsStub = sandbox.stub().resolves();
    generateSuggestionDataStub = sandbox.stub().resolves([]);

    ({ default: linksRunner } = await esmock('../../src/preflight/links.js', {
      '../../src/preflight/links-checks.js': { runLinksChecks: runLinksChecksStub },
      '../../src/preflight/utils.js': { saveIntermediateResults: saveIntermediateResultsStub },
      '../../src/internal-links/suggestions-generator.js': {
        generateSuggestionData: generateSuggestionDataStub,
      },
    }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('passes [] when site has no preflight handler config', async () => {
    const context = buildContext({
      getHandlers: () => ({}),
    });

    await linksRunner(context, buildAuditContext());

    expect(runLinksChecksStub).to.have.been.calledOnce;
    const passedOptions = runLinksChecksStub.firstCall.args[3];
    expect(passedOptions.excludedElementClasses).to.deep.equal([]);
  });

  it('passes normalized classes from site preflight handler config', async () => {
    const context = buildContext({
      getHandlers: () => ({
        preflight: {
          config: {
            excludedElementClasses: ['.cmp-feature-apps', 'no-audit', '  '],
          },
        },
      }),
    });

    await linksRunner(context, buildAuditContext());

    const passedOptions = runLinksChecksStub.firstCall.args[3];
    expect(passedOptions.excludedElementClasses)
      .to.deep.equal(['cmp-feature-apps', 'no-audit']);
  });

  it('passes [] when site.getConfig() returns undefined', async () => {
    const context = buildContext(undefined);

    await linksRunner(context, buildAuditContext());

    const passedOptions = runLinksChecksStub.firstCall.args[3];
    expect(passedOptions.excludedElementClasses).to.deep.equal([]);
  });

  it('passes [] when site has no getConfig method at all', async () => {
    // Older site stubs / partial mocks won't define getConfig; the optional
    // chain in links.js must tolerate that without throwing.
    const context = {
      site: {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com',
      },
      job: { getId: () => 'job-123' },
      log: {
        debug: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    await linksRunner(context, buildAuditContext());

    const passedOptions = runLinksChecksStub.firstCall.args[3];
    expect(passedOptions.excludedElementClasses).to.deep.equal([]);
  });

  // ── Insecure-link scan respects the same excludedElementClasses ───────────
  describe('insecure-link scan filtering', () => {
    it('skips http:// anchors inside an excluded subtree', async () => {
      const html = `
        <html><body>
          <div class="cmp-feature-apps">
            <a href="http://timesheet.wal-mart.com/etm">excluded insecure</a>
          </div>
          <main>
            <a href="http://public.example.com/article">kept insecure</a>
            <a href="https://secure.example.com/ok">secure</a>
          </main>
        </body></html>
      `;
      const context = buildContext({
        getHandlers: () => ({
          preflight: { config: { excludedElementClasses: ['cmp-feature-apps'] } },
        }),
      });
      const auditCtx = buildAuditContext(html);

      await linksRunner(context, auditCtx);

      const auditPage = auditCtx.audits.get(previewUrl);
      const badLinks = auditPage.audits[0].opportunities.find((o) => o.check === 'bad-links');

      expect(badLinks).to.exist;
      const urls = badLinks.issue.map((i) => i.url);
      expect(urls).to.deep.equal(['http://public.example.com/article']);
    });

    it('flags all http:// anchors when no classes are configured', async () => {
      const html = `
        <html><body>
          <div class="cmp-feature-apps">
            <a href="http://internal.example.com/x">internal</a>
          </div>
          <a href="http://public.example.com/y">public</a>
        </body></html>
      `;
      const context = buildContext({ getHandlers: () => ({}) });
      const auditCtx = buildAuditContext(html);

      await linksRunner(context, auditCtx);

      const auditPage = auditCtx.audits.get(previewUrl);
      const badLinks = auditPage.audits[0].opportunities.find((o) => o.check === 'bad-links');
      const urls = badLinks.issue.map((i) => i.url).sort();
      expect(urls).to.deep.equal([
        'http://internal.example.com/x',
        'http://public.example.com/y',
      ]);
    });
  });
});
