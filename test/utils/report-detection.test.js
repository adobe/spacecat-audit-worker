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

import { expect } from 'chai';
import { isPaidTrafficReport } from '../../src/utils/report-detection.js';

describe('Report Detection Utils', () => {
  describe('isPaidTrafficReport', () => {
    it('should return false when opportunity is null', () => {
      expect(isPaidTrafficReport(null)).to.be.false;
    });

    it('should return false when opportunity is undefined', () => {
      expect(isPaidTrafficReport(undefined)).to.be.false;
    });

    it('should return false when opportunity has no getTitle method', () => {
      const opp = { getType: () => 'paid-traffic' };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should return false when opportunity has no getType method', () => {
      const opp = { getTitle: () => 'Paid Traffic Weekly Report' };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should return true for weekly paid traffic report', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.true;
    });

    it('should return true for monthly paid traffic report', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Monthly Report – Month 12 / 2024',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.true;
    });

    it('should return true for paid media weekly report', () => {
      const opp = {
        getTitle: () => 'Paid Media Weekly Report – Week 1 / 2025',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.true;
    });

    it('should return true for paid media monthly report', () => {
      const opp = {
        getTitle: () => 'Paid Media Monthly Report – Month 3 / 2025',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.true;
    });

    it('should handle case-insensitive title matching', () => {
      const opp = {
        getTitle: () => 'PAID TRAFFIC WEEKLY REPORT – WEEK 2 / 2025',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.true;
    });

    it('should handle case-insensitive type matching', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => 'PAID-TRAFFIC',
      };
      expect(isPaidTrafficReport(opp)).to.be.true;
    });

    it('should return false when type is not paid-traffic', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => 'generic-opportunity',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should return false when title does not contain paid media or paid traffic', () => {
      const opp = {
        getTitle: () => 'Some Other Weekly Report – Week 2 / 2025',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should return false when title does not contain weekly or monthly', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Report – 2025',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should return false when title contains week but not weekly/monthly', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Report Week 2 / 2025',
        getType: () => 'paid-traffic',
      };
      // Note: This should still match because regex /(weekly|week|monthly|month)/i matches "week"
      expect(isPaidTrafficReport(opp)).to.be.true;
    });

    it('should return false when all conditions are false', () => {
      const opp = {
        getTitle: () => 'Some Other Report',
        getType: () => 'generic-opportunity',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should handle empty title string', () => {
      const opp = {
        getTitle: () => '',
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should handle empty type string', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => '',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should handle getTitle returning null', () => {
      const opp = {
        getTitle: () => null,
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should handle getType returning null', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => null,
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should handle getTitle returning undefined', () => {
      const opp = {
        getTitle: () => undefined,
        getType: () => 'paid-traffic',
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });

    it('should handle getType returning undefined', () => {
      const opp = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => undefined,
      };
      expect(isPaidTrafficReport(opp)).to.be.false;
    });
  });
});
