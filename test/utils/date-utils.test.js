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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  getTemporalCondition,
  formatWeekYear,
} from '../../src/utils/date-utils.js';

use(sinonChai);

describe('Date Utils', () => {
  let sandbox;
  let clock;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    if (clock) {
      clock.restore();
      clock = null;
    }
    sandbox.restore();
  });

  describe('getTemporalCondition', () => {
    describe('without week/year parameters (previous week)', () => {
      it('uses current date when no parameter provided - single month', () => {
        // Mock date: March 17, 2025 (Monday of week 12)
        // Previous week (week 11) is entirely within March
        clock = sandbox.useFakeTimers(new Date('2025-03-17T12:00:00Z'));

        const result = getTemporalCondition();

        expect(result).to.equal('year = 2025 AND month = 03 AND week = 11');
      });

      it('uses current date when no parameter provided - spans multiple months', () => {
        // Mock date: February 3, 2025 (Monday of week 6)
        // Previous week (week 5) spans January and February
        clock = sandbox.useFakeTimers(new Date('2025-02-03T12:00:00Z'));

        const result = getTemporalCondition();

        expect(result).to.equal('(year = 2025 AND month = 01 AND week = 05) OR (year = 2025 AND month = 02 AND week = 05)');
      });

      it('uses current date when no parameter provided - spans multiple years', () => {
        // Mock date: February 3, 2025 (Monday of week 6)
        // Previous week (week 5) spans January and February
        clock = sandbox.useFakeTimers(new Date('2026-01-05T12:00:00Z'));

        const result = getTemporalCondition();

        expect(result).to.equal('(year = 2025 AND month = 12 AND week = 01) OR (year = 2026 AND month = 01 AND week = 01)');
      });
    });

    describe('with week/year parameters (specific week)', () => {
      it('returns SQL condition for specific week when week spans single month', () => {
        // Week 11 of 2025 is entirely within March
        const result = getTemporalCondition(11, 2025);

        expect(result).to.equal('year = 2025 AND month = 03 AND week = 11');
      });

      it('returns SQL condition with OR when week spans multiple months', () => {
        // Week 5 of 2025 spans January and February
        const result = getTemporalCondition(5, 2025);

        expect(result).to.equal('(year = 2025 AND month = 01 AND week = 05) OR (year = 2025 AND month = 02 AND week = 05)');
      });

      it('handles week 1 correctly', () => {
        const result = getTemporalCondition(1, 2025);

        expect(result).to.equal('(year = 2024 AND month = 12 AND week = 01) OR (year = 2025 AND month = 01 AND week = 01)');
      });

      it('handles week 52 correctly', () => {
        const result = getTemporalCondition(52, 2024);

        expect(result).to.equal('year = 2024 AND month = 12 AND week = 52');
      });
    });
  });

  describe('formatWeekYear', () => {
    describe('without week/year parameters (previous week)', () => {
      it('uses current date when no parameter provided - single month', () => {
        // Mock date: March 17, 2025 (Monday of week 12)
        // Previous week is week 11
        clock = sandbox.useFakeTimers(new Date('2025-03-17T12:00:00Z'));

        const result = formatWeekYear();

        expect(result).to.equal('11-2025');
      });

      it('uses current date when no parameter provided - spans multiple months', () => {
        // Mock date: February 3, 2025 (Monday of week 6)
        // Previous week (week 5) spans January and February
        clock = sandbox.useFakeTimers(new Date('2025-02-03T12:00:00Z'));

        const result = formatWeekYear();

        expect(result).to.equal('05-2025');
      });
    });

    describe('with week/year parameters (specific week)', () => {
      it('returns formatted week-year string', () => {
        const result = formatWeekYear(10, 2025);

        expect(result).to.equal('10-2025');
      });

      it('handles single-digit weeks with padding', () => {
        const result = formatWeekYear(5, 2025);

        expect(result).to.equal('05-2025');
      });

      it('handles week 1', () => {
        const result = formatWeekYear(1, 2025);

        expect(result).to.equal('01-2025');
      });

      it('handles week 52', () => {
        const result = formatWeekYear(52, 2024);

        expect(result).to.equal('52-2024');
      });

      it('handles week 53 for years with 53 weeks', () => {
        const result = formatWeekYear(53, 2020);

        expect(result).to.equal('53-2020');
      });

      it('handles different years correctly', () => {
        expect(formatWeekYear(10, 2024)).to.equal('10-2024');
        expect(formatWeekYear(10, 2025)).to.equal('10-2025');
        expect(formatWeekYear(10, 2026)).to.equal('10-2026');
      });
    });
  });
});
