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
import { load as cheerioLoad } from 'cheerio';
import { getDomElementSelector, toElementTargets } from '../../src/utils/dom-selector.js';

describe('dom-selector.js', () => {
  let $;

  beforeEach(() => {
    $ = cheerioLoad(`
      <html>
        <body>
          <header>
            <h1 id="main-title" class="header-title">Main Title</h1>
          </header>
          <main>
            <section class="content-section">
              <h2 class="section-heading">Section 1</h2>
              <p>Some text.</p>
              <h2 class="section-heading">Section 2</h2>
              <div>
                <h3>Sub-section A</h3>
                <h3>Sub-section B</h3>
              </div>
            </section>
            <section>
              <h2 id="unique-heading">Unique Section</h2>
            </section>
            <div class="parent-container">
              <div class="child-container">
                <p>Paragraph 1</p>
                <p>Paragraph 2</p>
                <p>Paragraph 3</p>
              </div>
              <div class="child-container">
                <p>Another Paragraph</p>
              </div>
            </div>
          </main>
          <footer>
            <p>Footer content</p>
          </footer>
        </body>
      </html>
    `);
  });

  describe('getDomElementSelector', () => {
    it('should return null for invalid element', () => {
      expect(getDomElementSelector(null)).to.be.null;
      expect(getDomElementSelector(undefined)).to.be.null;
      expect(getDomElementSelector({})).to.be.null;
    });

    it('should generate a selector with ID if available', () => {
      const element = $('#main-title').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.equal('h1#main-title');
    });

    it('should generate a selector with classes if no ID', () => {
      const element = $('h2.section-heading').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.include('h2.section-heading');
    });

    it('should generate a selector with nth-of-type for siblings of the same tag', () => {
      const elements = $('h2.section-heading').get();
      const selector2 = getDomElementSelector(elements[1]);
      expect(selector2).to.include(':nth-of-type(2)');
    });

    it('should generate a selector with parent context up to 3 levels', () => {
      const element = $('h3').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.include('main');
      expect(selector).to.include('section.content-section');
      expect(selector).to.include('h3:nth-of-type(1)');
    });

    it('should stop at parent with ID', () => {
      const element = $('#unique-heading').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.equal('h2#unique-heading');
    });

    it('should handle elements without classes or ID', () => {
      const element = $('footer > p').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.include('footer');
      expect(selector).to.include('p');
    });

    it('should generate nth-of-type for parent when parent has siblings', () => {
      // Get a paragraph inside the second child-container
      const element = $('.child-container').eq(1).find('p').get(0);
      const selector = getDomElementSelector(element);
      // This should include :nth-of-type for both the parent div and the p element
      expect(selector).to.include('div.child-container:nth-of-type(2)');
    });

    it('should handle deeply nested elements with multiple siblings at each level', () => {
      // Get the second paragraph in the first child-container
      const element = $('.child-container').eq(0).find('p').eq(1)
        .get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.include(':nth-of-type');
      expect(selector).to.include('p:nth-of-type(2)');
    });

    it('should limit classes to two for readability', () => {
      $('h1').addClass('extra-class another-class');
      const element = $('h1').get(0);
      const selector = getDomElementSelector(element);
      // Should still use ID
      expect(selector).to.equal('h1#main-title');
    });
  });

  describe('toElementTargets', () => {
    it('should return an empty array for null or undefined input', () => {
      expect(toElementTargets(null)).to.deep.equal([]);
      expect(toElementTargets(undefined)).to.deep.equal([]);
      expect(toElementTargets('')).to.deep.equal([]);
      expect(toElementTargets(false)).to.deep.equal([]);
      expect(toElementTargets(0)).to.deep.equal([]);
    });

    it('should convert a single selector string to an array of objects', () => {
      const selector = 'div.test';
      expect(toElementTargets(selector)).to.deep.equal([{ selector: 'div.test' }]);
    });

    it('should convert an array of selector strings to an array of objects', () => {
      const selectors = ['div.test1', 'span.test2'];
      expect(toElementTargets(selectors)).to.deep.equal([
        { selector: 'div.test1' },
        { selector: 'span.test2' },
      ]);
    });

    it('should filter out null or empty selectors', () => {
      const selectors = ['div.test1', null, '', 'span.test2', undefined, false];
      expect(toElementTargets(selectors)).to.deep.equal([
        { selector: 'div.test1' },
        { selector: 'span.test2' },
      ]);
    });

    it('should apply limit correctly', () => {
      const selectors = ['div.test1', 'span.test2', 'p.test3'];
      expect(toElementTargets(selectors, 2)).to.deep.equal([
        { selector: 'div.test1' },
        { selector: 'span.test2' },
      ]);
    });

    it('should handle duplicate selectors by returning unique ones', () => {
      const selectors = ['div.test1', 'span.test2', 'div.test1', 'span.test2'];
      expect(toElementTargets(selectors)).to.deep.equal([
        { selector: 'div.test1' },
        { selector: 'span.test2' },
      ]);
    });

    it('should handle empty array', () => {
      expect(toElementTargets([])).to.deep.equal([]);
    });

    it('should handle single string selector', () => {
      expect(toElementTargets('body > main')).to.deep.equal([
        { selector: 'body > main' },
      ]);
    });
  });
});
