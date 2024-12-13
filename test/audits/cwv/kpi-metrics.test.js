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
import calculateKpiDeltasForAudit from '../../../src/cwv/kpi-metrics.js';

use(sinonChai);
use(chaiAsPromised);

describe('calculates KPI deltas correctly', () => {
  const sandbox = sinon.createSandbox();
  let mockDataAccess;

  beforeEach(() => {
    mockDataAccess = {
      getSiteByID: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('with traffic adjustment', async () => {
    const auditData = {
      auditResult: {
        cwv: [
          {
            type: 'group',
            name: 'Some pages',
            pattern: 'https://www.aem.live/home/*',
            pageviews: 4000,
            organic: 2900,
            metrics: [
              {
                deviceType: 'desktop',
                pageviews: 3000,
                organic: 2000,
                // Needs Improvement (1 "green" metric)
                lcp: 2000, // < 2500 threshold (green)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
              {
                deviceType: 'mobile',
                pageviews: 1000,
                organic: 900,
                // Poor (0 "green" metrics)
                lcp: 2700, // > 2500 threshold (poor)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
            ],
          },
        ],
      },
    };

    const expectedAggregatedKpi = {
      // (2000 organic per device * 0.005 koeff) + (900 organic per device * 0.015 koeff) = 23.5
      projectedTrafficLost: 23.5,
      projectedTrafficValue: 23.5,
    };

    const result = calculateKpiDeltasForAudit(auditData, mockDataAccess);
    expect(result).to.deep.equal(expectedAggregatedKpi);
  });

  it('without traffic adjustment', async () => {
    const auditData = {
      auditResult: {
        cwv: [
          {
            type: 'url',
            url: 'https://www.aem.live/home/',
            pageviews: 4000,
            organic: 2900,
            metrics: [
              {
                deviceType: 'desktop',
                pageviews: 3000,
                organic: 2000,
                // Very Fast (3 "green" metric)
                lcp: 2000, // < 2500 threshold (green)
                cls: 0.01, // < 0.1 threshold (green)
                inp: 190, // < 200 threshold (green)
              },
              {
                deviceType: 'mobile',
                pageviews: 1000,
                organic: 900,
                // Good (2 "green" metrics)
                lcp: 2000, // < 2500 threshold (green)
                cls: 0.01, // < 0.1 threshold (green)
                inp: 220, // > 200 threshold (poor)
              },
            ],
          },
        ],
      },
    };

    const expectedAggregatedKpi = {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    };

    const result = calculateKpiDeltasForAudit(auditData, mockDataAccess);
    expect(result).to.deep.equal(expectedAggregatedKpi);
  });

  it('combined audit entries', async () => {
    const auditData = {
      auditResult: {
        cwv: [
          {
            type: 'group',
            name: 'Some pages',
            pattern: 'https://www.aem.live/home/*',
            pageviews: 4000,
            organic: 2900,
            metrics: [
              {
                deviceType: 'desktop',
                pageviews: 3000,
                organic: 2000,
                // Needs Improvement (1 "green" metric)
                lcp: 2000, // < 2500 threshold (green)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
              {
                deviceType: 'mobile',
                pageviews: 1000,
                organic: 900,
                // Poor (0 "green" metrics)
                lcp: 2700, // > 2500 threshold (poor)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
            ],
          },
          {
            type: 'url',
            url: 'https://www.aem.live/info/',
            pageviews: 4000,
            organic: 2900,
            metrics: [
              {
                deviceType: 'desktop',
                pageviews: 3000,
                organic: 2000,
                // Very Fast (3 "green" metric)
                lcp: 2000, // < 2500 threshold (green)
                cls: 0.01, // < 0.1 threshold (green)
                inp: 190, // < 200 threshold (green)
              },
              {
                deviceType: 'mobile',
                pageviews: 1000,
                organic: 900,
                // Poor (0 "green" metrics)
                lcp: 2700, // > 2500 threshold (poor)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
            ],
          },
        ],
      },
    };

    const expectedAggregatedKpi = {
      // (2000 * 0.005) + (900 * 0.015) + (900 * 0.015) = 37
      projectedTrafficLost: 37,
      projectedTrafficValue: 37,
    };

    const result = calculateKpiDeltasForAudit(auditData, mockDataAccess);
    expect(result).to.deep.equal(expectedAggregatedKpi);
  });

  it('entries without metrics', async () => {
    const auditData = {
      auditResult: {
        cwv: [
          {
            type: 'group',
            name: 'Some pages',
            pattern: 'https://www.aem.live/home/*',
            pageviews: 4000,
            organic: 2900,
            metrics: [],
          },
        ],
      },
    };

    const expectedAggregatedKpi = {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    };

    const result = calculateKpiDeltasForAudit(auditData, mockDataAccess);
    expect(result).to.deep.equal(expectedAggregatedKpi);
  });

  it('entries without organic', async () => {
    const auditData = {
      auditResult: {
        cwv: [
          {
            type: 'group',
            name: 'Some pages',
            pattern: 'https://www.aem.live/home/*',
            pageviews: 4000,
            metrics: [
              {
                deviceType: 'desktop',
                pageviews: 3000,
                lcp: 2000,
                cls: 0.01,
                inp: 190,
              },
              {
                deviceType: 'mobile',
                pageviews: 1000,
                lcp: 2000,
                cls: 0.01,
                inp: 220,
              },
            ],
          },
        ],
      },
    };

    const expectedAggregatedKpi = {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    };

    const result = calculateKpiDeltasForAudit(auditData, mockDataAccess);
    expect(result).to.deep.equal(expectedAggregatedKpi);
  });

  it('prevents double traffic adjustment for URLs already included in groups', async () => {
    const auditData = {
      auditResult: {
        cwv: [
          {
            type: 'group',
            name: 'Some pages',
            pattern: 'https://www.aem.live/pages/*',
            pageviews: 4000,
            organic: 2900,
            metrics: [
              {
                deviceType: 'desktop',
                pageviews: 3000,
                organic: 2000,
                // Needs Improvement (1 "green" metric)
                lcp: 2000, // < 2500 threshold (green)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
              {
                deviceType: 'mobile',
                pageviews: 1000,
                organic: 900,
                // Poor (0 "green" metrics)
                lcp: 2700, // > 2500 threshold (poor)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
            ],
          },
          // Should be skipped (not affect the result),
          // because the URL is already included in the group above
          {
            type: 'url',
            url: 'https://www.aem.live/pages/page-1',
            pageviews: 4000,
            organic: 2900,
            metrics: [
              {
                deviceType: 'mobile',
                pageviews: 1000,
                organic: 900,
                // Poor (0 "green" metrics)
                lcp: 2700, // > 2500 threshold (poor)
                cls: 0.2, // > 0.1 threshold (poor)
                inp: 220, // > 200 threshold (poor)
              },
            ],
          },
        ],
      },
    };

    const groupedURLs = [
      { name: 'Pages', pattern: 'https://www.aem.live/pages/*' },
    ];

    const expectedAggregatedKpi = {
      // (2000 * 0.005) + (900 * 0.015)  = 23.5
      projectedTrafficLost: 23.5,
      projectedTrafficValue: 23.5,
    };

    const result = calculateKpiDeltasForAudit(auditData, mockDataAccess, groupedURLs);
    expect(result).to.deep.equal(expectedAggregatedKpi);
  });
});
