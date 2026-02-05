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
import { normalizeUrl } from '../../../src/internal-links/url-utils.js';

describe('URL Utils', () => {
  describe('normalizeUrl', () => {
    it('should remove trailing slashes from non-root paths', () => {
      expect(normalizeUrl('https://example.com/path/')).to.equal('https://example.com/path');
    });

    it('should preserve trailing slash for root path', () => {
      expect(normalizeUrl('https://example.com/')).to.equal('https://example.com/');
    });

    it('should handle URL-encoded spaces (%20) in path', () => {
      expect(normalizeUrl('https://example.com/path%20with%20spaces'))
        .to.equal('https://example.com/path-with-spaces');
    });

    it('should replace regular spaces with hyphens', () => {
      expect(normalizeUrl('https://example.com/path with spaces'))
        .to.equal('https://example.com/path-with-spaces');
    });

    it('should remove duplicate hyphens', () => {
      expect(normalizeUrl('https://example.com/path---with---hyphens'))
        .to.equal('https://example.com/path-with-hyphens');
    });

    it('should remove www prefix', () => {
      expect(normalizeUrl('https://www.example.com/path'))
        .to.equal('https://example.com/path');
    });

    it('should sort query parameters', () => {
      expect(normalizeUrl('https://example.com/path?z=3&a=1&m=2'))
        .to.equal('https://example.com/path?a=1&m=2&z=3');
    });

    it('should remove hash fragments', () => {
      expect(normalizeUrl('https://example.com/path#section'))
        .to.equal('https://example.com/path');
    });

    it('should handle complex URL with multiple normalization issues', () => {
      expect(normalizeUrl('https://www.example.com/path%20name/?z=1&a=2#section'))
        .to.equal('https://example.com/path-name?a=2&z=1');
    });

    it('should return original URL if parsing fails', () => {
      const invalidUrl = 'not a url';
      expect(normalizeUrl(invalidUrl)).to.equal(invalidUrl);
    });
  });
});
