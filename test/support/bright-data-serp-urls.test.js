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

import { expect } from 'chai';
import { pickUrlsFromSerpResults } from '../../src/support/bright-data-serp-urls.js';

const BROKEN = 'https://example.com/dk/blog/seo-guide';

describe('pickUrlsFromSerpResults', () => {
  it('returns empty array when results is not an array', () => {
    expect(pickUrlsFromSerpResults(undefined, BROKEN)).to.deep.equal([]);
    expect(pickUrlsFromSerpResults({}, BROKEN)).to.deep.equal([]);
  });

  it('returns empty array when results is empty', () => {
    expect(pickUrlsFromSerpResults([], BROKEN)).to.deep.equal([]);
  });

  it('ignores organic rows without link', () => {
    const results = [
      {},
      { link: null },
      { link: '' },
      { link: 'https://example.com/dk/blog/seo-tips' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked).to.deep.equal(['https://example.com/dk/blog/seo-tips']);
  });

  it('skips all-PDF results', () => {
    const results = [
      { link: 'https://example.com/dk/blog/seo-guide.pdf' },
      { link: 'https://example.com/dk/blog/seo-guide.pptx' },
    ];
    expect(pickUrlsFromSerpResults(results, BROKEN)).to.deep.equal([]);
  });

  it('filters out URLs that score 0 (wrong domain, homepage, unrelated)', () => {
    const results = [
      { link: 'https://other.com/dk/blog/seo-guide' },
      { link: 'https://example.com/' },
      { link: 'https://example.com/careers/apply-now' },
    ];
    expect(pickUrlsFromSerpResults(results, BROKEN)).to.deep.equal([]);
  });

  it('dedupes by case-insensitive URL', () => {
    const results = [
      { link: 'https://example.com/dk/blog/SEO-Guide-Updated' },
      { link: 'https://example.com/dk/blog/seo-guide-updated' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked).to.deep.equal(['https://example.com/dk/blog/SEO-Guide-Updated']);
  });

  it('uses default cap of 5', () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      link: `https://example.com/dk/blog/seo-guide-variant-${i}`,
    }));
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked).to.have.lengthOf(5);
  });

  it('treats non-positive integer maxUrls as default cap', () => {
    const results = [{ link: 'https://example.com/dk/blog/seo-tips' }];
    expect(pickUrlsFromSerpResults(results, BROKEN, { maxUrls: 0 })).to.have.lengthOf(1);
    expect(pickUrlsFromSerpResults(results, BROKEN, { maxUrls: -1 })).to.have.lengthOf(1);
    expect(pickUrlsFromSerpResults(results, BROKEN, { maxUrls: 3.7 })).to.have.lengthOf(1);
  });

  it('respects maxUrls', () => {
    const results = [
      { link: 'https://example.com/dk/blog/seo-tips' },
      { link: 'https://example.com/dk/blog/seo-strategies' },
      { link: 'https://example.com/dk/blog/seo-basics' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN, { maxUrls: 2 });
    expect(picked).to.have.lengthOf(2);
  });

  it('places locale-matching URLs before non-matching ones', () => {
    const results = [
      { link: 'https://example.com/fr/blog/seo-guide-updated' },
      { link: 'https://example.com/dk/blog/seo-tips' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked[0]).to.equal('https://example.com/dk/blog/seo-tips');
    expect(picked[1]).to.equal('https://example.com/fr/blog/seo-guide-updated');
  });

  it('sorts by score within the same locale group', () => {
    const results = [
      { link: 'https://example.com/dk/other/seo-stuff' },
      { link: 'https://example.com/dk/blog/seo-guide-updated' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked[0]).to.equal('https://example.com/dk/blog/seo-guide-updated');
    expect(picked[1]).to.equal('https://example.com/dk/other/seo-stuff');
  });

  it('sorts by score within the non-locale group', () => {
    const results = [
      { link: 'https://example.com/fr/resources/seo-guide' },
      { link: 'https://example.com/fr/blog/seo-guide-updated' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked[0]).to.equal('https://example.com/fr/blog/seo-guide-updated');
    expect(picked[1]).to.equal('https://example.com/fr/resources/seo-guide');
  });

  it('combines locale priority and score sorting', () => {
    const results = [
      { link: 'https://example.com/fr/blog/seo-guide-updated' },
      { link: 'https://example.com/dk/resources/seo-guide' },
      { link: 'https://example.com/dk/blog/seo-tips' },
      { link: 'https://example.com/fr/resources/seo-guide' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked[0]).to.include('/dk/');
    expect(picked[1]).to.include('/dk/');
    expect(picked[2]).to.include('/fr/');
    expect(picked[3]).to.include('/fr/');
  });

  it('excludes unscrape-able file types from scored results', () => {
    const results = [
      { link: 'https://example.com/dk/blog/seo-guide.pdf' },
      { link: 'https://example.com/dk/blog/seo-guide.xls' },
      { link: 'https://example.com/dk/blog/seo-tips' },
    ];
    const picked = pickUrlsFromSerpResults(results, BROKEN);
    expect(picked).to.deep.equal(['https://example.com/dk/blog/seo-tips']);
  });
});
