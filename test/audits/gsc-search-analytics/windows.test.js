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
import { computeWindows, assessCompleteness, isValidFixDate } from '../../../src/gsc-search-analytics/windows.js';

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

describe('isValidFixDate', () => {
  it('accepts a valid ISO date', () => {
    expect(isValidFixDate('2026-03-01')).to.equal(true);
  });
  it('rejects a malformed date', () => {
    expect(isValidFixDate('not-a-date')).to.equal(false);
  });
  it('rejects undefined', () => {
    expect(isValidFixDate(undefined)).to.equal(false);
  });
  it('rejects a rolled-over impossible date (2026-02-30)', () => {
    expect(isValidFixDate('2026-02-30')).to.equal(false);
  });
  it('rejects an out-of-range month/day (2026-13-45)', () => {
    expect(isValidFixDate('2026-13-45')).to.equal(false);
  });
});

describe('assessCompleteness', () => {
  const now = new Date('2026-08-05T00:00:00Z');

  it('marks a long-past window fully complete', () => {
    const windows = computeWindows('2026-03-01'); // after.end 2026-05-24, well past lag
    expect(assessCompleteness(windows, now)).to.deep.equal({ beforeComplete: true, afterComplete: true });
  });

  it('marks the after window incomplete when it has not fully elapsed', () => {
    const windows = { before: { start: '2026-05-01', end: '2026-07-25' }, after: { start: '2026-07-27', end: '2026-10-18' } };
    const c = assessCompleteness(windows, now);
    expect(c.afterComplete).to.equal(false);
  });

  it('marks the before window incomplete when it predates retention', () => {
    const windows = { before: { start: '2023-01-01', end: '2023-03-25' }, after: { start: '2023-03-27', end: '2023-06-18' } };
    const c = assessCompleteness(windows, now);
    expect(c.beforeComplete).to.equal(false);
  });
});
