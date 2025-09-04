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
import { describe } from 'mocha';
import { getPaidTrafficAnalysisTemplate } from '../../../src/paid-cookie-consent/queries.js';

describe('Paid Cookie Consent Queries', () => {
  const defaultParams = {
    siteId: 'test-site',
    tableName: 'rum_metrics.compact_metrics',
    temporalCondition: '(year=2025 AND month=8)',
    trfTypeCondition: "trf_type = 'paid'",
    dimensionColumns: 'path, utm_source',
    groupBy: 'path, utm_source',
    dimensionColumnsPrefixed: 'a.path, a.utm_source',
    pageTypeCase: "'uncategorized' as page_type",
    pageViewThreshold: 1000,
  };

  describe('getPaidTrafficAnalysisTemplate', () => {
    it('should generate valid SQL with required components', () => {
      const query = getPaidTrafficAnalysisTemplate(defaultParams);

      expect(query).to.be.a('string');
      expect(query.length).to.be.greaterThan(100);
    });

    it('should use provided parameters', () => {
      const params = { ...defaultParams, siteId: 'custom-site', pageViewThreshold: 2000 };
      const query = getPaidTrafficAnalysisTemplate(params);

      expect(query).to.include('custom-site');
      expect(query).to.include('2000');
    });

    it('should handle different dimension combinations', () => {
      const params = {
        ...defaultParams,
        dimensionColumns: 'path, consent',
        groupBy: 'path, consent',
        dimensionColumnsPrefixed: 'a.path, a.consent',
      };

      const query = getPaidTrafficAnalysisTemplate(params);
      expect(query).to.include('path, consent');
    });

    it('should be properly formatted', () => {
      const query = getPaidTrafficAnalysisTemplate(defaultParams);

      expect(query.trim()).to.equal(query);
      expect(query).to.match(/ORDER BY.*DESC$/);
    });
  });
});
