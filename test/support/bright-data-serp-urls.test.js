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
import { pickUrlsFromSerpResults } from '../../src/support/bright-data-serp-urls.js';

describe('pickUrlsFromSerpResults', () => {
  it('returns empty array when results is not an array', () => {
    expect(pickUrlsFromSerpResults(undefined, 'https://example.com/x')).to.deep.equal([]);
    expect(pickUrlsFromSerpResults({}, 'https://example.com/x')).to.deep.equal([]);
  });

  it('treats non-positive integer maxUrls as default cap', () => {
    const results = [{ link: 'https://example.com/a' }];
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x', { maxUrls: 0 })).to.deep.equal(['https://example.com/a']);
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x', { maxUrls: -1 })).to.deep.equal(['https://example.com/a']);
  });

  it('ignores organic rows without link', () => {
    const results = [
      {},
      { link: null },
      { link: '' },
      { link: 'https://example.com/ok' },
    ];
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x')).to.deep.equal(['https://example.com/ok']);
  });

  it('uses default cap of 5 when maxUrls is missing or not a positive integer', () => {
    const results = Array.from({ length: 8 }, (_, i) => ({ link: `https://example.com/p${i}` }));
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x')).to.have.lengthOf(5);
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x', { maxUrls: 3.7 })).to.have.lengthOf(5);
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x', {})).to.have.lengthOf(5);
  });

  it('dedupes duplicate URLs in the non-locale-matched bucket', () => {
    const results = [
      { link: 'https://example.com/fr/page' },
      { link: 'https://example.com/fr/page' },
    ];
    expect(pickUrlsFromSerpResults(results, 'https://example.com/dk/old')).to.deep.equal([
      'https://example.com/fr/page',
    ]);
  });

  it('returns multiple non-file URLs in SERP order with locale matches first', () => {
    const results = [
      { link: 'https://example.com/dk/brochure.pdf' },
      { link: 'https://example.com/dk/page-a' },
      { link: 'https://example.com/dk/page-b' },
      { link: 'https://example.com/us/page' },
    ];
    const picked = pickUrlsFromSerpResults(results, 'https://example.com/dk/old');
    expect(picked).to.deep.equal([
      'https://example.com/dk/page-a',
      'https://example.com/dk/page-b',
      'https://example.com/us/page',
    ]);
  });

  it('skips all-PDF results', () => {
    const results = [
      { link: 'https://example.com/a.pdf' },
      { link: 'https://example.com/b.pdf' },
    ];
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x')).to.deep.equal([]);
  });

  it('respects maxUrls', () => {
    const results = [
      { link: 'https://example.com/1' },
      { link: 'https://example.com/2' },
      { link: 'https://example.com/3' },
    ];
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x', { maxUrls: 2 }))
      .to.deep.equal(['https://example.com/1', 'https://example.com/2']);
  });

  it('dedupes by case-insensitive URL', () => {
    const results = [
      { link: 'https://example.com/Same' },
      { link: 'https://example.com/same' },
    ];
    expect(pickUrlsFromSerpResults(results, 'https://example.com/x')).to.deep.equal(['https://example.com/Same']);
  });
});
