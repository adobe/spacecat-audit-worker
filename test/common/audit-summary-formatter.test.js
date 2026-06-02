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
import {
  formatAuditSummary,
  formatFinding,
} from '../../src/common/audit-summary-formatter.js';

describe('audit-summary-formatter', () => {
  describe('formatAuditSummary', () => {
    it('renders all four sections when time is provided', () => {
      const result = formatAuditSummary({
        serves: 'site owners',
        ingredients: ['robots.txt', 'sitemap.xml'],
        method: ['Validate robots.txt directives', 'Resubmit sitemap to Google Search Console'],
        time: '15 minutes',
      });
      expect(result).to.equal([
        '## Serves',
        'site owners',
        '',
        '## Ingredients',
        '- robots.txt',
        '- sitemap.xml',
        '',
        '## Method',
        '1. Validate robots.txt directives',
        '2. Resubmit sitemap to Google Search Console',
        '',
        '## Time',
        '15 minutes',
      ].join('\n'));
    });

    it('omits the Time section when time is not provided', () => {
      const result = formatAuditSummary({
        serves: 'platform engineers',
        ingredients: ['CloudWatch logs'],
        method: ['Inspect logs for the failing audit run'],
      });
      expect(result).to.not.include('## Time');
    });

    it('omits the Time section when time is an empty string', () => {
      const result = formatAuditSummary({
        serves: 'platform engineers',
        ingredients: ['CloudWatch logs'],
        method: ['Inspect logs'],
        time: '',
      });
      expect(result).to.not.include('## Time');
    });

    it('omits the Time section when time is not a string', () => {
      const result = formatAuditSummary({
        serves: 'platform engineers',
        ingredients: ['CloudWatch logs'],
        method: ['Inspect logs'],
        time: 15,
      });
      expect(result).to.not.include('## Time');
    });

    it('throws TypeError when serves is missing', () => {
      expect(() => formatAuditSummary({
        ingredients: ['robots.txt'],
        method: ['Validate'],
      })).to.throw(TypeError, '`serves` must be a non-empty string');
    });

    it('throws TypeError when serves is not a string', () => {
      expect(() => formatAuditSummary({
        serves: 42,
        ingredients: ['robots.txt'],
        method: ['Validate'],
      })).to.throw(TypeError, '`serves` must be a non-empty string');
    });

    it('throws TypeError when serves is empty', () => {
      expect(() => formatAuditSummary({
        serves: '',
        ingredients: ['robots.txt'],
        method: ['Validate'],
      })).to.throw(TypeError, '`serves` must be a non-empty string');
    });

    it('throws TypeError when ingredients is missing', () => {
      expect(() => formatAuditSummary({
        serves: 'site owners',
        method: ['Validate'],
      })).to.throw(TypeError, '`ingredients` must be a non-empty array');
    });

    it('throws TypeError when ingredients is not an array', () => {
      expect(() => formatAuditSummary({
        serves: 'site owners',
        ingredients: 'robots.txt',
        method: ['Validate'],
      })).to.throw(TypeError, '`ingredients` must be a non-empty array');
    });

    it('throws TypeError when ingredients is empty', () => {
      expect(() => formatAuditSummary({
        serves: 'site owners',
        ingredients: [],
        method: ['Validate'],
      })).to.throw(TypeError, '`ingredients` must be a non-empty array');
    });

    it('throws TypeError when method is missing', () => {
      expect(() => formatAuditSummary({
        serves: 'site owners',
        ingredients: ['robots.txt'],
      })).to.throw(TypeError, '`method` must be a non-empty array');
    });

    it('throws TypeError when method is not an array', () => {
      expect(() => formatAuditSummary({
        serves: 'site owners',
        ingredients: ['robots.txt'],
        method: 'Validate',
      })).to.throw(TypeError, '`method` must be a non-empty array');
    });

    it('throws TypeError when method is empty', () => {
      expect(() => formatAuditSummary({
        serves: 'site owners',
        ingredients: ['robots.txt'],
        method: [],
      })).to.throw(TypeError, '`method` must be a non-empty array');
    });

    it('throws TypeError when called with no arguments', () => {
      expect(() => formatAuditSummary()).to.throw(TypeError);
    });
  });

  describe('formatFinding', () => {
    it('renders a finding object as a summary', () => {
      const result = formatFinding({
        audience: 'site owners',
        dataSources: ['robots.txt'],
        steps: ['Validate robots.txt'],
        estimate: '5 minutes',
      });
      expect(result).to.include('## Serves');
      expect(result).to.include('site owners');
      expect(result).to.include('- robots.txt');
      expect(result).to.include('1. Validate robots.txt');
      expect(result).to.include('## Time');
      expect(result).to.include('5 minutes');
    });

    it('omits Time when estimate is undefined', () => {
      const result = formatFinding({
        audience: 'site owners',
        dataSources: ['robots.txt'],
        steps: ['Validate'],
      });
      expect(result).to.not.include('## Time');
    });

    it('throws TypeError when finding is null', () => {
      expect(() => formatFinding(null)).to.throw(TypeError, '`finding` must be an object');
    });

    it('throws TypeError when finding is a string', () => {
      expect(() => formatFinding('finding')).to.throw(TypeError, '`finding` must be an object');
    });

    it('throws TypeError when finding is a number', () => {
      expect(() => formatFinding(42)).to.throw(TypeError, '`finding` must be an object');
    });

    it('propagates validation errors from formatAuditSummary', () => {
      expect(() => formatFinding({
        audience: 'site owners',
        dataSources: ['robots.txt'],
      })).to.throw(TypeError, '`method` must be a non-empty array');
    });
  });
});
