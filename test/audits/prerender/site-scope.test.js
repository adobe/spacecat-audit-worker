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
  isUrlWithinSiteBaseUrl,
  filterUrlsBySiteBaseUrl,
} from '../../../src/prerender/utils/site-scope.js';

describe('prerender/utils/site-scope', () => {
  describe('isUrlWithinSiteBaseUrl', () => {
    it('returns false for missing url', () => {
      expect(isUrlWithinSiteBaseUrl(null, 'https://nba.com/kings')).to.be.false;
    });

    it('returns false for missing baseUrl', () => {
      expect(isUrlWithinSiteBaseUrl('https://nba.com/kings/roster', null)).to.be.false;
    });

    it('returns true for root-domain site (no path in baseUrl)', () => {
      expect(isUrlWithinSiteBaseUrl('https://nba.com/lakers/page', 'https://nba.com')).to.be.true;
    });

    it('returns true for URL belonging to the same site baseUrl', () => {
      expect(isUrlWithinSiteBaseUrl('https://nba.com/kings/roster', 'https://nba.com/kings')).to.be.true;
    });

    it('returns true for URL equal to the site baseUrl path exactly', () => {
      expect(isUrlWithinSiteBaseUrl('https://nba.com/kings', 'https://nba.com/kings')).to.be.true;
    });

    it('returns false for URL belonging to a different site on the same domain', () => {
      expect(isUrlWithinSiteBaseUrl('https://nba.com/lakers/roster', 'https://nba.com/kings')).to.be.false;
    });

    it('returns false for URL whose path is a prefix of baseUrl path but not within it', () => {
      // /kingsley is not part of the /kings site
      expect(isUrlWithinSiteBaseUrl('https://nba.com/kingsley/page', 'https://nba.com/kings')).to.be.false;
    });

    it('returns false when URL parsing fails', () => {
      expect(isUrlWithinSiteBaseUrl('not a url ::::', 'https://nba.com/kings')).to.be.false;
    });

    it('returns false when baseUrl parsing fails', () => {
      expect(isUrlWithinSiteBaseUrl('https://nba.com/kings/roster', 'not a url ::::')).to.be.false;
    });
  });

  describe('filterUrlsBySiteBaseUrl', () => {
    it('returns empty input unchanged', () => {
      expect(filterUrlsBySiteBaseUrl([], 'https://nba.com/kings')).to.deep.equal([]);
    });

    it('returns null input unchanged', () => {
      expect(filterUrlsBySiteBaseUrl(null, 'https://nba.com/kings')).to.be.null;
    });

    it('returns all URLs for root-domain site (no path in baseUrl)', () => {
      const urls = ['https://nba.com/kings/roster', 'https://nba.com/lakers/page'];
      expect(filterUrlsBySiteBaseUrl(urls, 'https://nba.com')).to.deep.equal(urls);
    });

    it('keeps only URLs belonging to the site baseUrl', () => {
      const urls = [
        'https://nba.com/kings/roster',
        'https://nba.com/lakers/page',
        'https://nba.com/kings/schedule',
        'https://nba.com/about',
      ];
      const result = filterUrlsBySiteBaseUrl(urls, 'https://nba.com/kings');
      expect(result).to.deep.equal([
        'https://nba.com/kings/roster',
        'https://nba.com/kings/schedule',
      ]);
    });

    it('returns all URLs unchanged when baseUrl parsing fails', () => {
      const urls = ['https://nba.com/kings/roster'];
      expect(filterUrlsBySiteBaseUrl(urls, 'not a url ::::')).to.deep.equal(urls);
    });
  });
});
