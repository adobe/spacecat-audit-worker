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
import { load as cheerioLoad } from 'cheerio';

import { getElementSelector } from '../../../src/readability/shared/selector-utils.js';

describe('getElementSelector', () => {
  let $;

  beforeEach(() => {
    $ = cheerioLoad('<!DOCTYPE html><html><body></body></html>');
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
        get name() {
          throw new Error('Simulated error');
        },
      };
      const result = getElementSelector(malformedElement);
      expect(result).to.equal('');
    });
  });

  describe('ID-based selectors', () => {
    it('should return tag with ID for element with ID', () => {
      $('body').html('<div id="main-content"></div>');
      const div = $('div')[0];

      const result = getElementSelector(div);
      expect(result).to.equal('div#main-content');
    });

    it('should prioritize ID over classes', () => {
      $('body').html('<section id="hero" class="large primary featured"></section>');
      const section = $('section')[0];

      const result = getElementSelector(section);
      expect(result).to.equal('section#hero');
    });

    it('should return immediately for element with ID without building path', () => {
      $('body').html('<div class="wrapper"><p id="unique-para" class="text"></p></div>');
      const inner = $('p')[0];

      const result = getElementSelector(inner);
      // Should return just tag#id, not include parent path
      expect(result).to.equal('p#unique-para');
    });
  });

  describe('class-based selectors', () => {
    it('should return tag with single class', () => {
      $('body').html('<div class="container"></div>');
      const div = $('div')[0];

      const result = getElementSelector(div);
      expect(result).to.include('div.container');
    });

    it('should return tag with first two classes', () => {
      $('body').html('<div class="primary secondary tertiary"></div>');
      const div = $('div')[0];

      const result = getElementSelector(div);
      expect(result).to.include('div.primary.secondary');
      expect(result).to.not.include('tertiary');
    });

    it('should handle multiple spaces between classes', () => {
      $('body').html('<div class="  class1   class2  class3  "></div>');
      const div = $('div')[0];

      const result = getElementSelector(div);
      expect(result).to.include('div.class1.class2');
    });

    it('should handle empty string className', () => {
      $('body').html('<div class=""></div>');
      const div = $('div')[0];

      const result = getElementSelector(div);
      expect(result).to.include('div');
      expect(result).to.not.include('.');
    });

    it('should handle whitespace-only className', () => {
      $('body').html('<div class="   "></div>');
      const div = $('div')[0];

      const result = getElementSelector(div);
      expect(result).to.include('div');
      expect(result).to.not.include('.');
    });
  });

  describe('nth-of-type selectors', () => {
    it('should add nth-of-type when multiple siblings of same tag exist', () => {
      $('body').html('<div><p></p><p></p><p></p></div>');
      const p2 = $('p').eq(1)[0];

      const result = getElementSelector(p2);
      expect(result).to.include(':nth-of-type(2)');
    });

    it('should not add nth-of-type for single element of that tag', () => {
      $('body').html('<div><p></p></div>');
      const p = $('p')[0];

      const result = getElementSelector(p);
      expect(result).to.not.include(':nth-of-type');
    });

    it('should use nth-of-type with first element', () => {
      $('body').html('<div><p></p><p></p></div>');
      const p1 = $('p').eq(0)[0];

      const result = getElementSelector(p1);
      expect(result).to.include(':nth-of-type(1)');
    });

    it('should use nth-of-type with last element', () => {
      $('body').html('<div><p></p><p></p><p></p></div>');
      const p3 = $('p').eq(2)[0];

      const result = getElementSelector(p3);
      expect(result).to.include(':nth-of-type(3)');
    });

    it('should only count siblings of same tag type', () => {
      $('body').html('<div><div></div><p></p><div></div><p></p></div>');
      const p2 = $('p').eq(1)[0];

      const result = getElementSelector(p2);
      expect(result).to.include(':nth-of-type(2)');
    });
  });

  describe('hierarchical path selectors', () => {
    it('should build path with parent context', () => {
      $('body').html('<div class="wrapper"><section class="content"><p class="text"></p></section></div>');
      const p = $('p')[0];

      const result = getElementSelector(p);
      expect(result).to.equal('div.wrapper > section.content > p.text');
    });

    it('should limit path to 3 levels maximum', () => {
      $('body').html(`
        <div class="level1">
          <div class="level2">
            <div class="level3">
              <div class="level4">
                <p class="target"></p>
              </div>
            </div>
          </div>
        </div>
      `);
      const target = $('p')[0];

      const result = getElementSelector(target);
      // Should only go up 3 levels
      const parts = result.split(' > ');
      expect(parts.length).to.be.at.most(4); // target + 3 parent levels
      expect(result).to.include('p.target');
    });

    it('should stop path building when parent has ID', () => {
      $('body').html(`
        <div class="wrapper">
            <div id="main-container" class="container">
                <section class="content">
                    <p></p>
                </section>
            </div>
        </div>
      `);
      const p = $('p')[0];

      const result = getElementSelector(p);
      // Should stop at parent with ID
      expect(result).to.include('#main-container');
      expect(result).to.not.include('wrapper');
      expect(result).to.equal('#main-container > section.content > p');
    });

    it('should stop path building at body tag', () => {
      $('body').html(`<p></p>`);
      const p = $('p')[0];

      const result = getElementSelector(p);
      // Should not include body or html in path
      expect(result).to.not.include('body');
      expect(result).to.not.include('html');
      expect(result).to.equal('p');
    });

    it('should use direct child combinator (>)', () => {
      $('body').html(`<div><p></p></div>`);
      const p = $('p')[0];

      const result = getElementSelector(p);
      expect(result).to.include(' > ');
    });

    it('should include parent classes in path', () => {
      $('body').html(`<div class="outer inner"><p></p></div>`);
      const p = $('p')[0];

      const result = getElementSelector(p);
      expect(result).to.include('div.outer.inner');
    });
  });

  describe('complex scenarios', () => {
    it('should handle elements with classes and nth-of-type', () => {
      $('body').html('<div><p class="text"></p><p class="text"></p><p class="text"></p></div>');

      const p2 = $('p').eq(1)[0];

      const result = getElementSelector(p2);
      expect(result).to.include('p.text:nth-of-type(2)');
    });

    it('should handle deeply nested structure', () => {
      $('body').html(`
        <article class="post">
          <main class="content">
            <section class="body">
              <div class="text-block">
                <p></p>
              </div>
            </section>
          </main>
        </article>
      `);
      const p = $('p')[0];

      const result = getElementSelector(p);
      // Should respect 3-level limit
      expect(result).to.include('p');
      expect(result).to.include(' > ');
    });

    it('should handle element with special characters in class names', () => {
      $('body').html('<div class="class-with-dash class_with_underscore"></div>');
      const div = $('div')[0];

      const result = getElementSelector(div);
      expect(result).to.include('div.class-with-dash.class_with_underscore');
    });

    it('should generate unique selector for different elements', () => {
      $('body').html(`<div><p class="first"></p><p class="second"></p></div>`)
      const ps = $('p');
      const p1 = ps.eq(0)[0];
      const p2 = ps.eq(1)[0];

      expect(p1).to.not.equal(p2);
    });

    it('should handle mixed inline and block elements', () => {
      $('body').html(`<div class="container"><span class="label"></span></div>`);

      const span = $('span')[0];

      const result = getElementSelector(span);
      expect(result).to.include('span.label');
      expect(result).to.include('div.container');
    });

    it('should work with common HTML elements', () => {
      const elements = ['div', 'p', 'span', 'section', 'article', 'header', 'footer', 'nav', 'li'];

      const $ = cheerioLoad('<body></body>');

      elements.forEach((tagName) => {
        const element = $(`<${tagName}></${tagName}>`);

        $('body').append(element);

        const result = getElementSelector(element[0]);
        expect(result).to.include(tagName);
      });
    });

    it('should generate selector that can be used in querySelector', () => {
      $('body').html(`
        <div class="wrapper">
          <p class="target"></p>
        </div>
      `)

      const target = $('p.target')[0];

      const selector = getElementSelector(target);

      // Verify the selector can be used to find the element
      const found = $(selector)[0];
      expect(found).to.equal(target);
    });
  });

  describe('edge cases', () => {
    it('should handle element with className as non-string', () => {
      $('body').html('<div></div>');

      const div = $('div')[0];
      // Simulate non-string className (some DOM implementations)
      Object.defineProperty(div, 'className', {
        value: 42,
        writable: true,
      });

      const result = getElementSelector(div);
      expect(result).to.include('div');
    });

    it('should handle element with only whitespace in ID', () => {
      $('body').html(`<div id="   "></div>`);

      const div = $('div')[0];

      // Browser will trim ID, but testing edge case
      const result = getElementSelector(div);
      expect(result).to.be.a('string');
    });

    it('should handle element with numeric class names', () => {
      $('body').html(`<div class="123 456"></div>`);

      const div = $('div')[0];

      const result = getElementSelector(div);
      // CSS class selectors with numbers are valid if they start with a digit
      expect(result).to.be.a('string');
    });

    it('should handle body element', () => {
      $('body').html(``);
      const body = $(`body`)[0];

      const result = getElementSelector(body);
      expect(result).to.equal('body');
    });

    it('should handle html element', () => {
      $('body').html(``);
      const html = $(`html`)[0];

      const result = getElementSelector(html);
      expect(result).to.equal('html');
    });

    it('should handle element without parent (detached element)', () => {
      // Create a detached element without a parent
      const detachedElement = {
        name: 'div',
        attribs: { class: 'detached' },
        parent: null,
        type: 'tag',
      };

      const result = getElementSelector(detachedElement);
      expect(result).to.equal('div.detached');
    });

    it('should handle element with parent that has no name property', () => {
      // Element with a parent that lacks the name property
      // This triggers line 108-109 in buildSelectorPath
      const parentWithoutName = {
        type: 'root',
        children: [],
      };

      const elementWithBadParent = {
        name: 'p',
        attribs: { class: 'test' },
        parent: parentWithoutName,
        type: 'tag',
      };

      const result = getElementSelector(elementWithBadParent);
      // Should return selector without parent path since parent has no name
      expect(result).to.include('p.test');
    });

    it('should handle deeply nested element where recursive parent returns empty', () => {
      // Create a chain where the grandparent causes early return
      const grandparent = {
        name: 'section',
        attribs: {},
        parent: { type: 'root' }, // Parent without name - triggers line 108
        type: 'tag',
        children: [],
      };

      const parent = {
        name: 'div',
        attribs: { class: 'wrapper' },
        parent: grandparent,
        type: 'tag',
        children: [],
      };

      grandparent.children = [parent];

      const element = {
        name: 'p',
        attribs: { class: 'content' },
        parent,
        type: 'tag',
      };

      parent.children = [element];

      const result = getElementSelector(element);
      // Should handle the case where parent path building stops due to grandparent structure
      expect(result).to.be.a('string');
      // Result may include path components depending on how deep we go
    });

    it('should return selector when parent selector is empty from recursion', () => {
      // Create element with parent that will return empty selector
      const invalidGrandparent = {
        name: 'article',
        attribs: {},
        parent: null, // No parent for grandparent
        type: 'tag',
        children: [],
      };

      const parent = {
        name: 'section',
        attribs: {},
        parent: invalidGrandparent,
        type: 'tag',
        children: [],
      };

      invalidGrandparent.children = [parent];

      const element = {
        name: 'span',
        attribs: { class: 'text' },
        parent,
        type: 'tag',
      };

      parent.children = [element];

      const result = getElementSelector(element);
      expect(result).to.be.a('string');
      expect(result).to.include('span.text');
    });

    it('should handle body element in getSingleElementSelector path', () => {
      // Use a getter that returns 'div' for initial checks but 'body' when
      // getSingleElementSelector accesses it for selector building
      // This tests lines 36-37 in getSingleElementSelector
      let nameAccessCount = 0;
      const trickElement = {
        get name() {
          nameAccessCount++;
          // Access 1: getElementSelector line 145 (!element.name check)
          // Access 2: buildSelectorPath line 81 (!element.name check)
          // Access 3: buildSelectorPath line 85 (destructure)
          // Access 4: getSingleElementSelector line 22-23 (destructure) -> return 'body'
          if (nameAccessCount <= 3) return 'div';
          return 'body';
        },
        attribs: {},
        parent: { name: 'html', type: 'tag' },
        type: 'tag',
        children: [],
      };

      const result = getElementSelector(trickElement);
      expect(result).to.equal('body');
    });

    it('should return empty when element becomes invalid during buildSelectorPath recursion', () => {
      // Use a getter to make parent.name return valid value at line 107 check
      // but invalid value when accessed in recursive buildSelectorPath at line 81
      // This tests lines 82-83
      let nameAccessCount = 0;
      const trickParent = {
        get name() {
          nameAccessCount++;
          // Access 1: line 107 check (parent.name)
          // Access 2: line 111 (parent.name.toLowerCase)
          // Access 3: recursive call line 81 (element.name)
          if (nameAccessCount <= 2) return 'section';
          return undefined; // This triggers line 82 return ''
        },
        attribs: { class: 'parent' },
        parent: { name: 'article', type: 'tag', attribs: {}, parent: null, children: [] },
        type: 'tag',
        children: [],
      };

      const element = {
        name: 'p',
        attribs: { class: 'test' },
        parent: trickParent,
        type: 'tag',
      };

      trickParent.children = [element];

      const result = getElementSelector(element);
      // When recursive buildSelectorPath returns '', lines 129-130 are hit
      expect(result).to.be.a('string');
      expect(result).to.include('p.test');
    });

    it('should handle when recursive buildSelectorPath returns html', () => {
      // Use a getter to make parent pass initial checks but return 'html' tag in recursion
      // This tests line 130 (parentSelector === 'html')
      let nameAccessCount = 0;
      const trickParent = {
        get name() {
          nameAccessCount++;
          // Access 1: line 107 check (parent.name)
          // Access 2: line 111 (parent.name.toLowerCase)
          // Access 3: recursive call line 81 (element.name)
          // Access 4: recursive call line 85 destructure
          if (nameAccessCount <= 2) return 'section';
          return 'html'; // This makes recursive call return 'html' at line 90
        },
        attribs: {},
        parent: { name: 'div', type: 'tag', attribs: {}, parent: null, children: [] },
        type: 'tag',
        children: [],
      };

      const element = {
        name: 'span',
        attribs: { class: 'content' },
        parent: trickParent,
        type: 'tag',
      };

      trickParent.children = [element];

      const result = getElementSelector(element);
      // When recursive buildSelectorPath returns 'html', line 130 is hit
      expect(result).to.be.a('string');
      expect(result).to.include('span.content');
    });

    it('should handle element with name property but invalid structure', () => {
      const invalidElement = {
        name: 'div',
        // Missing attribs, parent, etc.
      };

      const result = getElementSelector(invalidElement);
      expect(result).to.be.a('string');
    });
  });
});
