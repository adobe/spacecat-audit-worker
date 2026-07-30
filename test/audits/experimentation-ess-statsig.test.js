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
import { calculatePValueAndPower, computeStatsig } from '../../src/experimentation-ess/statsig.js';

// Reference values captured by running the Python StatsigHandler (statsmodels 0.14.2) in
// adobe/spacecat-services-statistics over the same inputs — the port must match within tolerance.
const P_TOL = 1e-6;
const POWER_TOL = 0.1;

describe('experimentation-ess statsig (Node port of statistics-service, SITES-47215)', () => {
  describe('calculatePValueAndPower — matches statsmodels reference', () => {
    it('significant difference (100/1000 vs 150/1000)', () => {
      const r = calculatePValueAndPower(100, 1000, 150, 1000);
      expect(r.p_value).to.be.closeTo(0.0007232327, P_TOL);
      expect(r.power).to.be.closeTo(100.0, POWER_TOL);
      expect(r.statsig.toLowerCase()).to.equal('true');
    });

    it('not significant (50/500 vs 55/500)', () => {
      const r = calculatePValueAndPower(50, 500, 55, 500);
      expect(r.p_value).to.be.closeTo(0.6060086208, P_TOL);
      expect(r.power).to.be.closeTo(17.81, POWER_TOL);
      expect(r.statsig.toLowerCase()).to.equal('false');
    });

    // Large-N guard: naive forward-from-0 non-central chi-square underflows/NaNs here and
    // would return power 0/NaN; ncp = h^2 * N ~= 814, so power must resolve to 100.
    it('large N with big non-centrality (10000/100000 vs 12000/100000)', () => {
      const r = calculatePValueAndPower(10000, 100000, 12000, 100000);
      expect(r.p_value).to.be.closeTo(0.0, P_TOL);
      expect(r.power).to.be.closeTo(100.0, POWER_TOL);
      expect(Number.isFinite(r.power)).to.equal(true);
      expect(r.statsig.toLowerCase()).to.equal('true');
    });

    // Identical rates -> non-centrality 0 -> power collapses to alpha (5%); exercises the
    // lambda === 0 branch and the z === 0 (x <= 0) gamma path.
    it('identical rates (100/1000 vs 100/1000)', () => {
      const r = calculatePValueAndPower(100, 1000, 100, 1000);
      expect(r.p_value).to.be.closeTo(1.0, P_TOL);
      expect(r.power).to.be.closeTo(5.0, POWER_TOL);
      expect(r.statsig.toLowerCase()).to.equal('false');
    });

    it('zero metrics on both sides -> NaN p-value error', () => {
      expect(calculatePValueAndPower(0, 1000, 0, 1000)).to.deep.equal({ error: 'p-value is NaN' });
    });
  });

  describe('computeStatsig', () => {
    it('computes per-variant stats and skips control; flags variants missing views/metrics', () => {
      const result = computeStatsig({
        'exp-1#https://x/': {
          control: { views: 1000, metrics: 100 },
          'challenger-1': { views: 1000, metrics: 150 },
          'challenger-2': { views: 1000 }, // missing metrics
        },
      });
      const exp = result['exp-1#https://x/'];
      expect(exp).to.not.have.property('control');
      expect(exp['challenger-1'].p_value).to.be.closeTo(0.0007232327, P_TOL);
      expect(exp['challenger-1'].statsig.toLowerCase()).to.equal('true');
      expect(exp['challenger-2']).to.deep.equal({ error: 'No views or metrics for variant' });
    });

    it('flags a variant missing views', () => {
      const result = computeStatsig({
        e: { control: { views: 100, metrics: 10 }, v: { metrics: 5 } },
      });
      expect(result.e.v).to.deep.equal({ error: 'No views or metrics for variant' });
    });

    it('returns "No control group" when control is absent', () => {
      expect(computeStatsig({ e: { 'challenger-1': { views: 10, metrics: 1 } } }).e)
        .to.deep.equal({ error: 'No control group' });
    });

    it('returns "No control group" when control is missing metrics', () => {
      expect(computeStatsig({ e: { control: { views: 100 } } }).e)
        .to.deep.equal({ error: 'No control group' });
    });

    it('returns "No control group" when control is missing views', () => {
      expect(computeStatsig({ e: { control: { metrics: 10 } } }).e)
        .to.deep.equal({ error: 'No control group' });
    });

    it('handles multiple experiments', () => {
      const result = computeStatsig({
        a: { control: { views: 500, metrics: 50 }, t: { views: 500, metrics: 55 } },
        b: { control: { views: 1000, metrics: 100 }, t: { views: 1000, metrics: 100 } },
      });
      expect(result.a.t.statsig.toLowerCase()).to.equal('false');
      expect(result.b.t.p_value).to.be.closeTo(1.0, P_TOL);
    });
  });
});
