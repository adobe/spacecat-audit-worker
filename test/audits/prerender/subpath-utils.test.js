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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

use(sinonChai);
import { isUrlInScope, filterUrlsToScope } from '../../../src/prerender/utils/subpath-utils.js';

describe('prerender/utils/subpath-utils', () => {
  describe('isUrlInScope', () => {
    it('returns false for missing url', () => {
      expect(isUrlInScope(null, 'https://example.com/en')).to.be.false;
    });

    it('returns false for missing baseURL', () => {
      expect(isUrlInScope('https://example.com/en/page', null)).to.be.false;
    });

    it('returns true for root-domain baseURL (no subpath)', () => {
      expect(isUrlInScope('https://example.com/fr/page', 'https://example.com')).to.be.true;
    });

    it('returns true for URL matching the subpath', () => {
      expect(isUrlInScope('https://example.com/en/page', 'https://example.com/en')).to.be.true;
    });

    it('returns true for URL equal to the subpath exactly', () => {
      expect(isUrlInScope('https://example.com/en', 'https://example.com/en')).to.be.true;
    });

    it('returns false for URL on a different subpath', () => {
      expect(isUrlInScope('https://example.com/fr/page', 'https://example.com/en')).to.be.false;
    });

    it('returns false for URL that is a prefix of the subpath but not within it', () => {
      // /english is not within /en scope
      expect(isUrlInScope('https://example.com/english/page', 'https://example.com/en')).to.be.false;
    });

    it('returns false when URL parsing fails', () => {
      expect(isUrlInScope('not a url ::::', 'https://example.com/en')).to.be.false;
    });

    it('returns false when baseURL parsing fails', () => {
      expect(isUrlInScope('https://example.com/en/page', 'not a url ::::')).to.be.false;
    });
  });

  describe('filterUrlsToScope', () => {
    it('returns empty input unchanged', () => {
      expect(filterUrlsToScope([], 'https://example.com/en')).to.deep.equal([]);
    });

    it('returns null/undefined input unchanged', () => {
      expect(filterUrlsToScope(null, 'https://example.com/en')).to.be.null;
    });

    it('returns all URLs for root-domain baseURL (no subpath)', () => {
      const urls = ['https://example.com/en/a', 'https://example.com/fr/b'];
      expect(filterUrlsToScope(urls, 'https://example.com')).to.deep.equal(urls);
    });

    it('filters out URLs outside the subpath', () => {
      const urls = [
        'https://example.com/en/page-1',
        'https://example.com/fr/page-2',
        'https://example.com/en/page-3',
        'https://example.com/de/page-4',
      ];
      const result = filterUrlsToScope(urls, 'https://example.com/en');
      expect(result).to.deep.equal([
        'https://example.com/en/page-1',
        'https://example.com/en/page-3',
      ]);
    });

    it('calls log.debug with scoping summary when subpath is active', () => {
      const log = { debug: sinon.stub() };
      const urls = ['https://example.com/en/a', 'https://example.com/fr/b'];
      filterUrlsToScope(urls, 'https://example.com/en', log);
      expect(log.debug).to.have.been.calledOnce;
      expect(log.debug.firstCall.args[0]).to.include('/en');
    });

    it('returns all URLs unchanged when baseURL parsing fails', () => {
      const urls = ['https://example.com/en/a'];
      expect(filterUrlsToScope(urls, 'not a url ::::')).to.deep.equal(urls);
    });
  });
});
