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
import { getLowPerformingPaidPagesTemplate } from '../../../src/paid-keyword-optimizer/queries.js';

describe('Paid Keyword Optimizer Queries', () => {
  const defaultParams = {
    siteId: 'test-site',
    tableName: 'rum_metrics.compact_metrics',
    temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
    dimensionColumns: 'trf_type, path, trf_channel',
    groupBy: 'trf_type, path, trf_channel',
    dimensionColumnsPrefixed: 'a.trf_type, a.path, a.trf_channel',
    pageViewThreshold: 1000,
  };

  describe('getLowPerformingPaidPagesTemplate', () => {
    it('should generate valid SQL with required components', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.be.a('string');
      expect(query.length).to.be.greaterThan(100);
      expect(query).to.include('WITH min_totals AS');
      expect(query).to.include('raw AS');
      expect(query).to.include('agg AS');
      expect(query).to.include('grand_total AS');
    });

    it('should use provided siteId parameter', () => {
      const params = { ...defaultParams, siteId: 'custom-site-id' };
      const query = getLowPerformingPaidPagesTemplate(params);

      expect(query).to.include("siteid = 'custom-site-id'");
    });

    it('should use provided tableName parameter', () => {
      const params = { ...defaultParams, tableName: 'my_database.my_table' };
      const query = getLowPerformingPaidPagesTemplate(params);

      expect(query).to.include('FROM my_database.my_table');
    });

    it('should use provided temporalCondition parameter', () => {
      const params = { ...defaultParams, temporalCondition: '(year=2024 AND week=52)' };
      const query = getLowPerformingPaidPagesTemplate(params);

      expect(query).to.include('(year=2024 AND week=52)');
    });

    it('should use provided pageViewThreshold parameter', () => {
      const params = { ...defaultParams, pageViewThreshold: 2000 };
      const query = getLowPerformingPaidPagesTemplate(params);

      expect(query).to.include('HAVING SUM(pageviews) >= 2000');
    });

    it('should filter by trf_channel = search', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.include("trf_channel = 'search'");
    });

    it('should not include consent filter', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.not.include("consent='show'");
    });

    it('should not include LIMIT clause', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.not.include('LIMIT');
    });

    it('should not include pagetype condition', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.not.include('page_type');
      expect(query).to.not.include('pagetype');
    });

    it('should order by traffic_loss DESC', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.include('ORDER BY traffic_loss DESC');
    });

    it('should calculate traffic_loss as pageviews * bounce_rate', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.include('CAST(a.pageviews AS DOUBLE) * (1 - CAST(a.engagements AS DOUBLE) / NULLIF(a.row_count, 0)) AS traffic_loss');
    });

    it('should calculate bounce_rate correctly', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.include('1 - CAST(a.engagements AS DOUBLE) / NULLIF(a.row_count, 0)  AS bounce_rate');
    });

    it('should handle different dimension combinations', () => {
      const params = {
        ...defaultParams,
        dimensionColumns: 'path, trf_type',
        groupBy: 'path, trf_type',
        dimensionColumnsPrefixed: 'a.path, a.trf_type',
      };

      const query = getLowPerformingPaidPagesTemplate(params);
      expect(query).to.include('SELECT\n        path, trf_type,');
      expect(query).to.include('GROUP BY path, trf_type');
    });

    it('should be properly formatted with trimmed output', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query.trim()).to.equal(query);
    });

    it('should include all required metrics in output', () => {
      const query = getLowPerformingPaidPagesTemplate(defaultParams);

      expect(query).to.include('traffic_loss');
      expect(query).to.include('bounce_rate');
      expect(query).to.include('a.pageviews');
      expect(query).to.include('pct_pageviews');
      expect(query).to.include('click_rate');
      expect(query).to.include('engagement_rate');
      expect(query).to.include('engaged_scroll_rate');
      expect(query).to.include('p70_scroll');
      expect(query).to.include('p70_lcp');
      expect(query).to.include('p70_cls');
      expect(query).to.include('p70_inp');
    });

    it('should handle special characters in siteId', () => {
      const params = { ...defaultParams, siteId: "site-with-'quotes'" };
      const query = getLowPerformingPaidPagesTemplate(params);

      expect(query).to.include("site-with-'quotes'");
    });

    it('should handle zero pageViewThreshold', () => {
      const params = { ...defaultParams, pageViewThreshold: 0 };
      const query = getLowPerformingPaidPagesTemplate(params);

      expect(query).to.include('HAVING SUM(pageviews) >= 0');
    });
  });
});
