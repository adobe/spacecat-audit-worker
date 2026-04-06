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
import { categorizeUrl } from '../../../src/cwv-trends-audit/cwv-categorizer.js';

describe('CWV Categorizer', () => {
  describe('categorizeUrl', () => {
    it('returns "good" when all metrics are within good thresholds', () => {
      expect(categorizeUrl(2500, 0.1, 200)).to.equal('good');
    });

    it('returns "poor" when LCP exceeds poor threshold', () => {
      expect(categorizeUrl(4001, 0.05, 100)).to.equal('poor');
    });

    it('returns "poor" when CLS exceeds poor threshold', () => {
      expect(categorizeUrl(2000, 0.26, 100)).to.equal('poor');
    });

    it('returns "poor" when INP exceeds poor threshold', () => {
      expect(categorizeUrl(2000, 0.05, 501)).to.equal('poor');
    });

    it('returns "needsImprovement" when between good and poor', () => {
      expect(categorizeUrl(3000, 0.15, 300)).to.equal('needsImprovement');
    });

    it('returns "needsImprovement" at exact poor boundary (not exceeding)', () => {
      expect(categorizeUrl(4000, 0.25, 500)).to.equal('needsImprovement');
    });

    it('returns null when all metrics are null', () => {
      expect(categorizeUrl(null, null, null)).to.be.null;
    });

    it('returns null when all metrics are undefined', () => {
      expect(categorizeUrl(undefined, undefined, undefined)).to.be.null;
    });

    it('categorizes with partial metrics (only LCP)', () => {
      expect(categorizeUrl(2000, null, null)).to.equal('good');
      expect(categorizeUrl(5000, null, null)).to.equal('poor');
      expect(categorizeUrl(3000, null, null)).to.equal('needsImprovement');
    });

    it('categorizes with partial metrics (only CLS)', () => {
      expect(categorizeUrl(null, 0.05, null)).to.equal('good');
      expect(categorizeUrl(null, 0.30, null)).to.equal('poor');
    });

    it('categorizes with partial metrics (only INP)', () => {
      expect(categorizeUrl(null, null, 100)).to.equal('good');
      expect(categorizeUrl(null, null, 600)).to.equal('poor');
    });
  });
});
