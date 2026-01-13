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
import {
  trimTagValue,
  normalizeTagValue,
  getIssueRanking,
  extractHreflangLinks,
  hasReciprocalLink,
  buildExpectedHreflangSet,
} from '../../src/utils/seo-utils.js';

describe('trimTagValue', () => {
  it('should trim leading and trailing whitespace from string', () => {
    const result = trimTagValue('   Hello World   ');
    expect(result).to.equal('Hello World');
  });

  it('should trim whitespace from array of strings', () => {
    const result = trimTagValue(['  title  ', '  h1  ']);
    expect(result).to.deep.equal(['title', 'h1']);
  });

  it('should handle array with non-string items', () => {
    // This covers the branch: typeof item === 'string' ? trim : item
    const result = trimTagValue(['  text  ', 123, null]);
    expect(result).to.deep.equal(['text', 123, null]);
  });

  it('should return null/undefined/empty values unchanged', () => {
    expect(trimTagValue(null)).to.be.null;
    expect(trimTagValue(undefined)).to.be.undefined;
    expect(trimTagValue('')).to.equal('');
  });

  it('should return non-string, non-array values unchanged', () => {
    // This covers the branch: typeof value === 'string' ? trim : value
    expect(trimTagValue(123)).to.equal(123);
    expect(trimTagValue(true)).to.equal(true);
  });

  it('should trim real-world example with excessive whitespace', () => {
    // Real example from Okta "IP Spoofing" page
    const result = trimTagValue('                    What Is Federated Identity?                    ');
    expect(result).to.equal('What Is Federated Identity?');
  });
});

describe('normalizeTagValue', () => {
  it('should convert string to lowercase', () => {
    const result = normalizeTagValue('Error Page');
    expect(result).to.equal('error page');
  });

  it('should handle string with mixed case', () => {
    const result = normalizeTagValue('404 Not Found');
    expect(result).to.equal('404 not found');
  });

  it('should take first non-empty value from array', () => {
    const result = normalizeTagValue(['Error Page', 'Another Title']);
    expect(result).to.equal('error page');
  });

  it('should skip empty strings in array', () => {
    const result = normalizeTagValue(['', '  ', 'Valid Title']);
    expect(result).to.equal('valid title');
  });

  it('should handle array with null/undefined elements', () => {
    const result = normalizeTagValue([null, undefined, '403 Forbidden']);
    expect(result).to.equal('403 forbidden');
  });

  it('should return empty string for null', () => {
    const result = normalizeTagValue(null);
    expect(result).to.equal('');
  });

  it('should return empty string for undefined', () => {
    const result = normalizeTagValue(undefined);
    expect(result).to.equal('');
  });

  it('should return empty string for empty array', () => {
    const result = normalizeTagValue([]);
    expect(result).to.equal('');
  });

  it('should return empty string for array with only empty strings', () => {
    const result = normalizeTagValue(['', '  ', '']);
    expect(result).to.equal('');
  });

  it('should return empty string for non-string value', () => {
    const result = normalizeTagValue(123);
    expect(result).to.equal('');
  });

  it('should return empty string for boolean value', () => {
    const result = normalizeTagValue(true);
    expect(result).to.equal('');
  });

  it('should preserve original case when toLowerCase is false', () => {
    const result = normalizeTagValue('Error Page', false);
    expect(result).to.equal('Error Page');
  });

  it('should preserve original case for array when toLowerCase is false', () => {
    const result = normalizeTagValue(['Error Page'], false);
    expect(result).to.equal('Error Page');
  });

  it('should handle real-world error page title', () => {
    // Real CloudFront 403 example
    const result = normalizeTagValue('403 ERROR - Amazon S3');
    expect(result).to.equal('403 error - amazon s3');
  });

  it('should handle h1 array from scraper', () => {
    // Real scraper format for h1
    const result = normalizeTagValue(['404 Not Found', 'Error']);
    expect(result).to.equal('404 not found');
  });
});

// Minimal tests for getIssueRanking to cover uncovered edge cases
// (Most of getIssueRanking is already tested through integration tests)
describe('getIssueRanking - edge cases', () => {
  it('should return -1 for empty tagName', () => {
    expect(getIssueRanking('', 'Missing Title')).to.equal(-1);
  });

  it('should return -1 for null tagName', () => {
    expect(getIssueRanking(null, 'Missing Title')).to.equal(-1);
  });

  it('should return -1 for empty issue', () => {
    expect(getIssueRanking('title', '')).to.equal(-1);
  });

  it('should return -1 for null issue', () => {
    expect(getIssueRanking('title', null)).to.equal(-1);
  });

  it('should return -1 for unknown tagName', () => {
    expect(getIssueRanking('unknown-tag', 'Missing Something')).to.equal(-1);
  });

  it('should return correct rank for known issue', () => {
    // Cover the positive path through the function
    expect(getIssueRanking('title', 'Missing Title')).to.equal(1);
  });

  it('should return -1 for unknown issue word', () => {
    // Cover the loop that doesn't find a match (line 100)
    expect(getIssueRanking('title', 'Something Random')).to.equal(-1);
  });
});

describe('extractHreflangLinks', () => {
  it('should extract hreflang links from HTML head', () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" hreflang="en" href="https://example.com/en">
          <link rel="alternate" hreflang="fr" href="https://example.com/fr">
          <link rel="alternate" hreflang="x-default" href="https://example.com/">
        </head>
      </html>
    `;
    const $ = cheerioLoad(html);
    const links = extractHreflangLinks($, 'https://example.com/en');

    expect(links).to.have.lengthOf(3);
    expect(links[0]).to.deep.equal({
      hreflang: 'en',
      href: 'https://example.com/en',
      isInHead: true,
    });
    expect(links[1]).to.deep.equal({
      hreflang: 'fr',
      href: 'https://example.com/fr',
      isInHead: true,
    });
    expect(links[2]).to.deep.equal({
      hreflang: 'x-default',
      href: 'https://example.com/',
      isInHead: true,
    });
  });

  it('should detect hreflang links outside head section', () => {
    const html = `
      <html>
        <head></head>
        <body>
          <link rel="alternate" hreflang="en" href="https://example.com/en">
        </body>
      </html>
    `;
    const $ = cheerioLoad(html);
    const links = extractHreflangLinks($, 'https://example.com/en');

    expect(links).to.have.lengthOf(1);
    expect(links[0].isInHead).to.be.false;
  });

  it('should resolve relative URLs to absolute', () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" hreflang="en" href="/en">
          <link rel="alternate" hreflang="fr" href="/fr">
        </head>
      </html>
    `;
    const $ = cheerioLoad(html);
    const links = extractHreflangLinks($, 'https://example.com/page');

    expect(links).to.have.lengthOf(2);
    expect(links[0].href).to.equal('https://example.com/en');
    expect(links[1].href).to.equal('https://example.com/fr');
  });

  it('should handle invalid URLs gracefully', () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" hreflang="en" href="invalid-url">
        </head>
      </html>
    `;
    const $ = cheerioLoad(html);
    const links = extractHreflangLinks($, 'https://example.com/en');

    expect(links).to.have.lengthOf(1);
    // Relative URLs are resolved to absolute URLs
    expect(links[0].href).to.equal('https://example.com/invalid-url');
  });

  it('should skip links without hreflang or href attributes', () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" hreflang="en">
          <link rel="alternate" href="https://example.com/fr">
          <link rel="alternate" hreflang="de" href="https://example.com/de">
        </head>
      </html>
    `;
    const $ = cheerioLoad(html);
    const links = extractHreflangLinks($, 'https://example.com/en');

    expect(links).to.have.lengthOf(1);
    expect(links[0].hreflang).to.equal('de');
  });

  it('should return empty array when no hreflang links exist', () => {
    const html = '<html><head></head></html>';
    const $ = cheerioLoad(html);
    const links = extractHreflangLinks($, 'https://example.com/en');

    expect(links).to.be.an('array').that.is.empty;
  });

  it('should handle complex hreflang values (language-region)', () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" hreflang="en-US" href="https://example.com/en-us">
          <link rel="alternate" hreflang="en-GB" href="https://example.com/en-gb">
          <link rel="alternate" hreflang="fr-CA" href="https://example.com/fr-ca">
        </head>
      </html>
    `;
    const $ = cheerioLoad(html);
    const links = extractHreflangLinks($, 'https://example.com/en-us');

    expect(links).to.have.lengthOf(3);
    expect(links[0].hreflang).to.equal('en-US');
    expect(links[1].hreflang).to.equal('en-GB');
    expect(links[2].hreflang).to.equal('fr-CA');
  });

  it('should handle URL construction failures gracefully', () => {
    // Test with invalid sourceUrl that causes URL constructor to fail
    const html = `
      <html>
        <head>
          <link rel="alternate" hreflang="en" href="/en">
          <link rel="alternate" hreflang="fr" href="/fr">
        </head>
      </html>
    `;
    const $ = cheerioLoad(html);

    // Using an invalid sourceUrl should trigger the catch block
    const links = extractHreflangLinks($, 'not-a-valid-base-url');

    // Should not throw, and should keep original hrefs when URL construction fails
    expect(links).to.have.lengthOf(2);
    expect(links[0].href).to.equal('/en');
    expect(links[1].href).to.equal('/fr');
  });
});

describe('hasReciprocalLink', () => {
  it('should return true when reciprocal link exists', () => {
    const hreflangLinks = [
      { hreflang: 'en', href: 'https://example.com/en' },
      { hreflang: 'fr', href: 'https://example.com/fr' },
    ];

    const result = hasReciprocalLink('https://example.com/en', 'en', hreflangLinks);
    expect(result).to.be.true;
  });

  it('should return false when reciprocal link does not exist', () => {
    const hreflangLinks = [
      { hreflang: 'fr', href: 'https://example.com/fr' },
      { hreflang: 'de', href: 'https://example.com/de' },
    ];

    const result = hasReciprocalLink('https://example.com/en', 'en', hreflangLinks);
    expect(result).to.be.false;
  });

  it('should return false when hreflang value does not match', () => {
    const hreflangLinks = [
      { hreflang: 'fr', href: 'https://example.com/en' },
    ];

    const result = hasReciprocalLink('https://example.com/en', 'en', hreflangLinks);
    expect(result).to.be.false;
  });

  it('should normalize URLs for comparison (remove trailing slash)', () => {
    const hreflangLinks = [
      { hreflang: 'en', href: 'https://example.com/en/' },
    ];

    const result = hasReciprocalLink('https://example.com/en', 'en', hreflangLinks);
    expect(result).to.be.true;
  });

  it('should handle URLs with query parameters', () => {
    const hreflangLinks = [
      { hreflang: 'en', href: 'https://example.com/en?page=1' },
    ];

    const result = hasReciprocalLink('https://example.com/en?page=1', 'en', hreflangLinks);
    expect(result).to.be.true;
  });

  it('should return false for null/undefined inputs', () => {
    expect(hasReciprocalLink(null, 'en', [])).to.be.false;
    expect(hasReciprocalLink('https://example.com/en', null, [])).to.be.false;
    expect(hasReciprocalLink('https://example.com/en', 'en', null)).to.be.false;
  });

  it('should return false for empty array', () => {
    const result = hasReciprocalLink('https://example.com/en', 'en', []);
    expect(result).to.be.false;
  });

  it('should handle invalid URLs gracefully', () => {
    const hreflangLinks = [
      { hreflang: 'en', href: 'invalid-url' },
    ];

    const result = hasReciprocalLink('https://example.com/en', 'en', hreflangLinks);
    expect(result).to.be.false;
  });
});

describe('buildExpectedHreflangSet', () => {
  it('should build expected hreflang set for all alternate pages', () => {
    const sourceUrl = 'https://example.com/en';
    const sourceLinks = [
      { hreflang: 'en', href: 'https://example.com/en' },
      { hreflang: 'fr', href: 'https://example.com/fr' },
      { hreflang: 'de', href: 'https://example.com/de' },
    ];

    const expectedSet = buildExpectedHreflangSet(sourceUrl, sourceLinks);

    expect(expectedSet).to.be.a('map');
    expect(expectedSet.size).to.equal(3);

    // Each page should expect all three hreflang values
    expect([...expectedSet.get('https://example.com/en')]).to.have.members(['en', 'fr', 'de']);
    expect([...expectedSet.get('https://example.com/fr')]).to.have.members(['en', 'fr', 'de']);
    expect([...expectedSet.get('https://example.com/de')]).to.have.members(['en', 'fr', 'de']);
  });

  it('should handle x-default hreflang', () => {
    const sourceUrl = 'https://example.com/en';
    const sourceLinks = [
      { hreflang: 'en', href: 'https://example.com/en' },
      { hreflang: 'fr', href: 'https://example.com/fr' },
      { hreflang: 'x-default', href: 'https://example.com/en' },
    ];

    const expectedSet = buildExpectedHreflangSet(sourceUrl, sourceLinks);

    expect(expectedSet.size).to.equal(2); // en and fr (x-default points to en)
    expect([...expectedSet.get('https://example.com/en')]).to.have.members(['en', 'fr', 'x-default']);
  });

  it('should return empty map when source links is empty', () => {
    const expectedSet = buildExpectedHreflangSet('https://example.com/en', []);
    expect(expectedSet).to.be.a('map');
    expect(expectedSet.size).to.equal(0);
  });

  it('should handle URLs with different paths correctly', () => {
    const sourceUrl = 'https://example.com/products/item1';
    const sourceLinks = [
      { hreflang: 'en', href: 'https://example.com/products/item1' },
      { hreflang: 'fr', href: 'https://example.com/fr/produits/item1' },
    ];

    const expectedSet = buildExpectedHreflangSet(sourceUrl, sourceLinks);

    expect(expectedSet.size).to.equal(2);
    expect([...expectedSet.get('https://example.com/products/item1')]).to.have.members(['en', 'fr']);
    expect([...expectedSet.get('https://example.com/fr/produits/item1')]).to.have.members(['en', 'fr']);
  });

  it('should handle complex language-region codes', () => {
    const sourceUrl = 'https://example.com/en-us';
    const sourceLinks = [
      { hreflang: 'en-US', href: 'https://example.com/en-us' },
      { hreflang: 'en-GB', href: 'https://example.com/en-gb' },
      { hreflang: 'fr-CA', href: 'https://example.com/fr-ca' },
    ];

    const expectedSet = buildExpectedHreflangSet(sourceUrl, sourceLinks);

    expect(expectedSet.size).to.equal(3);
    expect([...expectedSet.get('https://example.com/en-us')]).to.have.members(['en-US', 'en-GB', 'fr-CA']);
  });
});
