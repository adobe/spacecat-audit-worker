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
import {
  AUDIT_TYPE, TREND_DAYS, CURRENT_WEEK_DAYS, S3_BASE_PATH,
  MIN_PAGEVIEWS, DEFAULT_DEVICE_TYPE, CWV_THRESHOLDS, OPPORTUNITY_TITLES,
} from '../../../src/cwv-trends-audit/constants.js';

describe('CWV Trends Audit Constants', () => {
  it('should define AUDIT_TYPE', () => {
    expect(AUDIT_TYPE).to.equal('cwv-trends-audit');
  });

  it('should define TREND_DAYS as 28', () => {
    expect(TREND_DAYS).to.equal(28);
  });

  it('should define CURRENT_WEEK_DAYS as 7', () => {
    expect(CURRENT_WEEK_DAYS).to.equal(7);
  });

  it('should define correct S3 base path', () => {
    expect(S3_BASE_PATH).to.equal('metrics/cwv-trends');
  });

  it('should define MIN_PAGEVIEWS as 1000', () => {
    expect(MIN_PAGEVIEWS).to.equal(1000);
  });

  it('should define DEFAULT_DEVICE_TYPE as mobile', () => {
    expect(DEFAULT_DEVICE_TYPE).to.equal('mobile');
  });

  it('should define CWV thresholds', () => {
    expect(CWV_THRESHOLDS.LCP).to.deep.equal({ GOOD: 2500, POOR: 4000 });
    expect(CWV_THRESHOLDS.CLS).to.deep.equal({ GOOD: 0.1, POOR: 0.25 });
    expect(CWV_THRESHOLDS.INP).to.deep.equal({ GOOD: 200, POOR: 500 });
  });

  it('should define opportunity titles', () => {
    expect(OPPORTUNITY_TITLES.mobile).to.equal('Mobile Web Performance Trends Report');
    expect(OPPORTUNITY_TITLES.desktop).to.equal('Desktop Web Performance Trends Report');
  });
});
