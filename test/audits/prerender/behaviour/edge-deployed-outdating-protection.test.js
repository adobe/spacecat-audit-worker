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
 * Regression: edge-deployed per-URL suggestions are never passed to bulkUpdateStatus,
 * while non-deployed stale suggestions are.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { BASE_URL, makeSuggestion, runAudit } from './regression-helpers.js';

use(sinonChai);

describe('Prerender regression — edge-deployed outdating protection', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('edge-deployed per-URL suggestion not passed to bulkUpdateStatus', async () => {
    const deployed = makeSuggestion(
      'sug-edge',
      `${BASE_URL}/deployed-page`,
      'NEW',
      { edgeDeployed: Date.now() },
    );

    const { bulkUpdateStatusStub } = await runAudit(sandbox, [deployed]);

    const allCandidates = bulkUpdateStatusStub.args.flat(2);
    expect(allCandidates).not.to.include(deployed);
  });

  it('non-deployed NEW suggestion absent from audit is passed to bulkUpdateStatus', async () => {
    const stale = makeSuggestion(
      'sug-stale',
      `${BASE_URL}/old-page`,
      'NEW',
    );

    const { bulkUpdateStatusStub } = await runAudit(sandbox, [stale]);

    expect(bulkUpdateStatusStub).to.have.been.called;
    const firstCallCandidates = bulkUpdateStatusStub.firstCall.args[0];
    expect(firstCallCandidates).to.include(stale);
  });
});
