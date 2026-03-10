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
import { expect } from 'chai';
import {
  AUDIT_TYPE,
  TREND_DAYS,
  OPPORTUNITY_TITLES,
  S3_BASE_PATH,
} from '../../../src/cwv-trends-audit/constants.js';

describe('CWV Trends Audit Constants', () => {
  describe('AUDIT_TYPE', () => {
    it('should have correct audit type value', () => {
      expect(AUDIT_TYPE).to.equal('cwv-trends-audit');
    });
  });

  describe('TREND_DAYS', () => {
    it('should be 28 days', () => {
      expect(TREND_DAYS).to.equal(28);
    });
  });

  describe('OPPORTUNITY_TITLES', () => {
    it('should have mobile opportunity title', () => {
      expect(OPPORTUNITY_TITLES).to.have.property('mobile');
      expect(OPPORTUNITY_TITLES.mobile).to.equal('Mobile Web Performance Trends Report');
    });

    it('should have desktop opportunity title', () => {
      expect(OPPORTUNITY_TITLES).to.have.property('desktop');
      expect(OPPORTUNITY_TITLES.desktop).to.equal('Desktop Web Performance Trends Report');
    });
  });

  describe('S3_BASE_PATH', () => {
    it('should have correct S3 base path', () => {
      expect(S3_BASE_PATH).to.equal('/metrics/cwv-trends');
    });
  });
});
