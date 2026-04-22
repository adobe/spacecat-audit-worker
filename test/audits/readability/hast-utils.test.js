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

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { htmlToHast } from '../../../src/readability/shared/hast-utils.js';

use(sinonChai);
use(chaiAsPromised);

describe('hast-utils', () => {
  describe('htmlToHast', () => {
    it('should return a HAST root node for a simple paragraph', () => {
      const result = htmlToHast('<p>Hello world</p>');
      expect(result).to.be.an('object');
      expect(result.type).to.equal('root');
      expect(result.children).to.be.an('array').with.length.greaterThan(0);
    });

    it('should preserve <strong> semantic tag', () => {
      const result = htmlToHast('Hello <strong>world</strong>');
      const html = JSON.stringify(result);
      expect(html).to.include('"tagName":"strong"');
    });

    it('should preserve <em> semantic tag', () => {
      const result = htmlToHast('Hello <em>italic</em> text');
      const html = JSON.stringify(result);
      expect(html).to.include('"tagName":"em"');
    });

    it('should preserve <a> tag with href', () => {
      const result = htmlToHast('See <a href="https://example.com">this link</a> for details');
      const html = JSON.stringify(result);
      expect(html).to.include('"tagName":"a"');
      expect(html).to.include('example.com');
    });

    it('should handle plain text with no HTML tags', () => {
      const result = htmlToHast('Just plain text without any markup');
      expect(result.type).to.equal('root');
      expect(result.children).to.be.an('array').with.length.greaterThan(0);
    });

    it('should handle nested semantic tags', () => {
      const result = htmlToHast('<p>Text with <strong>bold and <em>italic</em></strong> content</p>');
      const html = JSON.stringify(result);
      expect(html).to.include('"tagName":"strong"');
      expect(html).to.include('"tagName":"em"');
    });

    it('should produce a tree compatible with Tokowaka valueFormat:hast (root + children)', () => {
      const result = htmlToHast('<p>Improved <strong>text</strong>.</p>');
      expect(result).to.have.property('type', 'root');
      expect(result).to.have.property('children').that.is.an('array');
      // Each child should be an element or text node
      result.children.forEach((child) => {
        expect(child).to.have.property('type');
      });
    });
  });
});
