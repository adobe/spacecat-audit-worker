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
 * Regression: processOpportunityAndSuggestions return shape
 * (opportunity + auditRunCandidates) is stable.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { BASE_URL, runAudit } from './regression-helpers.js';

use(sinonChai);

describe('Prerender regression — handler return shape', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('returns opportunity and auditRunCandidates array', async () => {
    const { result } = await runAudit(sandbox, []);

    expect(result).to.have.property('opportunity');
    expect(result).to.have.property('auditRunCandidates').that.is.an('array');
    expect(result.auditRunCandidates.length).to.be.greaterThan(0);
  });

  it('auditRunCandidates carry url, originalHtmlMarkdownKey, and markdownDiffKey', async () => {
    const { result } = await runAudit(sandbox, [], { scrapeJobId: 'job-md' });

    const [candidate] = result.auditRunCandidates;
    expect(candidate).to.have.property('url', `${BASE_URL}/page1`);
    expect(candidate).to.have.property('originalHtmlMarkdownKey')
      .that.includes('server-side-html.md');
    expect(candidate).to.have.property('markdownDiffKey')
      .that.includes('markdown-diff.md');
  });
});
