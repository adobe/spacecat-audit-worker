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
 * Regression: domain-wide suggestion preservation and keying are unchanged.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { BASE_URL, makeSuggestion, runAudit } from './regression-helpers.js';

use(sinonChai);

describe('Prerender regression — domain-wide suggestion preservation', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('domain-wide suggestion key does not conflict with per-URL key', async () => {
    const domainWide = makeSuggestion(
      'dw-1',
      `${BASE_URL}/* (All Domain URLs)`,
      'NEW',
      { isDomainWide: true, allowedRegexPatterns: ['/*'] },
    );

    const { addSuggestionsStub } = await runAudit(sandbox, [domainWide]);
    const allAdded = addSuggestionsStub.args.flat(2);

    // Preservable domain-wide exists → no new domain-wide created
    const newDomainWide = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(newDomainWide).to.have.lengthOf(0);

    // Per-URL suggestion still created alongside
    const page1 = allAdded.filter((s) => s?.data?.url === `${BASE_URL}/page1`);
    expect(page1).to.have.length.above(0);
  });

  it('SKIPPED domain-wide suggestion is preserved (not replaced)', async () => {
    const skippedDw = makeSuggestion(
      'dw-skipped',
      `${BASE_URL}/* (All Domain URLs)`,
      'SKIPPED',
      { isDomainWide: true },
    );

    const { addSuggestionsStub } = await runAudit(sandbox, [skippedDw]);
    const allAdded = addSuggestionsStub.args.flat(2);

    const newDomainWide = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(newDomainWide).to.have.lengthOf(0);
  });

  it('edgeDeployed domain-wide suggestion is preserved (not replaced)', async () => {
    const deployedDw = makeSuggestion(
      'dw-deployed',
      `${BASE_URL}/* (All Domain URLs)`,
      'NEW',
      { isDomainWide: true, edgeDeployed: Date.now() },
    );

    const { addSuggestionsStub } = await runAudit(sandbox, [deployedDw]);
    const allAdded = addSuggestionsStub.args.flat(2);

    const newDomainWide = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(newDomainWide).to.have.lengthOf(0);
  });

  it('OUTDATED domain-wide is NOT preserved — fresh domain-wide data is prepared and synced', async () => {
    const outdatedDw = makeSuggestion(
      'dw-outdated',
      `${BASE_URL}/* (All Domain URLs)`,
      'OUTDATED',
      { isDomainWide: true, contentGainRatio: 0 },
    );

    await runAudit(sandbox, [outdatedDw]);

    // OUTDATED is NOT in the preserve list → prepareDomainWideAggregateSuggestion runs
    // syncSuggestions matches by key and updates the existing OUTDATED one in place
    expect(outdatedDw.setData).to.have.been.called;
    const updatedData = outdatedDw.setData.lastCall.args[0];
    expect(updatedData).to.have.property('isDomainWide', true);
    expect(updatedData.contentGainRatio).to.be.greaterThan(0);
  });
});
