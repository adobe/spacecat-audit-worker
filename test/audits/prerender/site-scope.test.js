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
  isWithinSiteScope,
  filterBySiteScope,
} from '../../../src/prerender/utils/site-scope.js';

describe('site-scope utils', () => {
  describe('isWithinSiteScope', () => {
    describe('guard conditions', () => {
      it('returns false when url is null', () => {
        expect(isWithinSiteScope(null, 'bulk.com/uk')).to.be.false;
      });

      it('returns false when url is empty string', () => {
        expect(isWithinSiteScope('', 'bulk.com/uk')).to.be.false;
      });

      it('returns true when siteBaseUrl is null (no scope restriction)', () => {
        expect(isWithinSiteScope('https://bulk.com/uk/page', null)).to.be.true;
      });

      it('returns true when siteBaseUrl is empty string (no scope restriction)', () => {
        expect(isWithinSiteScope('https://bulk.com/uk/page', '')).to.be.true;
      });
    });

    describe('siteBaseUrl with no subpath (domain-only scope)', () => {
      it('returns true for any absolute URL when siteBaseUrl has no path', () => {
        expect(isWithinSiteScope('https://bulk.com/anything', 'bulk.com')).to.be.true;
      });

      it('returns true when siteBaseUrl path is explicitly root /', () => {
        expect(isWithinSiteScope('https://bulk.com/page', 'bulk.com/')).to.be.true;
      });
    });

    describe('siteBaseUrl with subpath — relative URLs', () => {
      it('returns true when relative url starts with basePath/', () => {
        expect(isWithinSiteScope('/uk/page', 'bulk.com/uk')).to.be.true;
      });

      it('returns true when relative url exactly equals basePath', () => {
        expect(isWithinSiteScope('/uk', 'bulk.com/uk')).to.be.true;
      });

      it('returns false when relative url does not start with basePath/', () => {
        expect(isWithinSiteScope('/fr/page', 'bulk.com/uk')).to.be.false;
      });

      it('prevents false-positive prefix match (/uk vs /ukraine)', () => {
        expect(isWithinSiteScope('/ukraine/page', 'bulk.com/uk')).to.be.false;
      });

      it('returns false for an unrelated relative path', () => {
        expect(isWithinSiteScope('/other', 'bulk.com/uk')).to.be.false;
      });
    });

    describe('siteBaseUrl with subpath — absolute URLs', () => {
      it('returns true when hostname and path both match', () => {
        expect(isWithinSiteScope('https://bulk.com/uk/page', 'bulk.com/uk')).to.be.true;
      });

      it('returns true when absolute url pathname exactly equals basePath', () => {
        expect(isWithinSiteScope('https://bulk.com/uk', 'bulk.com/uk')).to.be.true;
      });

      it('returns false when absolute url is outside the subpath', () => {
        expect(isWithinSiteScope('https://bulk.com/fr/page', 'bulk.com/uk')).to.be.false;
      });

      it('returns false when hostname differs', () => {
        expect(isWithinSiteScope('https://other.com/uk/page', 'bulk.com/uk')).to.be.false;
      });

      it('strips www for hostname comparison (url has www, base does not)', () => {
        expect(isWithinSiteScope('https://www.bulk.com/uk/page', 'bulk.com/uk')).to.be.true;
      });

      it('strips www for hostname comparison (base has www, url does not)', () => {
        expect(isWithinSiteScope('https://bulk.com/uk/page', 'www.bulk.com/uk')).to.be.true;
      });

      it('returns false when port differs', () => {
        expect(isWithinSiteScope('https://bulk.com:8080/uk/page', 'bulk.com/uk')).to.be.false;
      });

      it('prevents false-positive prefix match on absolute URL (/uk vs /ukraine)', () => {
        expect(isWithinSiteScope('https://bulk.com/ukraine/page', 'bulk.com/uk')).to.be.false;
      });
    });

    describe('error handling', () => {
      it('returns false when siteBaseUrl cannot be parsed', () => {
        expect(isWithinSiteScope('https://bulk.com/uk/page', 'not a valid url!!')).to.be.false;
      });
    });
  });

  describe('filterBySiteScope', () => {
    it('returns all URLs when siteBaseUrl has no subpath', () => {
      const urls = ['https://bulk.com/a', 'https://bulk.com/b'];
      expect(filterBySiteScope(urls, 'bulk.com')).to.deep.equal(urls);
    });

    it('filters out URLs outside the subpath', () => {
      const urls = [
        'https://bulk.com/uk/page1',
        'https://bulk.com/fr/page2',
        'https://bulk.com/uk/page3',
      ];
      expect(filterBySiteScope(urls, 'bulk.com/uk')).to.deep.equal([
        'https://bulk.com/uk/page1',
        'https://bulk.com/uk/page3',
      ]);
    });

    it('returns empty array when all URLs are out of scope', () => {
      const urls = ['https://bulk.com/fr/page1', 'https://bulk.com/de/page2'];
      expect(filterBySiteScope(urls, 'bulk.com/uk')).to.deep.equal([]);
    });

    it('returns empty array for empty input', () => {
      expect(filterBySiteScope([], 'bulk.com/uk')).to.deep.equal([]);
    });
  });
});
