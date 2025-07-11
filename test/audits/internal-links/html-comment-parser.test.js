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
import { parseBrokenLinkComments, parseAllBrokenLinkFormats } from '../../../src/internal-links/html-comment-parser.js';

describe('HTML Comment Parser Tests', () => {
  const mockLogger = {
    warn: () => {},
    error: () => {},
    info: () => {},
  };

  describe('parseBrokenLinkComments', () => {
    it('should parse a broken link comment in the specified format', () => {
      const html = `
        <html>
          <body>
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/language-masters1.html" validity="INVALID" source="/content/wknd/language-masters/jcr:content" timestamp="1750397659312" request_uri="/content/wknd/language-masters.html" -->
            <p>Some content</p>
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/content/wknd/language-masters.html';

      const result = parseBrokenLinkComments(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(1);
      expect(result[0]).to.deep.include({
        urlFrom: pageUrl,
        urlTo: '/content/wknd/language-masters1.html',
        trafficDomain: 1,
        detectedVia: 'html-comment',
        source: '/content/wknd/language-masters/jcr:content',
        requestUri: '/content/wknd/language-masters.html',
        timestamp: '1750397659312',
      });
    });

    it('should parse multiple broken link comments', () => {
      const html = `
        <html>
          <body>
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path1.html" validity="INVALID" source="/content/wknd/source1" timestamp="1750397659312" request_uri="/content/wknd/page1.html" -->
            <p>Some content</p>
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path2.html" validity="INVALID" source="/content/wknd/source2" timestamp="1750397659313" request_uri="/content/wknd/page2.html" -->
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/page';

      const result = parseBrokenLinkComments(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(2);
      expect(result[0].urlTo).to.equal('/content/wknd/path1.html');
      expect(result[1].urlTo).to.equal('/content/wknd/path2.html');
    });

    it('should ignore comments that are not broken link comments', () => {
      const html = `
        <html>
          <body>
            <!-- This is a regular comment -->
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path1.html" validity="INVALID" source="/content/wknd/source1" timestamp="1750397659312" request_uri="/content/wknd/page1.html" -->
            <!-- Another regular comment -->
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/page';

      const result = parseBrokenLinkComments(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(1);
      expect(result[0].urlTo).to.equal('/content/wknd/path1.html');
    });

    it('should ignore broken link comments with validity other than INVALID', () => {
      const html = `
        <html>
          <body>
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path1.html" validity="VALID" source="/content/wknd/source1" timestamp="1750397659312" request_uri="/content/wknd/page1.html" -->
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path2.html" validity="INVALID" source="/content/wknd/source2" timestamp="1750397659313" request_uri="/content/wknd/page2.html" -->
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/page';

      const result = parseBrokenLinkComments(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(1);
      expect(result[0].urlTo).to.equal('/content/wknd/path2.html');
    });

    it('should handle malformed broken link comments gracefully', () => {
      const html = `
        <html>
          <body>
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path1.html" validity="INVALID" source="/content/wknd/source1" timestamp="1750397659312" request_uri="/content/wknd/page1.html" -->
            <!-- BROKEN_INTERNAL_LINK: malformed comment -->
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/page';

      const result = parseBrokenLinkComments(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(1);
      expect(result[0].urlTo).to.equal('/content/wknd/path1.html');
    });

    it('should return empty array for empty HTML', () => {
      const result = parseBrokenLinkComments('', 'https://example.com/page', mockLogger);
      expect(result).to.be.an('array').with.length(0);
    });

    it('should return empty array for null HTML', () => {
      const result = parseBrokenLinkComments(null, 'https://example.com/page', mockLogger);
      expect(result).to.be.an('array').with.length(0);
    });
  });

  describe('parseAllBrokenLinkFormats', () => {
    it('should parse both standard and simple broken link formats', () => {
      const html = `
        <html>
          <body>
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path1.html" validity="INVALID" source="/content/wknd/source1" timestamp="1750397659312" request_uri="/content/wknd/page1.html" -->
            <p>Some content</p>
            <!-- BROKEN_LINK: /content/wknd/another-broken-path.html -->
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/page';

      const result = parseAllBrokenLinkFormats(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(2);
      expect(result[0].urlTo).to.equal('/content/wknd/path1.html');
      expect(result[0].detectedVia).to.equal('html-comment');
      expect(result[1].urlTo).to.equal('/content/wknd/another-broken-path.html');
      expect(result[1].detectedVia).to.equal('html-comment-simple');
    });

    it('should handle multiple instances of each format', () => {
      const html = `
        <html>
          <body>
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path1.html" validity="INVALID" source="/content/wknd/source1" timestamp="1750397659312" request_uri="/content/wknd/page1.html" -->
            <p>Some content</p>
            <!-- BROKEN_LINK: /content/wknd/another-broken-path.html -->
            <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/path2.html" validity="INVALID" source="/content/wknd/source2" timestamp="1750397659313" request_uri="/content/wknd/page2.html" -->
            <p>More content</p>
            <!-- BROKEN_LINK: /content/wknd/yet-another-broken-path.html -->
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/page';

      const result = parseAllBrokenLinkFormats(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(4);
      expect(result.filter((link) => link.detectedVia === 'html-comment')).to.have.length(2);
      expect(result.filter((link) => link.detectedVia === 'html-comment-simple')).to.have.length(2);
    });

    it('should return empty array for empty HTML', () => {
      const result = parseAllBrokenLinkFormats('', 'https://example.com/page', mockLogger);
      expect(result).to.be.an('array').with.length(0);
    });

    it('should return empty array for null HTML', () => {
      const result = parseAllBrokenLinkFormats(null, 'https://example.com/page', mockLogger);
      expect(result).to.be.an('array').with.length(0);
    });

    it('should handle HTML with no broken link comments', () => {
      const html = `
        <html>
          <body>
            <!-- Just a regular comment -->
            <p>Some content</p>
          </body>
        </html>
      `;
      const pageUrl = 'https://example.com/page';

      const result = parseAllBrokenLinkFormats(html, pageUrl, mockLogger);

      expect(result).to.be.an('array').with.length(0);
    });
  });
});
