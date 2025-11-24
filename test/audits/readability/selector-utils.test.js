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
import { JSDOM } from 'jsdom';
import { getElementSelector } from '../../../src/readability/shared/selector-utils.js';

describe('getElementSelector', () => {
  let document;

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
  });

  describe('invalid input handling', () => {
    it('should return empty string for null element', () => {
      const result = getElementSelector(null);
      expect(result).to.equal('');
    });

    it('should return empty string for undefined element', () => {
      const result = getElementSelector(undefined);
      expect(result).to.equal('');
    });

    it('should return empty string for element without tagName', () => {
      const result = getElementSelector({});
      expect(result).to.equal('');
    });

    it('should return empty string when error occurs', () => {
      const malformedElement = {
        get tagName() {
          throw new Error('Simulated error');
        },
      };
      const result = getElementSelector(malformedElement);
      expect(result).to.equal('');
    });
  });

  describe('ID-based selectors', () => {
    it('should return tag with ID for element with ID', () => {
      const div = document.createElement('div');
      div.id = 'main-content';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.equal('div#main-content');
    });

    it('should prioritize ID over classes', () => {
      const section = document.createElement('section');
      section.id = 'hero';
      section.className = 'large primary featured';
      document.body.appendChild(section);

      const result = getElementSelector(section);
      expect(result).to.equal('section#hero');
    });

    it('should return immediately for element with ID without building path', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'wrapper';
      document.body.appendChild(wrapper);

      const inner = document.createElement('p');
      inner.id = 'unique-para';
      inner.className = 'text';
      wrapper.appendChild(inner);

      const result = getElementSelector(inner);
      // Should return just tag#id, not include parent path
      expect(result).to.equal('p#unique-para');
    });
  });

  describe('class-based selectors', () => {
    it('should return tag with single class', () => {
      const div = document.createElement('div');
      div.className = 'container';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.include('div.container');
    });

    it('should return tag with first two classes', () => {
      const div = document.createElement('div');
      div.className = 'primary secondary tertiary';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.include('div.primary.secondary');
      expect(result).to.not.include('tertiary');
    });

    it('should handle multiple spaces between classes', () => {
      const div = document.createElement('div');
      div.className = '  class1   class2  class3  ';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.include('div.class1.class2');
    });

    it('should handle empty string className', () => {
      const div = document.createElement('div');
      div.className = '';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.include('div');
      expect(result).to.not.include('.');
    });

    it('should handle whitespace-only className', () => {
      const div = document.createElement('div');
      div.className = '   ';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.include('div');
      expect(result).to.not.include('.');
    });
  });

  describe('nth-of-type selectors', () => {
    it('should add nth-of-type when multiple siblings of same tag exist', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const p1 = document.createElement('p');
      const p2 = document.createElement('p');
      const p3 = document.createElement('p');
      container.appendChild(p1);
      container.appendChild(p2);
      container.appendChild(p3);

      const result = getElementSelector(p2);
      expect(result).to.include(':nth-of-type(2)');
    });

    it('should not add nth-of-type for single element of that tag', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const p = document.createElement('p');
      container.appendChild(p);

      const result = getElementSelector(p);
      expect(result).to.not.include(':nth-of-type');
    });

    it('should use nth-of-type with first element', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const p1 = document.createElement('p');
      const p2 = document.createElement('p');
      container.appendChild(p1);
      container.appendChild(p2);

      const result = getElementSelector(p1);
      expect(result).to.include(':nth-of-type(1)');
    });

    it('should use nth-of-type with last element', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const p1 = document.createElement('p');
      const p2 = document.createElement('p');
      const p3 = document.createElement('p');
      container.appendChild(p1);
      container.appendChild(p2);
      container.appendChild(p3);

      const result = getElementSelector(p3);
      expect(result).to.include(':nth-of-type(3)');
    });

    it('should only count siblings of same tag type', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const div1 = document.createElement('div');
      const p1 = document.createElement('p');
      const div2 = document.createElement('div');
      const p2 = document.createElement('p');
      container.appendChild(div1);
      container.appendChild(p1);
      container.appendChild(div2);
      container.appendChild(p2);

      const result = getElementSelector(p2);
      expect(result).to.include(':nth-of-type(2)');
    });
  });

  describe('hierarchical path selectors', () => {
    it('should build path with parent context', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'wrapper';
      document.body.appendChild(wrapper);

      const section = document.createElement('section');
      section.className = 'content';
      wrapper.appendChild(section);

      const p = document.createElement('p');
      p.className = 'text';
      section.appendChild(p);

      const result = getElementSelector(p);
      expect(result).to.equal('div.wrapper > section.content > p.text');
    });

    it('should limit path to 3 levels maximum', () => {
      const level1 = document.createElement('div');
      level1.className = 'level1';
      document.body.appendChild(level1);

      const level2 = document.createElement('div');
      level2.className = 'level2';
      level1.appendChild(level2);

      const level3 = document.createElement('div');
      level3.className = 'level3';
      level2.appendChild(level3);

      const level4 = document.createElement('div');
      level4.className = 'level4';
      level3.appendChild(level4);

      const target = document.createElement('p');
      target.className = 'target';
      level4.appendChild(target);

      const result = getElementSelector(target);
      // Should only go up 3 levels
      const parts = result.split(' > ');
      expect(parts.length).to.be.at.most(4); // target + 3 parent levels
      expect(result).to.include('p.target');
    });

    it('should stop path building when parent has ID', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'wrapper';
      document.body.appendChild(wrapper);

      const container = document.createElement('div');
      container.id = 'main-container';
      container.className = 'container';
      wrapper.appendChild(container);

      const section = document.createElement('section');
      section.className = 'content';
      container.appendChild(section);

      const p = document.createElement('p');
      section.appendChild(p);

      const result = getElementSelector(p);
      // Should stop at parent with ID
      expect(result).to.include('#main-container');
      expect(result).to.not.include('wrapper');
      expect(result).to.equal('#main-container > section.content > p');
    });

    it('should stop path building at body tag', () => {
      const p = document.createElement('p');
      document.body.appendChild(p);

      const result = getElementSelector(p);
      // Should not include body or html in path
      expect(result).to.not.include('body');
      expect(result).to.not.include('html');
      expect(result).to.equal('p');
    });

    it('should use direct child combinator (>)', () => {
      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const inner = document.createElement('p');
      wrapper.appendChild(inner);

      const result = getElementSelector(inner);
      expect(result).to.include(' > ');
    });

    it('should include parent classes in path', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'outer inner';
      document.body.appendChild(wrapper);

      const p = document.createElement('p');
      wrapper.appendChild(p);

      const result = getElementSelector(p);
      expect(result).to.include('div.outer.inner');
    });
  });

  describe('complex scenarios', () => {
    it('should handle elements with classes and nth-of-type', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const p1 = document.createElement('p');
      p1.className = 'text';
      const p2 = document.createElement('p');
      p2.className = 'text';
      const p3 = document.createElement('p');
      p3.className = 'text';
      container.appendChild(p1);
      container.appendChild(p2);
      container.appendChild(p3);

      const result = getElementSelector(p2);
      expect(result).to.include('p.text:nth-of-type(2)');
    });

    it('should handle deeply nested structure', () => {
      const article = document.createElement('article');
      article.className = 'post';
      document.body.appendChild(article);

      const main = document.createElement('main');
      main.className = 'content';
      article.appendChild(main);

      const section = document.createElement('section');
      section.className = 'body';
      main.appendChild(section);

      const div = document.createElement('div');
      div.className = 'text-block';
      section.appendChild(div);

      const p = document.createElement('p');
      div.appendChild(p);

      const result = getElementSelector(p);
      // Should respect 3-level limit
      expect(result).to.include('p');
      expect(result).to.include(' > ');
    });

    it('should handle element without parent', () => {
      const standalone = document.createElement('div');
      // Not appended to any parent

      const result = getElementSelector(standalone);
      expect(result).to.equal('div');
    });

    it('should handle element with special characters in class names', () => {
      const div = document.createElement('div');
      div.className = 'class-with-dash class_with_underscore';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.include('div.class-with-dash.class_with_underscore');
    });

    it('should generate unique selector for different elements', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const p1 = document.createElement('p');
      p1.className = 'first';
      const p2 = document.createElement('p');
      p2.className = 'second';
      container.appendChild(p1);
      container.appendChild(p2);

      const result1 = getElementSelector(p1);
      const result2 = getElementSelector(p2);

      expect(result1).to.not.equal(result2);
    });

    it('should handle mixed inline and block elements', () => {
      const div = document.createElement('div');
      div.className = 'container';
      document.body.appendChild(div);

      const span = document.createElement('span');
      span.className = 'label';
      div.appendChild(span);

      const result = getElementSelector(span);
      expect(result).to.include('span.label');
      expect(result).to.include('div.container');
    });

    it('should work with common HTML elements', () => {
      const elements = ['div', 'p', 'span', 'section', 'article', 'header', 'footer', 'nav', 'li'];

      elements.forEach((tagName) => {
        const element = document.createElement(tagName);
        document.body.appendChild(element);

        const result = getElementSelector(element);
        expect(result).to.include(tagName);
      });
    });

    it('should generate selector that can be used in querySelector', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'wrapper';
      document.body.appendChild(wrapper);

      const target = document.createElement('p');
      target.className = 'target';
      wrapper.appendChild(target);

      const selector = getElementSelector(target);

      // Verify the selector can be used to find the element
      const found = document.querySelector(selector);
      expect(found).to.equal(target);
    });
  });

  describe('edge cases', () => {
    it('should handle element with className as non-string', () => {
      const div = document.createElement('div');
      // Simulate non-string className (some DOM implementations)
      Object.defineProperty(div, 'className', {
        value: null,
        writable: true,
      });
      document.body.appendChild(div);

      const result = getElementSelector(div);
      expect(result).to.include('div');
    });

    it('should handle element with only whitespace in ID', () => {
      const div = document.createElement('div');
      div.id = '   ';
      document.body.appendChild(div);

      // Browser will trim ID, but testing edge case
      const result = getElementSelector(div);
      expect(result).to.be.a('string');
    });

    it('should handle element with numeric class names', () => {
      const div = document.createElement('div');
      div.className = '123 456';
      document.body.appendChild(div);

      const result = getElementSelector(div);
      // CSS class selectors with numbers are valid if they start with a digit
      expect(result).to.be.a('string');
    });

    it('should handle body element', () => {
      const result = getElementSelector(document.body);
      expect(result).to.equal('body');
    });

    it('should handle html element', () => {
      const html = document.documentElement;
      const result = getElementSelector(html);
      expect(result).to.equal('html');
    });
  });
});

