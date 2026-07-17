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

/**
 * Regression: per-URL suggestion sync, data shape, and keying are unchanged
 * after the path-level-suggestions refactor.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { BASE_URL, runAudit } from './regression-helpers.js';

use(sinonChai);

describe('Prerender regression — per-URL suggestion sync', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('per-URL suggestions are synced when path suggestions are disabled', async () => {
    const { addSuggestionsStub } = await runAudit(sandbox, [], { siteConfig: null });

    expect(addSuggestionsStub).to.have.been.called;
    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestions = allAdded.filter((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestions).to.have.length.above(0);
  });

  it('scrapeJobId is persisted in per-URL suggestion data', async () => {
    const jobId = 'scrape-job-xyz';
    const { addSuggestionsStub } = await runAudit(sandbox, [], { scrapeJobId: jobId });

    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestion = allAdded.find((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestion.data.scrapeJobId).to.equal(jobId);
  });

  it('per-URL suggestion data includes originalHtmlKey and prerenderedHtmlKey', async () => {
    const { addSuggestionsStub } = await runAudit(sandbox, [], { scrapeJobId: 'j-s3' });

    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestion = allAdded.find((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestion.data).to.have.property('originalHtmlKey')
      .that.includes('server-side.html');
    expect(urlSuggestion.data).to.have.property('prerenderedHtmlKey')
      .that.includes('client-side.html');
  });

  it('per-URL suggestion data includes citabilityScore', async () => {
    const { addSuggestionsStub } = await runAudit(sandbox, []);

    const allAdded = addSuggestionsStub.args.flat(2);
    const urlSuggestion = allAdded.find((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(urlSuggestion.data).to.have.property('citabilityScore');
  });

  it('multiple per-URL suggestions are all synced', async () => {
    const auditResults = [
      {
        url: `${BASE_URL}/page-a`, needsPrerender: true, contentGainRatio: 2.0, wordCountBefore: 50, wordCountAfter: 100,
      },
      {
        url: `${BASE_URL}/page-b`, needsPrerender: true, contentGainRatio: 3.0, wordCountBefore: 80, wordCountAfter: 240,
      },
      {
        url: `${BASE_URL}/page-c`, needsPrerender: true, contentGainRatio: 1.5, wordCountBefore: 60, wordCountAfter: 90,
      },
    ];

    const { addSuggestionsStub } = await runAudit(sandbox, [], { auditResults });

    const allAdded = addSuggestionsStub.args.flat(2);
    const urls = allAdded.map((s) => s?.data?.url).filter(Boolean);
    expect(urls).to.include(`${BASE_URL}/page-a`);
    expect(urls).to.include(`${BASE_URL}/page-b`);
    expect(urls).to.include(`${BASE_URL}/page-c`);
  });
});
