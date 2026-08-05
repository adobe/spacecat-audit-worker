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

import { expect } from 'chai';
import { buildDelta } from '../../../src/gsc-search-analytics/summarize.js';

describe('buildDelta', () => {
  it('builds after-minus-before', () => {
    const d = buildDelta(
      {
        clicks: 3200, impressions: 80000, ctr: 0.040, position: 9.1,
      },
      {
        clicks: 4100, impressions: 85000, ctr: 0.048, position: 7.2,
      },
    );
    expect(d.clicks).to.equal(900);
    expect(d.impressions).to.equal(5000);
    expect(d.ctr).to.be.closeTo(0.008, 1e-9);
    expect(d.position).to.be.closeTo(-1.9, 1e-9); // negative = moved up
  });
});
