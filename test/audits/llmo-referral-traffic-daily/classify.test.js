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
import { classifyUrlPath, buildClassificationRows } from '../../../src/llmo-referral-traffic-daily/classify.js';

describe('referral URL classification', () => {
  describe('classifyUrlPath', () => {
    const rules = [
      { name: 'sneakers', regex: '/shoes/sneakers', sort_order: 0 },
      { name: 'footwear', regex: '/shoes', sort_order: 1 },
      { name: 'apparel', regex: '/shirts', sort_order: 2 },
    ];

    it('returns null when rules is not an array', () => {
      expect(classifyUrlPath(null, '/shoes')).to.equal(null);
    });

    it('returns null when the url path is not a string', () => {
      expect(classifyUrlPath(rules, undefined)).to.equal(null);
    });

    it('returns the first matching rule (precedence follows rule order)', () => {
      // Both /shoes/sneakers and /shoes match; the earlier (lower sort_order) wins.
      expect(classifyUrlPath(rules, '/shoes/sneakers')).to.equal('sneakers');
      expect(classifyUrlPath(rules, '/shoes/boots')).to.equal('footwear');
      expect(classifyUrlPath(rules, '/shirts/tee')).to.equal('apparel');
    });

    it('returns null when nothing matches', () => {
      expect(classifyUrlPath(rules, '/electronics')).to.equal(null);
    });

    it('treats an uncompilable regex as a no-match and keeps scanning', () => {
      const withBad = [
        { name: 'bad', regex: '(unclosed', sort_order: 0 },
        { name: 'footwear', regex: '/shoes', sort_order: 1 },
      ];
      expect(classifyUrlPath(withBad, '/shoes')).to.equal('footwear');
    });

    it('skips malformed rules (missing regex or name)', () => {
      const malformed = [
        { name: 'noRegex', sort_order: 0 },
        { regex: '/shoes', sort_order: 1 },
        null,
        { name: 'footwear', regex: '/shoes', sort_order: 2 },
      ];
      expect(classifyUrlPath(malformed, '/shoes')).to.equal('footwear');
    });

    it('honors the (?i) inline modifier (case-insensitive match)', () => {
      expect(classifyUrlPath([{ name: 'footwear', regex: '(?i)/SHOES' }], '/shoes')).to.equal('footwear');
    });
  });

  describe('buildClassificationRows', () => {
    const rules = [{ name: 'footwear', regex: '/shoes' }];

    it('builds one row per distinct (host, url_path) that matches a rule', () => {
      const rows = [
        { host: 'example.com', url_path: '/shoes' },
        { host: 'example.com', url_path: '/electronics' },
      ];
      expect(buildClassificationRows(rows, rules, 'spacecat:optel')).to.deep.equal([
        {
          host: 'example.com', url_path: '/shoes', category_name: 'footwear', updated_by: 'spacecat:optel',
        },
      ]);
    });

    it('dedupes repeated (host, url_path) pairs', () => {
      const rows = [
        { host: 'example.com', url_path: '/shoes' },
        { host: 'example.com', url_path: '/shoes' },
      ];
      expect(buildClassificationRows(rows, rules, 'spacecat:optel')).to.have.lengthOf(1);
    });

    it('returns an empty array when nothing matches', () => {
      const rows = [{ host: 'example.com', url_path: '/electronics' }];
      expect(buildClassificationRows(rows, rules, 'spacecat:optel')).to.deep.equal([]);
    });
  });
});
