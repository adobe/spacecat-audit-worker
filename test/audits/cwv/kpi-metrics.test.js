/*
 * Copyright 2024 Adobe. All rights reserved.
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
import chaiAsPromised from 'chai-as-promised';
import calculateKpiDeltas from '../../../src/cwv/kpi-metrics.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

describe('CWVRunner Tests', () => {
  beforeEach('setup', () => {
    // Add any necessary setup here
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should calculate correct KPI deltas per device', async () => {
    const samplePageData = {
      type: 'group',
      name: 'Sample Page',
      pattern: 'https://www.example.com/home/*',
      pageviews: 10000,
      organic: 2000,
      metrics: [
        {
          deviceType: 'desktop',
          pageviews: 4000,
          lcp: 3500,
          cls: 0.2,
          inp: 250,
        },
        {
          deviceType: 'mobile',
          pageviews: 6000,
          lcp: 4500,
          cls: 0.3,
          inp: 300,
        }
      ]
    };

    const cpcValue = 2;

    const expectedKpi = {
      desktop: {
        projectedTrafficLost: 10,
        projectedTrafficValue: 20,
      },
      mobile: {
        projectedTrafficLost: 18,
        projectedTrafficValue: 36,
      }
    };

    const result = calculateKpiDeltas(samplePageData, cpcValue);

    expect(result).to.deep.equal(expectedKpi);
  });

  it('should handle empty metrics gracefully', async () => {
  });
});

