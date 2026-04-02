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

/* eslint-env mocha */

import { expect } from 'chai';
import {
  normalizeForScore,
  pathSegmentsForScore,
  scoreSuggestion,
} from '../../src/support/suggestion-score.js';

describe('normalizeForScore', () => {
  it('returns empty pair for falsy input', () => {
    expect(normalizeForScore('')).to.deep.equal(['', '']);
    expect(normalizeForScore(null)).to.deep.equal(['', '']);
    expect(normalizeForScore(undefined)).to.deep.equal(['', '']);
  });

  it('strips www and lowercases host', () => {
    const [host] = normalizeForScore('https://WWW.Example.COM/path');
    expect(host).to.equal('example.com');
  });

  it('strips trailing slashes from path', () => {
    const [, path] = normalizeForScore('https://example.com/blog/post/');
    expect(path).to.equal('/blog/post');
  });

  it('lowercases path', () => {
    const [, path] = normalizeForScore('https://example.com/Blog/POST');
    expect(path).to.equal('/blog/post');
  });

  it('prepends https when schema is missing', () => {
    const [host, path] = normalizeForScore('example.com/page');
    expect(host).to.equal('example.com');
    expect(path).to.equal('/page');
  });

  it('returns empty pair for unparseable input', () => {
    expect(normalizeForScore('://broken')).to.deep.equal(['', '']);
  });
});

describe('pathSegmentsForScore', () => {
  it('splits path into non-empty segments', () => {
    expect(pathSegmentsForScore('/a/b/c')).to.deep.equal(['a', 'b', 'c']);
  });

  it('returns empty array for root path', () => {
    expect(pathSegmentsForScore('/')).to.deep.equal([]);
    expect(pathSegmentsForScore('')).to.deep.equal([]);
  });
});

describe('scoreSuggestion', () => {
  // --- score 0: filtered out ---

  it('returns 0 for empty/null inputs', () => {
    expect(scoreSuggestion('', 'https://a.com/x').score).to.equal(0);
    expect(scoreSuggestion('https://a.com/x', '').score).to.equal(0);
    expect(scoreSuggestion(null, null).score).to.equal(0);
    expect(scoreSuggestion(undefined, 'https://a.com/x').score).to.equal(0);
  });

  it('returns 0 for wrong domain', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/page',
      'https://other.com/page',
    );
    expect(score).to.equal(0);
    expect(reason).to.include('wrong domain');
  });

  it('returns 0 for homepage fallback', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/blog/post',
      'https://example.com/',
    );
    expect(score).to.equal(0);
    expect(reason).to.include('homepage');
  });

  it('returns 0 for homepage without trailing slash', () => {
    const { score } = scoreSuggestion(
      'https://example.com/blog/post',
      'https://example.com',
    );
    expect(score).to.equal(0);
  });

  it('returns 0 for completely unrelated paths', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/blog/advanced-seo-guide',
      'https://example.com/careers/apply',
    );
    expect(score).to.equal(0);
    expect(reason).to.equal('unrelated');
  });

  // --- score 1.0: exact path match ---

  it('returns 1.0 for exact path match', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/blog/my-post',
      'https://example.com/blog/my-post',
    );
    expect(score).to.equal(1.0);
    expect(reason).to.equal('exact path match');
  });

  it('returns 1.0 for exact match ignoring trailing slash and case', () => {
    const { score } = scoreSuggestion(
      'https://Example.COM/Blog/Post/',
      'https://example.com/blog/post',
    );
    expect(score).to.equal(1.0);
  });

  it('returns 1.0 for exact match with www difference', () => {
    const { score } = scoreSuggestion(
      'https://www.example.com/page',
      'https://example.com/page',
    );
    expect(score).to.equal(1.0);
  });

  // --- score 0.95: slug correction ---

  it('returns 0.95 for slug correction (dash vs underscore)', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/blog/my-post',
      'https://example.com/blog/my_post',
    );
    expect(score).to.equal(0.95);
    expect(reason).to.equal('slug correction');
  });

  // --- strong path match (prefix >= 2 && overlap >= 0.4) ---

  it('scores high for strong path match with shared prefix', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/products/widgets/blue-widget',
      'https://example.com/products/widgets/blue-widget-v2',
    );
    expect(score).to.be.greaterThan(0.7);
    expect(reason).to.include('strong path match');
  });

  // --- structural match (common >= 2 && overlap >= 0.35) ---

  it('scores for structural match with shared segments in different order', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/resources/guides/seo-tips',
      'https://example.com/guides/resources/seo-tips-updated',
    );
    expect(score).to.be.greaterThan(0.6);
    expect(reason).to.include('structural match');
  });

  // --- same section + decent overlap ---

  it('scores for same section with keyword overlap', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/blog/advanced-seo-techniques',
      'https://example.com/blog/seo-strategies-for-beginners',
    );
    expect(score).to.be.greaterThan(0.3);
    expect(reason).to.include('section');
  });

  // --- keyword overlap without section match ---

  it('scores for keyword overlap across different sections', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/resources/marketing-automation-guide',
      'https://example.com/blog/marketing-automation-tips',
    );
    expect(score).to.be.greaterThan(0.3);
    expect(reason).to.include('overlap');
  });

  // --- same section weak overlap ---

  it('scores for same section with weak overlap', () => {
    const { score, reason } = scoreSuggestion(
      'https://example.com/docs/getting-started',
      'https://example.com/docs/api-reference-started',
    );
    expect(score).to.be.greaterThan(0.2);
    expect(reason).to.include('section');
  });

  // --- ordering guarantees ---

  it('exact match scores higher than slug correction', () => {
    const exact = scoreSuggestion(
      'https://example.com/blog/post',
      'https://example.com/blog/post',
    );
    const slug = scoreSuggestion(
      'https://example.com/blog/post',
      'https://example.com/blog/post',
    );
    expect(exact.score).to.be.greaterThanOrEqual(slug.score);
  });

  it('strong path match scores higher than weak section overlap', () => {
    const strong = scoreSuggestion(
      'https://example.com/products/widgets/blue',
      'https://example.com/products/widgets/blue-pro',
    );
    const weak = scoreSuggestion(
      'https://example.com/products/widgets/blue',
      'https://example.com/products/something-else',
    );
    expect(strong.score).to.be.greaterThan(weak.score);
  });

  it('any scored result beats an unrelated result', () => {
    const related = scoreSuggestion(
      'https://example.com/blog/seo-guide',
      'https://example.com/blog/seo-tips',
    );
    const unrelated = scoreSuggestion(
      'https://example.com/blog/seo-guide',
      'https://example.com/careers/apply',
    );
    expect(related.score).to.be.greaterThan(0);
    expect(unrelated.score).to.equal(0);
  });

  // --- edge cases ---

  it('handles URLs without schema', () => {
    const { score } = scoreSuggestion(
      'example.com/blog/post',
      'example.com/blog/post',
    );
    expect(score).to.equal(1.0);
  });

  it('handles single-segment paths', () => {
    const { score } = scoreSuggestion(
      'https://example.com/contact',
      'https://example.com/about',
    );
    expect(score).to.equal(0);
  });

  it('handles locale-prefixed paths', () => {
    const { score } = scoreSuggestion(
      'https://example.com/dk/produkter/widget',
      'https://example.com/dk/produkter/widget-ny',
    );
    expect(score).to.be.greaterThan(0.7);
  });

  it('returns 0 when suggested URL is on a different subdomain', () => {
    const { score } = scoreSuggestion(
      'https://shop.example.com/product',
      'https://blog.example.com/product',
    );
    expect(score).to.equal(0);
  });
});
