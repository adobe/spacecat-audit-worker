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
  extractLocalePathPrefix,
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
});
