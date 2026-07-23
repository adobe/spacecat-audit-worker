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
  classifyUrlPath, buildClassificationRows, serializeClassificationCsv, canonicalizeUrlPath,
} from '../../../src/llmo-referral-traffic-daily/classify.js';

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

    it('treats a catastrophic-backtracking regex as a no-match (ReDoS guard) and keeps scanning', () => {
      const withRedos = [
        { name: 'redos', regex: '(a+)+', sort_order: 0 },
        { name: 'valid', regex: '/aaa', sort_order: 1 },
      ];
      // (a+)+ would match '/aaa' if compiled; the guard skips it and the next rule wins.
      expect(classifyUrlPath(withRedos, '/aaa')).to.equal('valid');
    });

    it('returns null when the only matching rule has an unsafe (ReDoS) regex', () => {
      expect(classifyUrlPath([{ name: 'redos', regex: '(.*)+' }], '/anything')).to.equal(null);
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

  describe('canonicalizeUrlPath', () => {
    it('returns root for a non-string input', () => {
      expect(canonicalizeUrlPath(null)).to.equal('/');
      expect(canonicalizeUrlPath(undefined)).to.equal('/');
    });

    it('returns root for an empty string', () => {
      expect(canonicalizeUrlPath('')).to.equal('/');
    });

    it('leaves the root path unchanged', () => {
      expect(canonicalizeUrlPath('/')).to.equal('/');
    });

    it('strips the query string', () => {
      expect(canonicalizeUrlPath('/shoes?utm=abc&x=1')).to.equal('/shoes');
    });

    it('strips the fragment', () => {
      expect(canonicalizeUrlPath('/shoes#reviews')).to.equal('/shoes');
    });

    it('removes a trailing slash except on the root', () => {
      expect(canonicalizeUrlPath('/shoes/')).to.equal('/shoes');
    });

    it('adds a leading slash when missing', () => {
      expect(canonicalizeUrlPath('shoes/sneakers')).to.equal('/shoes/sneakers');
    });

    it('collapses duplicate slashes', () => {
      expect(canonicalizeUrlPath('//shoes///sneakers//')).to.equal('/shoes/sneakers');
    });

    it('host-strips a full URL down to its pathname', () => {
      expect(canonicalizeUrlPath('https://example.com/shoes/sneakers?x=1#top')).to.equal('/shoes/sneakers');
    });

    it('falls back to the raw string when a scheme-like value will not parse as a URL', () => {
      // Exercises the URL-parse catch branch; output is deterministic, not meaningful.
      expect(canonicalizeUrlPath('http://')).to.be.a('string').that.matches(/^\//);
    });
  });

  describe('serializeClassificationCsv', () => {
    it('serializes rows to a header-first CSV with the classification columns', () => {
      const csv = serializeClassificationCsv([
        {
          host: 'example.com', url_path: '/shoes', category_name: 'footwear', updated_by: 'spacecat:optel',
        },
      ]);
      expect(csv).to.equal(
        'host,url_path,category_name,updated_by\r\nexample.com,/shoes,footwear,spacecat:optel',
      );
    });

    it('escapes values with commas/quotes and renders null/undefined as empty', () => {
      const csv = serializeClassificationCsv([
        {
          host: 'example.com', url_path: '/a,b', category_name: 'has "quote"', updated_by: null,
        },
      ]);
      const [, row] = csv.split('\r\n');
      expect(row).to.equal('example.com,"/a,b","has ""quote""",');
    });
  });
});
