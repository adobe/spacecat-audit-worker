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

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { postProcessor } from '../../src/experimentation-ess/common.js';

use(sinonChai);

describe('experimentation-ess postProcessor persistence (SITES-47215)', () => {
  const sandbox = sinon.createSandbox();
  let context;
  let Experiment;
  let auditData;

  const SETTERS = [
    'setName', 'setUrl', 'setStartDate', 'setEndDate', 'setStatus',
    'setType', 'setVariants', 'setConversionEventName', 'setConversionEventValue',
  ];

  beforeEach(() => {
    Experiment = {
      allBySiteIdAndExpId: sandbox.stub(),
      create: sandbox.stub().resolves({}),
    };
    context = {
      log: { info: sandbox.stub(), error: sandbox.stub() },
      dataAccess: { Experiment },
    };
    // fresh per test — the merge logic mutates experiment.variants in place
    auditData = {
      siteId: 'site-1',
      auditResult: [{
        id: 'nav-mobile-left-right',
        label: 'Nav experiment',
        url: 'https://www.example.com/',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        status: 'ACTIVE',
        type: 'full',
        variants: [{ name: 'control' }, { name: 'challenger-1' }],
        conversionEventName: 'click',
        conversionEventValue: 'cta',
      }],
    };
  });

  afterEach(() => sandbox.restore());

  it('creates a new Experiment when none exists', async () => {
    Experiment.allBySiteIdAndExpId.resolves([]);

    await postProcessor('https://www.example.com/', auditData, context);

    expect(Experiment.create).to.have.been.calledOnce;
    expect(Experiment.create.firstCall.args[0]).to.include({
      siteId: 'site-1',
      expId: 'nav-mobile-left-right',
      status: 'ACTIVE',
    });
  });

  // Regression guard: before the fix the post-processor always called Experiment.create,
  // which under v3 (Aurora) is a strict INSERT and threw
  // "duplicate key value violates unique constraint unique_site_exp" on every re-run.
  it('updates the existing Experiment instead of inserting a duplicate', async () => {
    const existing = {
      startDate: '2026-06-01', // earlier than audit -> should win
      endDate: '2026-08-31', // later than audit -> should win
      url: 'https://www.example.com/existing', // already set -> preserved
      variants: [{ name: 'control', split: '0.5' }],
      save: sandbox.stub().resolves(),
    };
    SETTERS.forEach((m) => { existing[m] = sandbox.stub().returns(existing); });
    Experiment.allBySiteIdAndExpId.resolves([existing]);

    await postProcessor('https://www.example.com/', auditData, context);

    // the core regression assertion: no duplicate INSERT
    expect(Experiment.create).to.not.have.been.called;
    expect(existing.save).to.have.been.calledOnce;
    // merged values are applied via setters
    expect(existing.setStatus).to.have.been.calledWith('ACTIVE');
    expect(existing.setStartDate).to.have.been.calledWith('2026-06-01');
    expect(existing.setEndDate).to.have.been.calledWith('2026-08-31');
    expect(existing.setUrl).to.have.been.calledWith('https://www.example.com/existing');
  });
});
