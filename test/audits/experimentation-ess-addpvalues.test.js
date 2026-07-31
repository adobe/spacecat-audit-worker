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
import { expect } from 'chai';
import esmock from 'esmock';

const COMMON = '../../src/experimentation-ess/common.js';
const STATSIG = '../../src/experimentation-ess/statsig.js';

// Load common.js through esmock for every case (including the real-calc one) so c8 attributes
// coverage of common.js to a single module instance — mixing a static import with esmock of the
// same file splits coverage. Passing no override uses the real computeStatsig.
const loadAddPValues = async (statsigMock) => {
  const mod = await esmock(COMMON, statsigMock ? { [STATSIG]: statsigMock } : {});
  return mod.addPValues;
};

// Guards the glue between the tested statsig calc and the tested persistence: addPValues builds
// rumData from variants, runs computeStatsig, and writes p_value/power/statsig back onto each
// variant (skipping control and error variants). SITES-47215.
describe('experimentation-ess addPValues (statsig integration glue)', () => {
  it('writes stats onto valid variants and skips control / error / no-metrics variants', async () => {
    const addPValues = await loadAddPValues();
    const experimentData = [
      {
        id: 'exp1',
        url: 'https://x/',
        conversionEventName: 'click', // explicit metric name
        variants: [
          { name: 'control', samples: 1000, metrics: [{ type: 'click', selector: '*', samples: 100 }] },
          { name: 'challenger-1', samples: 1000, metrics: [{ type: 'click', selector: '*', samples: 150 }] },
          { name: 'challenger-2', samples: 0, metrics: [{ type: 'click', selector: '*', samples: 0 }] }, // 0 views -> error
        ],
      },
      {
        id: 'exp2',
        url: 'https://y/', // no conversionEventName -> defaults to 'click'
        variants: [
          { name: 'challenger-1', samples: 500, metrics: [{ type: 'click', selector: '*', samples: 50 }] }, // no control
        ],
      },
      {
        id: 'exp3',
        url: 'https://z/',
        variants: [
          { name: 'control', samples: 1000, metrics: [{ type: 'click', selector: '*', samples: 100 }] },
          { name: 'challenger-1' }, // no samples/metrics -> 0 views -> error
          { name: 'challenger-2', samples: 800, metrics: [{ type: 'convert', selector: '#x', samples: 50 }] }, // metric not matched -> 0
        ],
      },
    ];

    await addPValues(experimentData);

    const [e1, e2, e3] = experimentData;
    expect(e1.variants[0]).to.not.have.property('p_value'); // control untouched
    expect(e1.variants[1].p_value).to.be.closeTo(0.0007232327, 1e-6); // 100/1000 vs 150/1000
    expect(e1.variants[1].power).to.be.closeTo(100, 0.1);
    expect(e1.variants[1].statsig).to.equal(true);
    expect(e1.variants[2]).to.not.have.property('p_value'); // 0 views -> error -> skipped
    expect(e2.variants[0]).to.not.have.property('p_value'); // whole experiment errored (no control)
    expect(e3.variants[0]).to.not.have.property('p_value'); // control
    expect(e3.variants[1]).to.not.have.property('p_value'); // 0 views -> error
    expect(e3.variants[2].p_value).to.be.a('number'); // unmatched metric still computes
    expect(e3.variants[2].statsig).to.be.a('boolean');
  });

  it('returns without enriching variants when computeStatsig throws (swallowed)', async () => {
    const addPValues = await loadAddPValues({ computeStatsig: () => { throw new Error('boom'); } });
    const experimentData = [{
      id: 'e', url: 'https://x/', variants: [{ name: 'challenger-1', samples: 100, metrics: [] }],
    }];

    await addPValues(experimentData);

    expect(experimentData[0].variants[0]).to.not.have.property('p_value');
  });

  it('skips a variant whose computed p_value is NaN', async () => {
    const addPValues = await loadAddPValues({
      computeStatsig: () => ({
        'e#https://x/': { 'challenger-1': { p_value: NaN, power: 0, statsig: 'false' } },
      }),
    });
    const experimentData = [{
      id: 'e', url: 'https://x/', variants: [{ name: 'challenger-1', samples: 100, metrics: [] }],
    }];

    await addPValues(experimentData);

    expect(experimentData[0].variants[0]).to.not.have.property('p_value');
  });
});
