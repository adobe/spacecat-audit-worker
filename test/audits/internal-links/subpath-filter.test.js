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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  isWithinAuditScope,
  filterByAuditScope,
  extractPathPrefix,
} from '../../../src/internal-links/subpath-filter.js';

use(sinonChai);

describe('subpath-filter', () => {
  describe('isWithinAuditScope', () => {
    it('should return false for null or undefined inputs', () => {
      expect(isWithinAuditScope(null, 'bulk.com')).to.equal(false);
      expect(isWithinAuditScope('bulk.com/uk/page', null)).to.equal(false);
      expect(isWithinAuditScope(undefined, 'bulk.com')).to.equal(false);
      expect(isWithinAuditScope('bulk.com/uk/page', undefined)).to.equal(false);
    });

    it('should include all URLs when baseURL has no subpath', () => {
      expect(isWithinAuditScope('bulk.com/uk/page', 'bulk.com')).to.equal(true);
      expect(isWithinAuditScope('bulk.com/fr/page', 'bulk.com')).to.equal(true);
      expect(isWithinAuditScope('bulk.com/products', 'bulk.com')).to.equal(true);
      expect(isWithinAuditScope('https://bulk.com/uk/page', 'bulk.com')).to.equal(true);
    });

    it('should filter URLs by subpath when baseURL has subpath', () => {
      // URLs within scope (absolute URLs)
      expect(isWithinAuditScope('https://bulk.com/uk/page1', 'bulk.com/uk')).to.equal(true);
      expect(isWithinAuditScope('https://bulk.com/uk/page2', 'bulk.com/uk')).to.equal(true);
      
      // URLs within scope (relative URLs)
      expect(isWithinAuditScope('/uk/page1', 'bulk.com/uk')).to.equal(true);
      expect(isWithinAuditScope('/uk/', 'bulk.com/uk')).to.equal(true);
      expect(isWithinAuditScope('/uk', 'bulk.com/uk')).to.equal(true);

      // URLs outside scope (absolute URLs)
      expect(isWithinAuditScope('https://bulk.com/fr/page1', 'bulk.com/uk')).to.equal(false);
      expect(isWithinAuditScope('https://bulk.com/products', 'bulk.com/uk')).to.equal(false);
      
      // URLs outside scope (relative URLs)
      expect(isWithinAuditScope('/fr/page1', 'bulk.com/uk')).to.equal(false);
      expect(isWithinAuditScope('/products', 'bulk.com/uk')).to.equal(false);
    });

    it('should avoid false positives with trailing slash matching', () => {
      // /fr/ should not match /french/
      expect(isWithinAuditScope('https://bulk.com/french/page', 'bulk.com/fr')).to.equal(false);
      expect(isWithinAuditScope('https://bulk.com/fr/page', 'bulk.com/fr')).to.equal(true);
      expect(isWithinAuditScope('/french/page', 'bulk.com/fr')).to.equal(false);
      expect(isWithinAuditScope('/fr/page', 'bulk.com/fr')).to.equal(true);
    });

    it('should handle relative URLs', () => {
      expect(isWithinAuditScope('/uk/page1', 'bulk.com/uk')).to.equal(true);
      expect(isWithinAuditScope('/fr/page1', 'bulk.com/uk')).to.equal(false);
      expect(isWithinAuditScope('/uk', 'bulk.com/uk')).to.equal(true);
    });

    it('should handle absolute URLs', () => {
      // Note: prependSchema normalizes baseURL to https://, so http:// URLs may not match
      // This is expected behavior - URLs should use consistent protocols
      expect(isWithinAuditScope('https://bulk.com/uk/page1', 'bulk.com/uk')).to.equal(true);
      expect(isWithinAuditScope('https://bulk.com/uk/page2', 'bulk.com/uk')).to.equal(true);
      expect(isWithinAuditScope('https://bulk.com/fr/page1', 'bulk.com/uk')).to.equal(false);
    });

    it('should return false for invalid URLs', () => {
      // Invalid URLs cause parsing errors, which return false
      expect(isWithinAuditScope('not-a-url', 'bulk.com/uk')).to.equal(false);
      // Invalid baseURL also causes parsing errors
      expect(isWithinAuditScope('https://bulk.com/uk/page', '://invalid')).to.equal(false);
    });

    it('should return false when URLs have different ports', () => {
      // Test port mismatch - hostnames match but ports differ
      // This covers the port comparison branch in the condition
      expect(isWithinAuditScope('https://bulk.com:8080/uk/page', 'bulk.com/uk')).to.equal(false);
      expect(isWithinAuditScope('https://bulk.com/uk/page', 'bulk.com:8080/uk')).to.equal(false);
      // Same port should work
      expect(isWithinAuditScope('https://bulk.com:8080/uk/page', 'bulk.com:8080/uk')).to.equal(true);
    });
  });

  describe('filterByAuditScope', () => {
    let log;

    beforeEach(() => {
      log = {
        debug: sinon.stub(),
        warn: sinon.stub(),
      };
    });

    it('should return empty array for empty input', () => {
      expect(filterByAuditScope([], 'bulk.com/uk', {}, log)).to.deep.equal([]);
      expect(filterByAuditScope(null, 'bulk.com/uk', {}, log)).to.deep.equal(null);
      expect(filterByAuditScope(undefined, 'bulk.com/uk', {}, log)).to.deep.equal(undefined);
    });

    it('should return all items when baseURL has no subpath', () => {
      const items = ['bulk.com/uk/page1', 'bulk.com/fr/page1', 'bulk.com/products'];
      const result = filterByAuditScope(items, 'bulk.com', {}, log);
      expect(result).to.deep.equal(items);
      expect(log.debug).to.have.been.calledWith(
        '[subpath-filter] No subpath in baseURL bulk.com, returning all 3 items',
      );
    });

    it('should filter string arrays by subpath', () => {
      const items = [
        'https://bulk.com/uk/page1',
        'https://bulk.com/uk/page2',
        'https://bulk.com/fr/page1',
        'https://bulk.com/products',
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', {}, log);
      expect(result).to.deep.equal(['https://bulk.com/uk/page1', 'https://bulk.com/uk/page2']);
      expect(log.debug).to.have.been.calledWith(
        '[subpath-filter] Filtered 4 items to 2 based on audit scope: /uk',
      );
    });

    it('should filter objects with url property', () => {
      const items = [
        { url: 'https://bulk.com/uk/page1' },
        { url: 'https://bulk.com/uk/page2' },
        { url: 'https://bulk.com/fr/page1' },
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', {}, log);
      expect(result).to.deep.equal([
        { url: 'https://bulk.com/uk/page1' },
        { url: 'https://bulk.com/uk/page2' },
      ]);
    });

    it('should filter objects with custom urlProperty', () => {
      const items = [
        { customUrl: 'https://bulk.com/uk/page1' },
        { customUrl: 'https://bulk.com/fr/page1' },
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', { urlProperty: 'customUrl' }, log);
      expect(result).to.deep.equal([{ customUrl: 'https://bulk.com/uk/page1' }]);
    });

    it('should filter objects with getUrl method', () => {
      const items = [
        { getUrl: () => 'https://bulk.com/uk/page1' },
        { getUrl: () => 'https://bulk.com/fr/page1' },
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', { urlProperty: 'getUrl' }, log);
      expect(result).to.deep.equal([{ getUrl: items[0].getUrl }]);
    });

    it('should handle objects with urlFrom or urlTo properties', () => {
      const items = [
        { urlFrom: 'https://bulk.com/uk/page1' },
        { urlTo: 'https://bulk.com/uk/page2' },
        { urlFrom: 'https://bulk.com/fr/page1' },
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', {}, log);
      expect(result.length).to.equal(2);
    });

    it('should return all items on error', () => {
      const items = ['https://bulk.com/uk/page1', 'https://bulk.com/uk/page2'];
      // Use a baseURL that will cause URL parsing to fail
      const result = filterByAuditScope(items, '://invalid-url', {}, log);
      expect(result).to.deep.equal(items);
      // Note: Error might be caught and handled gracefully, so warn may or may not be called
    });

    it('should exclude items without valid URL property', () => {
      const items = [
        { url: 'https://bulk.com/uk/page1' },
        { noUrl: 'https://bulk.com/uk/page2' },
        { url: 'https://bulk.com/fr/page1' },
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', {}, log);
      expect(result).to.deep.equal([{ url: 'https://bulk.com/uk/page1' }]);
    });

    it('should exclude items that are not strings or objects', () => {
      const items = [
        'https://bulk.com/uk/page1',
        123, // number - should be excluded (line 111)
        null, // null - should be excluded (line 111)
        undefined, // undefined - should be excluded (line 111)
        { url: 'https://bulk.com/uk/page2' },
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', {}, log);
      expect(result).to.deep.equal([
        'https://bulk.com/uk/page1',
        { url: 'https://bulk.com/uk/page2' },
      ]);
    });

    it('should handle objects with getUrl method fallback', () => {
      // Test the fallback chain: item[urlProperty] || item.url || item.urlFrom || item.urlTo || item.getUrl?.()
      const items = [
        { getUrl: () => 'https://bulk.com/uk/page1' }, // via getUrl method
        { url: 'https://bulk.com/uk/page2' }, // via url property
        { urlFrom: 'https://bulk.com/uk/page3' }, // via urlFrom fallback
        { urlTo: 'https://bulk.com/uk/page4' }, // via urlTo fallback
        { customProp: 'https://bulk.com/fr/page1' }, // no URL property
      ];
      const result = filterByAuditScope(items, 'bulk.com/uk', {}, log);
      expect(result.length).to.equal(4); // First 4 should match
    });
  });

  describe('extractPathPrefix', () => {
    it('should return empty string for null or undefined', () => {
      expect(extractPathPrefix(null)).to.equal('');
      expect(extractPathPrefix(undefined)).to.equal('');
      expect(extractPathPrefix('')).to.equal('');
    });

    it('should return empty string for URLs with no path', () => {
      expect(extractPathPrefix('bulk.com')).to.equal('');
      expect(extractPathPrefix('https://bulk.com')).to.equal('');
      expect(extractPathPrefix('https://bulk.com/')).to.equal('');
    });

    it('should extract first path segment', () => {
      expect(extractPathPrefix('bulk.com/uk/page1')).to.equal('/uk');
      expect(extractPathPrefix('bulk.com/fr/page1')).to.equal('/fr');
      expect(extractPathPrefix('https://bulk.com/uk/page1')).to.equal('/uk');
      expect(extractPathPrefix('bulk.com/products/item')).to.equal('/products');
    });

    it('should handle URLs with query parameters', () => {
      expect(extractPathPrefix('bulk.com/uk/page?param=value')).to.equal('/uk');
      expect(extractPathPrefix('https://bulk.com/fr/page#anchor')).to.equal('/fr');
    });

    it('should handle URLs with multiple path segments', () => {
      expect(extractPathPrefix('bulk.com/uk/products/item')).to.equal('/uk');
      expect(extractPathPrefix('bulk.com/fr/about/team')).to.equal('/fr');
    });

    it('should return empty string for invalid URLs', () => {
      expect(extractPathPrefix('not-a-url')).to.equal('');
      expect(extractPathPrefix('://invalid')).to.equal('');
    });

    it('should handle edge cases', () => {
      // Relative paths need a base URL to parse correctly
      // prependSchema('/uk') becomes 'https:///uk' which is invalid
      // So relative paths without domain return empty string
      expect(extractPathPrefix('/uk')).to.equal(''); // Relative path without domain
      expect(extractPathPrefix('/uk/')).to.equal(''); // Relative path without domain
      expect(extractPathPrefix('https://bulk.com/uk')).to.equal('/uk');
      expect(extractPathPrefix('bulk.com/uk')).to.equal('/uk');
    });

    it('should return empty string when segments array is empty', () => {
      // Test the branch where segments.length === 0 (ternary false branch)
      // This happens when pathname exists but results in empty segments after filtering
      // For example, a pathname like "//" which is not equal to '/' but results in empty segments
      // After prependSchema and URL parsing, "bulk.com//" becomes "https://bulk.com//"
      // and pathname is "//", which is not equal to '/', so we pass the pathname check
      // After splitting and filtering, segments is empty, hitting the false branch
      expect(extractPathPrefix('bulk.com//')).to.equal('');
    });

    it('should return prefix when segments array is not empty', () => {
      // Test the branch where segments.length > 0 (ternary true branch)
      expect(extractPathPrefix('https://bulk.com/uk')).to.equal('/uk');
      expect(extractPathPrefix('https://bulk.com/uk/page')).to.equal('/uk');
      expect(extractPathPrefix('bulk.com/fr/products')).to.equal('/fr');
    });
  });
});

