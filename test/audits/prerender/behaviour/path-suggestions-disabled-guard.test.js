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
 * Regression: coveredByPattern is NOT applied and existing path suggestions
 * are untouched when pathSuggestionsEnabled is false.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { BASE_URL, makeSuggestion, runAudit } from './regression-helpers.js';

use(sinonChai);

describe('Prerender regression — path suggestions disabled guard', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('Suggestion.saveMany not called to set coveredByPattern when path suggestions disabled', async () => {
    const { saveManyStub } = await runAudit(sandbox, [], { siteConfig: null });

    const allSaved = saveManyStub.args.flat(2);
    const coveredByPatternItems = allSaved.filter(
      (s) => typeof s?.getData === 'function' && s.getData()?.coveredByPattern,
    );
    expect(coveredByPatternItems).to.have.lengthOf(0);
  });

  it('existing path suggestion in DB is untouched when path suggestions disabled', async () => {
    const existingPath = makeSuggestion(
      'path-1',
      `${BASE_URL}/blog/*`,
      'NEW',
      { allowedRegexPatterns: ['/blog/*'] },
    );

    const { saveManyStub } = await runAudit(sandbox, [existingPath], { siteConfig: null });

    const allSaved = saveManyStub.args.flat(2);
    expect(allSaved).not.to.include(existingPath);
  });
});
