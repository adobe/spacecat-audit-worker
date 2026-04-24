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

  describe('sanitization', () => {
    it('should strip <script> tags', () => {
      const result = htmlToHast('<p>Safe</p><script>alert(1)</script>');
      const json = JSON.stringify(result);
      expect(json).not.to.include('"script"');
      expect(json).not.to.include('alert');
    });

    it('should strip event handler attributes (onerror, onclick)', () => {
      const result = htmlToHast('<p onerror="alert(1)">Text</p>');
      const json = JSON.stringify(result);
      expect(json).not.to.include('onerror');
      expect(json).not.to.include('alert');
    });

    it('should strip javascript: hrefs from <a> tags', () => {
      const result = htmlToHast('<a href="javascript:alert(1)">Click</a>');
      const json = JSON.stringify(result);
      expect(json).not.to.include('javascript:');
    });

    it('should preserve safe <a href> links', () => {
      const result = htmlToHast('<a href="https://example.com">Link</a>');
      const json = JSON.stringify(result);
      expect(json).to.include('"href"');
      expect(json).to.include('example.com');
    });

    it('should unwrap disallowed tags but keep their text content', () => {
      const result = htmlToHast('<div><p>Text inside div</p></div>');
      const json = JSON.stringify(result);
      expect(json).not.to.include('"tagName":"div"');
      expect(json).to.include('Text inside div');
    });

    it('should drop <a> with no href attribute', () => {
      const result = htmlToHast('<a>anchor without href</a>');
      const json = JSON.stringify(result);
      expect(json).to.include('anchor without href');
      expect(json).not.to.include('"href"');
    });

    it('should strip HTML comments', () => {
      const result = htmlToHast('<p>Visible</p><!-- hidden comment -->');
      const json = JSON.stringify(result);
      expect(json).not.to.include('hidden comment');
      expect(json).to.include('Visible');
    });
  });
});
