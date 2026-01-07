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

    it('should prioritize data-aue-resource attribute (Universal Editor)', () => {
      const html = '<div data-aue-resource="urn:aemconnection:/content/test" id="test-id" class="test-class">Test</div>';
      const $test = cheerioLoad(html);
      const element = $test('div').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.equal('div[data-aue-resource="urn:aemconnection:/content/test"]');
    });

    it('should use data-aue-prop for property-level elements', () => {
      const html = '<h1 data-aue-prop="title" class="heading">My Title</h1>';
      const $test = cheerioLoad(html);
      const element = $test('h1').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.equal('h1[data-aue-prop="title"]');
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

    it('should stop at parent with data-aue-resource attribute', () => {
      const html = `
        <div data-aue-resource="urn:aemconnection:/content/test/section">
          <div class="content">
            <p class="text">Some paragraph text</p>
          </div>
        </div>
      `;
      const $test = cheerioLoad(html);
      const element = $test('p').get(0);
      const selector = getDomElementSelector(element);
      expect(selector).to.include('div[data-aue-resource="urn:aemconnection:/content/test/section"]');
      expect(selector).to.include('p.text');
    });

    it('should work with nested Universal Editor components', () => {
      const html = `
        <section data-aue-resource="urn:aemconnection:/content/page/section">
          <div data-aue-resource="urn:aemconnection:/content/page/section/block">
            <h2 data-aue-prop="title">Heading</h2>
          </div>
        </section>
      `;
      const $test = cheerioLoad(html);
      const element = $test('h2').get(0);
      const selector = getDomElementSelector(element);
      // Should use the data-aue-prop as it's most specific
      expect(selector).to.equal('h2[data-aue-prop="title"]');
    });

    it('should handle Universal Editor teaser component like in example', () => {
      const html = `
        <div data-aue-type="container" data-aue-resource="urn:aemconnection:/content/frescopa/en/index/jcr:content/root/section_0">
          <div class="teaser-wrapper">
            <div data-aue-resource="urn:aemconnection:/content/frescopa/en/index/jcr:content/root/section_0/block" class="teaser dark">
              <div class="foreground">
                <div class="text">
                  <div class="title">
                    <h3 data-aue-prop="title" data-aue-label="Heading" data-aue-type="text">Your perfect coffee!</h3>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      const $test = cheerioLoad(html);
      const h3Element = $test('h3').get(0);
      const selector = getDomElementSelector(h3Element);
      // Should use data-aue-prop for the h3 element
      expect(selector).to.equal('h3[data-aue-prop="title"]');
    });

    it('should handle Universal Editor body tag with data-aue-resource', () => {
      const html = `<body data-aue-resource="urn:aemconnection:/content/frescopa/en/index/jcr:content" data-aue-label="Page">
        <main>
          <div class="content">Lorem ipsum text here</div>
        </main>
      </body>`;
      const $test = cheerioLoad(html);
      const divElement = $test('div.content').get(0);
      const selector = getDomElementSelector(divElement);
      // Should include the body with data-aue-resource in the path
      expect(selector).to.include('body[data-aue-resource="urn:aemconnection:/content/frescopa/en/index/jcr:content"]');
      expect(selector).to.include('div.content');
    });
  });

  describe('toElementTargets', () => {
    it('should return an empty object for null or undefined input', () => {
      expect(toElementTargets(null)).to.deep.equal({});
      expect(toElementTargets(undefined)).to.deep.equal({});
      expect(toElementTargets('')).to.deep.equal({});
      expect(toElementTargets(false)).to.deep.equal({});
      expect(toElementTargets(0)).to.deep.equal({});
    });

    it('should convert a single selector string to elements object', () => {
      const selector = 'div.test';
      expect(toElementTargets(selector)).to.deep.equal({
        elements: [{ selector: 'div.test' }],
      });
    });

    it('should convert an array of selector strings to elements object', () => {
      const selectors = ['div.test1', 'span.test2'];
      expect(toElementTargets(selectors)).to.deep.equal({
        elements: [
          { selector: 'div.test1' },
          { selector: 'span.test2' },
        ],
      });
    });

    it('should filter out null or empty selectors', () => {
      const selectors = ['div.test1', null, '', 'span.test2', undefined, false];
      expect(toElementTargets(selectors)).to.deep.equal({
        elements: [
          { selector: 'div.test1' },
          { selector: 'span.test2' },
        ],
      });
    });

    it('should apply limit correctly', () => {
      const selectors = ['div.test1', 'span.test2', 'p.test3'];
      expect(toElementTargets(selectors, 2)).to.deep.equal({
        elements: [
          { selector: 'div.test1' },
          { selector: 'span.test2' },
        ],
      });
    });

    it('should handle duplicate selectors by returning unique ones', () => {
      const selectors = ['div.test1', 'span.test2', 'div.test1', 'span.test2'];
      expect(toElementTargets(selectors)).to.deep.equal({
        elements: [
          { selector: 'div.test1' },
          { selector: 'span.test2' },
        ],
      });
    });

    it('should handle empty array', () => {
      expect(toElementTargets([])).to.deep.equal({});
    });

    it('should handle single string selector', () => {
      expect(toElementTargets('body > main')).to.deep.equal({
        elements: [
          { selector: 'body > main' },
        ],
      });
    });
  });

  describe('Cloud Service Context', () => {
    describe('getDomElementSelector - AEM Cloud Service', () => {
      it('should detect and use cq[data-path] for Cloud Service context', () => {
        const html = `
          <body>
            <div class="container">
              <cq data-path="/content/wknd/en/adventures/surf-camp-costa-rica/jcr:content/root/container/breadcrumb" data-config="..."></cq>
              <div class="breadcrumb">
                <nav>
                  <ol>
                    <li><a href="/adventures">Adventures</a></li>
                  </ol>
                </nav>
              </div>
            </div>
          </body>
        `;
        const $cs = cheerioLoad(html);
        const link = $cs('a').get(0);
        const selector = getDomElementSelector(link);

        expect(selector).to.equal('cq[data-path="/content/wknd/en/adventures/surf-camp-costa-rica/jcr:content/root/container/breadcrumb"]');
      });

      it('should find nearest cq[data-path] when element is deeply nested', () => {
        const html = `
          <body>
            <cq data-path="/content/wknd/en/jcr:content/root/container" data-config="..."></cq>
            <div class="container">
              <cq data-path="/content/wknd/en/jcr:content/root/container/carousel" data-config="..."></cq>
              <div class="carousel">
                <div class="carousel-item">
                  <img src="/image.jpg" alt="Image">
                </div>
              </div>
            </div>
          </body>
        `;
        const $cs = cheerioLoad(html);
        const img = $cs('img').get(0);
        const selector = getDomElementSelector(img);

        // Should use the nearest cq element (carousel, not container)
        expect(selector).to.equal('cq[data-path="/content/wknd/en/jcr:content/root/container/carousel"]');
      });

      it('should use cq parent when cq is an actual parent element', () => {
        const html = `
          <body>
            <cq data-path="/content/wknd/en/jcr:content/root/container">
              <div class="content">
                <p>Some text</p>
              </div>
            </cq>
          </body>
        `;
        const $cs = cheerioLoad(html);
        const p = $cs('p').get(0);
        const selector = getDomElementSelector(p);

        // Should use the cq parent
        expect(selector).to.equal('cq[data-path="/content/wknd/en/jcr:content/root/container"]');
      });

      it('should fall back to standard selectors when no cq[data-path] found', () => {
        const html = `
          <body>
            <div id="main">
              <h1>Title</h1>
            </div>
          </body>
        `;
        const $cs = cheerioLoad(html);
        const h1 = $cs('h1').get(0);
        const selector = getDomElementSelector(h1);

        expect(selector).to.not.include('cq[data-path=');
        expect(selector).to.include('h1');
      });
    });

    describe('toElementTargets - Cloud Service Format', () => {
      it('should return CS format for cq[data-path] selectors', () => {
        const selectors = [
          'cq[data-path="/content/wknd/en/jcr:content/root/container/breadcrumb"]',
          'cq[data-path="/content/wknd/en/jcr:content/root/container/carousel"]',
        ];

        const result = toElementTargets(selectors);

        expect(result).to.be.an('object');
        expect(result).to.have.property('selector');
        expect(result.selector).to.have.property('elements');
        expect(result.selector.elements).to.be.an('array');
        expect(result.selector.elements).to.have.lengthOf(2);
        expect(result.selector.elements[0]).to.equal(selectors[0]);
        expect(result.selector.elements[1]).to.equal(selectors[1]);
      });

      it('should return CS format with context when provided', () => {
        const selectors = ['cq[data-path="/content/wknd/en/jcr:content/root/container/title"]'];
        const context = 'page title';

        const result = toElementTargets(selectors, Infinity, context);

        expect(result).to.be.an('object');
        expect(result.selector).to.have.property('elements');
        expect(result.selector).to.have.property('context', context);
      });

      it('should handle single CS selector', () => {
        const selector = 'cq[data-path="/content/wknd/en/jcr:content/root/container/title"]';

        const result = toElementTargets(selector);

        expect(result).to.be.an('object');
        expect(result.selector.elements).to.be.an('array');
        expect(result.selector.elements).to.have.lengthOf(1);
        expect(result.selector.elements[0]).to.equal(selector);
      });

      it('should deduplicate CS selectors', () => {
        const selectors = [
          'cq[data-path="/content/wknd/en/jcr:content/root/container/title"]',
          'cq[data-path="/content/wknd/en/jcr:content/root/container/title"]',
          'cq[data-path="/content/wknd/en/jcr:content/root/container/image"]',
        ];

        const result = toElementTargets(selectors);

        expect(result.selector.elements).to.have.lengthOf(2);
      });

      it('should respect limit for CS selectors', () => {
        const selectors = [
          'cq[data-path="/content/wknd/en/jcr:content/root/container/title"]',
          'cq[data-path="/content/wknd/en/jcr:content/root/container/image"]',
          'cq[data-path="/content/wknd/en/jcr:content/root/container/text"]',
        ];

        const result = toElementTargets(selectors, 2);

        expect(result.selector.elements).to.have.lengthOf(2);
      });

      it('should extract and format CS selectors from real-world HTML', () => {
        const html = `
          <body>
            <div class="root container responsivegrid">
              <div class="container responsivegrid">
                <cq data-path="/content/wknd/language-masters/en/adventures/surf-camp-costa-rica/jcr:content/root/container/breadcrumb"></cq>
                <div class="breadcrumb">
                  <nav class="cmp-breadcrumb">
                    <ol class="cmp-breadcrumb__list">
                      <li class="cmp-breadcrumb__item">
                        <a class="cmp-breadcrumb__item-link" href="/adventures">Adventures</a>
                      </li>
                    </ol>
                  </nav>
                </div>
              </div>
            </div>
          </body>
        `;

        const $cs = cheerioLoad(html);
        const breadcrumbLink = $cs('.cmp-breadcrumb__item-link').get(0);
        const selector = getDomElementSelector(breadcrumbLink);
        const targets = toElementTargets(selector);

        expect(selector).to.include('cq[data-path=');
        expect(selector).to.include('/content/wknd/language-masters/en/adventures/surf-camp-costa-rica');
        expect(targets).to.have.property('selector');
        expect(targets.selector.elements).to.be.an('array').with.lengthOf(1);
      });
    });
  });
});
