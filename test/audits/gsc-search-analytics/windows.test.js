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
import { computeWindows } from '../../../src/gsc-search-analytics/windows.js';

describe('computeWindows', () => {
  it('returns 84-day before/after windows around the fix date', () => {
    const { before, after } = computeWindows('2026-03-01');
    expect(before.start).to.equal('2025-12-07');
    expect(before.end).to.equal('2026-02-28');
    expect(after.start).to.equal('2026-03-02');
    expect(after.end).to.equal('2026-05-24'); // 84 inclusive days, NOT 05-25
  });

  it('throws on an invalid date', () => {
    expect(() => computeWindows('not-a-date')).to.throw('Invalid fix date');
  });
});
