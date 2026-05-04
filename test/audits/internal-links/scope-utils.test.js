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

import { expect } from 'chai';
import {
  extractLocalePathPrefix,
  isCrossLocalePDP404RumPair,
  isSharedInternalResource,
} from '../../../src/internal-links/scope-utils.js';

describe('internal-links scope-utils', () => {
  describe('isSharedInternalResource', () => {
    it('returns false when url is empty or baseURL has no scoped subpath', () => {
      expect(isSharedInternalResource('', 'bulk.com/uk', 'js')).to.equal(false);
      expect(isSharedInternalResource('/etc.clientlibs/app.js', 'bulk.com', 'js')).to.equal(false);
    });

    it('allows same-host shared assets outside the scoped subpath for supported item types', () => {
      expect(isSharedInternalResource('https://bulk.com/etc.clientlibs/app.js', 'bulk.com/uk', 'js')).to.equal(true);
      expect(isSharedInternalResource('/content/dam/shared/hero.png', 'bulk.com/uk', 'image')).to.equal(true);
      expect(isSharedInternalResource('/bin/form/submit', 'bulk.com/uk', 'form')).to.equal(true);
    });

    it('does not allow navigational page links outside the scoped subpath', () => {
      expect(isSharedInternalResource('https://bulk.com/products', 'bulk.com/uk', 'link')).to.equal(false);
    });

    it('does not allow cross-host resources', () => {
      expect(isSharedInternalResource('https://cdn.bulk.com/etc.clientlibs/app.js', 'bulk.com/uk', 'js')).to.equal(false);
      expect(isSharedInternalResource('https://other.com/content/dam/shared/hero.png', 'bulk.com/uk', 'image')).to.equal(false);
    });

    it('returns false when base URL parsing fails', () => {
      expect(isSharedInternalResource('/etc.clientlibs/app.js', '://invalid', 'js')).to.equal(false);
    });

    it('returns false for malformed absolute urls', () => {
      expect(isSharedInternalResource('https://%zz', 'bulk.com/uk', 'js')).to.equal(false);
    });
  });

  describe('extractLocalePathPrefix', () => {
    it('returns empty string for nullish or non-locale prefixes', () => {
      expect(extractLocalePathPrefix(null)).to.equal('');
      expect(extractLocalePathPrefix('')).to.equal('');
      expect(extractLocalePathPrefix('bulk.com/products/item')).to.equal('');
      expect(extractLocalePathPrefix('not-a-url')).to.equal('');
    });

    it('extracts locale-like prefixes only', () => {
      expect(extractLocalePathPrefix('bulk.com/uk/page1')).to.equal('/uk');
      expect(extractLocalePathPrefix('bulk.com/en-us/page1')).to.equal('/en-us');
      expect(extractLocalePathPrefix('https://bulk.com/fr-CA/page')).to.equal('/fr-CA');
    });

    it('handles double-slash and malformed urls defensively', () => {
      expect(extractLocalePathPrefix('https://bulk.com//')).to.equal('');
      expect(extractLocalePathPrefix('://invalid')).to.equal('');
    });
  });

  describe('isCrossLocalePDP404RumPair', () => {
    it('returns false when either argument is missing', () => {
      expect(isCrossLocalePDP404RumPair('', 'https://example.com/de/a/b')).to.equal(false);
      expect(isCrossLocalePDP404RumPair('https://example.com/fr/a/b', '')).to.equal(false);
      expect(isCrossLocalePDP404RumPair(null, 'https://example.com/de/a/b')).to.equal(false);
    });

    it('returns false when either pathname is empty or root-only', () => {
      expect(isCrossLocalePDP404RumPair(
        'https://example.com',
        'https://example.com/de/item/x',
      )).to.equal(false);
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/fr/item/x',
        'https://example.com',
      )).to.equal(false);
    });

    it('returns false when segment counts differ or path is too shallow', () => {
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/fr/a/b',
        'https://example.com/de/a',
      )).to.equal(false);
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/fr',
        'https://example.com/de',
      )).to.equal(false);
    });

    it('returns false when either side has no locale-like prefix', () => {
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/blog/post',
        'https://example.com/fr/missing',
      )).to.equal(false);
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/fr/page',
        'https://example.com/products/missing',
      )).to.equal(false);
    });

    it('returns false when both sides share the same locale prefix', () => {
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/fr/page',
        'https://example.com/fr/missing',
      )).to.equal(false);
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/FR/page',
        'https://example.com/fr/missing',
      )).to.equal(false);
    });

    it('returns false when non-locale segments after the first differ', () => {
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/fr/a/b',
        'https://example.com/de/a/c',
      )).to.equal(false);
    });

    it('returns true when locales differ and all following path segments match', () => {
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/fr/product/slug',
        'https://example.com/de/product/slug',
      )).to.equal(true);
      expect(isCrossLocalePDP404RumPair(
        'https://example.com/en-us/a/b',
        'https://example.com/de-de/a/b',
      )).to.equal(true);
    });

    it('returns false when URL parsing throws', () => {
      expect(isCrossLocalePDP404RumPair('https://%zz', 'https://example.com/de/a/b')).to.equal(false);
      expect(isCrossLocalePDP404RumPair('https://example.com/fr/a/b', 'https://%zz')).to.equal(false);
    });
  });
});
