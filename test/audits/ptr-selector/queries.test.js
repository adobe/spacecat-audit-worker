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
import { getTotalPageViewsTemplate } from '../../../src/ptr-selector/queries.js';

describe('PTR Selector Queries', () => {
  const defaultParams = {
    siteId: 'test-site',
    tableName: 'rum_metrics.compact_metrics',
    temporalCondition: '(year=2025 AND week IN (1,2,3,4))',
  };

  describe('getTotalPageViewsTemplate', () => {
    it('should generate valid SQL with SUM of pageviews', () => {
      const query = getTotalPageViewsTemplate(defaultParams);

      expect(query).to.be.a('string');
      expect(query).to.include('SUM(pageviews)');
      expect(query).to.include('total_pageview_sum');
    });

    it('should use provided siteId', () => {
      const params = { ...defaultParams, siteId: 'custom-site-123' };
      const query = getTotalPageViewsTemplate(params);

      expect(query).to.include("siteid = 'custom-site-123'");
    });

    it('should use provided tableName', () => {
      const params = { ...defaultParams, tableName: 'my_db.my_table' };
      const query = getTotalPageViewsTemplate(params);

      expect(query).to.include('FROM my_db.my_table');
    });

    it('should use provided temporalCondition', () => {
      const params = { ...defaultParams, temporalCondition: '(year=2024 AND month=12)' };
      const query = getTotalPageViewsTemplate(params);

      expect(query).to.include('(year=2024 AND month=12)');
    });

    it('should be properly formatted with trimmed output', () => {
      const query = getTotalPageViewsTemplate(defaultParams);

      expect(query.trim()).to.equal(query);
    });

    it('should cast result as BIGINT', () => {
      const query = getTotalPageViewsTemplate(defaultParams);

      expect(query).to.include('CAST(SUM(pageviews) AS BIGINT)');
    });

    it('should filter by paid traffic type', () => {
      const query = getTotalPageViewsTemplate(defaultParams);

      expect(query).to.include("trf_type = 'paid'");
    });
  });
});
