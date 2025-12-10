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
import { getDomElementSelector, toElementTargets } from '../../src/utils/dom-selector.js';

describe('DOM Selector Utils', () => {
  describe('getDomElementSelector', () => {
    it('should generate unique selectors for different links in separate paragraphs', () => {
      const html = `
        <div class="section columns-container">
          <div class="default-content-wrapper">
            <p><a href="https://example.com/link1">Link 1</a></p>
            <p><a href="https://example.com/link2">Link 2</a></p>
            <p><a href="https://example.com/link3">Link 3</a></p>
          </div>
        </div>
      `;
      const $ = cheerioLoad(html);
      const links = $('a');
      const selectors = [];

      links.each((i, link) => {
        const selector = getDomElementSelector(link);
        selectors.push(selector);
      });

      // All selectors should be unique
      const uniqueSelectors = [...new Set(selectors)];
      expect(selectors).to.have.lengthOf(3);
      expect(uniqueSelectors).to.have.lengthOf(3);

      // Verify each selector contains nth-of-type for the paragraph
      expect(selectors[0]).to.include('p:nth-of-type(1)');
      expect(selectors[1]).to.include('p:nth-of-type(2)');
      expect(selectors[2]).to.include('p:nth-of-type(3)');
    });

    it('should verify selectors actually select the correct elements', () => {
      const html = `
        <div class="section columns-container">
          <div class="default-content-wrapper">
            <p><a href="https://example.com/link1">Link 1</a></p>
            <p><a href="http://example.com/link2">Link 2</a></p>
            <p><a href="/broken">Link 3</a></p>
            <p><a href="/another-broken/">Link 4</a></p>
          </div>
        </div>
      `;
      const $ = cheerioLoad(html);
      const links = $('a');

      links.each((i, link) => {
        const selector = getDomElementSelector(link);
        const expectedHref = $(link).attr('href');

        // Use the generated selector to find the element
        const foundElement = $(selector);

        // Verify we found exactly one element
        expect(foundElement).to.have.lengthOf(1);

        // Verify it's the correct element by comparing href
        const foundHref = foundElement.attr('href');
        expect(foundHref).to.equal(expectedHref);
      });
    });

    it('should handle elements with IDs by returning immediately', () => {
      const html = '<div><a id="unique-link" href="https://example.com">Link</a></div>';
      const $ = cheerioLoad(html);
      const link = $('a')[0];

      const selector = getDomElementSelector(link);

      expect(selector).to.equal('a#unique-link');
    });

    it('should handle elements with classes', () => {
      const html = '<div><a class="button primary" href="https://example.com">Link</a></div>';
      const $ = cheerioLoad(html);
      const link = $('a')[0];

      const selector = getDomElementSelector(link);

      expect(selector).to.include('a.button.primary');
    });

    it('should add nth-of-type when there are multiple siblings of same tag', () => {
      const html = `
        <div>
          <a href="https://example.com/1">Link 1</a>
          <a href="https://example.com/2">Link 2</a>
          <a href="https://example.com/3">Link 3</a>
        </div>
      `;
      const $ = cheerioLoad(html);
      const links = $('a');

      const selector1 = getDomElementSelector(links[0]);
      const selector2 = getDomElementSelector(links[1]);
      const selector3 = getDomElementSelector(links[2]);

      expect(selector1).to.include(':nth-of-type(1)');
      expect(selector2).to.include(':nth-of-type(2)');
      expect(selector3).to.include(':nth-of-type(3)');

      // Verify they are all different
      expect(selector1).to.not.equal(selector2);
      expect(selector2).to.not.equal(selector3);
      expect(selector1).to.not.equal(selector3);
    });

    it('should stop at parent with ID and not go beyond it', () => {
      const html = `
        <div id="container">
          <div class="wrapper">
            <p><a href="https://example.com">Link</a></p>
          </div>
        </div>
      `;
      const $ = cheerioLoad(html);
      const link = $('a')[0];

      const selector = getDomElementSelector(link);

      // Should include the ID as the topmost selector
      expect(selector).to.include('#container');
      // Should not go beyond the ID to html or body
      expect(selector).to.not.match(/^(html|body)/);
      // The selector should still be specific enough to identify the link
      const foundElement = $(selector);
      expect(foundElement).to.have.lengthOf(1);
      expect(foundElement.attr('href')).to.equal('https://example.com');
    });

    it('should limit to 3 levels of depth', () => {
      const html = `
        <div class="level1">
          <div class="level2">
            <div class="level3">
              <div class="level4">
                <div class="level5">
                  <a href="https://example.com">Link</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      const $ = cheerioLoad(html);
      const link = $('a')[0];

      const selector = getDomElementSelector(link);

      // Count the number of ' > ' separators (should be at most 3 for 4 parts)
      const parts = selector.split(' > ');
      expect(parts).to.have.lengthOf.at.most(4); // target + 3 levels
    });

    it('should return null for invalid elements', () => {
      const selector = getDomElementSelector(null);
      expect(selector).to.be.null;

      const selector2 = getDomElementSelector({});
      expect(selector2).to.be.null;
    });

    it('should handle complex real-world scenario from user report', () => {
      // This is the actual HTML structure from the user's report
      const html = `
        <div class="section columns-container">
          <div class="default-content-wrapper">
            <p><a href="https://bit.ly/3aImqUL">https://www.aem.live/tutorial</a></p>
            <p><a href="http://www.aem.live/tutorial">http://www.aem.live/tutorial</a></p>
            <p><a href="https://www.aem.live/tutral">https://www.aem.live/tutral</a></p>
            <p><a href="/broken">broken link</a></p>
            <p><a href="/another-broken/">another broken</a></p>
          </div>
        </div>
      `;
      const $ = cheerioLoad(html);
      const links = $('a');
      const selectors = new Map();

      links.each((i, link) => {
        const selector = getDomElementSelector(link);
        const href = $(link).attr('href');
        selectors.set(href, selector);
      });

      // All selectors should be unique
      const uniqueSelectors = [...new Set(selectors.values())];
      expect(uniqueSelectors).to.have.lengthOf(5);

      // Verify each selector points to the correct element
      selectors.forEach((selector, href) => {
        const foundElement = $(selector);
        expect(foundElement).to.have.lengthOf(1, `Selector "${selector}" should find exactly one element`);
        expect(foundElement.attr('href')).to.equal(href, `Selector "${selector}" should find element with href "${href}"`);
      });
    });
  });

  describe('toElementTargets', () => {
    it('should convert string to array of element targets', () => {
      const result = toElementTargets('div > a');
      expect(result).to.deep.equal([{ selector: 'div > a' }]);
    });

    it('should convert array to element targets', () => {
      const result = toElementTargets(['div > a', 'p > a']);
      expect(result).to.deep.equal([
        { selector: 'div > a' },
        { selector: 'p > a' },
      ]);
    });

    it('should remove duplicates', () => {
      const result = toElementTargets(['div > a', 'div > a', 'p > a']);
      expect(result).to.deep.equal([
        { selector: 'div > a' },
        { selector: 'p > a' },
      ]);
    });

    it('should respect limit parameter', () => {
      const result = toElementTargets(['div > a', 'p > a', 'span > a'], 2);
      expect(result).to.have.lengthOf(2);
      expect(result).to.deep.equal([
        { selector: 'div > a' },
        { selector: 'p > a' },
      ]);
    });

    it('should return empty array for null/undefined input', () => {
      expect(toElementTargets(null)).to.deep.equal([]);
      expect(toElementTargets(undefined)).to.deep.equal([]);
    });

    it('should filter out null/undefined values in array', () => {
      const result = toElementTargets(['div > a', null, 'p > a', undefined]);
      expect(result).to.deep.equal([
        { selector: 'div > a' },
        { selector: 'p > a' },
      ]);
    });
  });
});
