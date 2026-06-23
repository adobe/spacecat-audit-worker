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

import { expect } from 'chai';
import {
  isUrlWithinSite,
  filterUrlsBySite,
} from '../../../src/prerender/utils/site-scope.js';

const site = (baseUrl) => ({ getBaseURL: () => baseUrl });

describe('prerender/utils/site-scope', () => {
  describe('isUrlWithinSite', () => {
    it('returns false when url is null', () => {
      expect(isUrlWithinSite(null, site('https://nba.com/kings'))).to.be.false;
    });

    it('returns false when site is null', () => {
      expect(isUrlWithinSite('https://nba.com/kings/roster', null)).to.be.false;
    });

    it('returns false when site has no getBaseURL', () => {
      expect(isUrlWithinSite('https://nba.com/kings/roster', {})).to.be.false;
    });

    it('returns false when url is unparseable', () => {
      expect(isUrlWithinSite('not a url ::::', site('https://nba.com/kings'))).to.be.false;
    });

    it('returns false when site baseUrl is unparseable', () => {
      expect(isUrlWithinSite('https://nba.com/kings/roster', site('not a url ::::'))).to.be.false;
    });

    it('returns false for URL on a different hostname', () => {
      expect(isUrlWithinSite('https://wnba.com/kings/roster', site('https://nba.com/kings'))).to.be.false;
    });

    it('treats www and non-www as the same hostname', () => {
      expect(isUrlWithinSite('https://www.nba.com/kings/roster', site('https://nba.com/kings'))).to.be.true;
    });

    it('returns true for any URL on a root-domain site', () => {
      expect(isUrlWithinSite('https://nba.com/lakers/page', site('https://nba.com'))).to.be.true;
    });

    it('returns true for URL within the site baseUrl path', () => {
      expect(isUrlWithinSite('https://nba.com/kings/roster', site('https://nba.com/kings'))).to.be.true;
    });

    it('returns true for URL equal to the site baseUrl path exactly', () => {
      expect(isUrlWithinSite('https://nba.com/kings', site('https://nba.com/kings'))).to.be.true;
    });

    it('returns false for URL on a different site sharing the same domain', () => {
      expect(isUrlWithinSite('https://nba.com/lakers/roster', site('https://nba.com/kings'))).to.be.false;
    });

    it('returns false for URL whose path is a string prefix but not a path child', () => {
      // /kingsley starts with /kings but is a different site
      expect(isUrlWithinSite('https://nba.com/kingsley/page', site('https://nba.com/kings'))).to.be.false;
    });
  });

  describe('filterUrlsBySite', () => {
    it('returns null input unchanged', () => {
      expect(filterUrlsBySite(null, site('https://nba.com/kings'))).to.be.null;
    });

    it('returns empty array unchanged', () => {
      expect(filterUrlsBySite([], site('https://nba.com/kings'))).to.deep.equal([]);
    });

    it('returns all URLs for a root-domain site', () => {
      const urls = ['https://nba.com/kings/roster', 'https://nba.com/lakers/page'];
      expect(filterUrlsBySite(urls, site('https://nba.com'))).to.deep.equal(urls);
    });

    it('keeps only URLs belonging to the site', () => {
      const urls = [
        'https://nba.com/kings/roster',
        'https://nba.com/lakers/page',
        'https://nba.com/kings/schedule',
        'https://nba.com/about',
      ];
      expect(filterUrlsBySite(urls, site('https://nba.com/kings'))).to.deep.equal([
        'https://nba.com/kings/roster',
        'https://nba.com/kings/schedule',
      ]);
    });

    it('excludes URLs on a different hostname entirely', () => {
      const urls = ['https://wnba.com/kings/roster', 'https://nba.com/kings/schedule'];
      expect(filterUrlsBySite(urls, site('https://nba.com/kings'))).to.deep.equal([
        'https://nba.com/kings/schedule',
      ]);
    });
  });
});
