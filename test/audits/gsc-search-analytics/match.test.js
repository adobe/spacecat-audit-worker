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
import { normalizeUrl, indexRows, lookup } from '../../../src/gsc-search-analytics/match.js';

describe('match', () => {
  it('normalizes trailing slash and host case', () => {
    expect(normalizeUrl('https://KrisShop.com/products/x/')).to.equal('https://krisshop.com/products/x');
  });

  it('keeps the root path as "/"', () => {
    expect(normalizeUrl('https://krisshop.com/')).to.equal('https://krisshop.com/');
  });

  it('returns the input unchanged when it is not a valid URL', () => {
    expect(normalizeUrl('not a url')).to.equal('not a url');
  });

  it('indexes rows and looks a url up regardless of trailing slash', () => {
    const map = indexRows([
      { keys: ['https://krisshop.com/products/x'], clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
      { keys: [], clicks: 1, impressions: 1 }, // missing key -> tolerated
      { keys: ['https://krisshop.com/z'] }, // no metric fields -> default to 0
    ]);
    expect(lookup(map, 'https://krisshop.com/products/x/')).to.include({ clicks: 5 });
    expect(lookup(map, 'https://krisshop.com/z')).to.deep.equal({
      clicks: 0, impressions: 0, ctr: 0, position: 0,
    });
    expect(lookup(map, 'https://krisshop.com/missing')).to.equal(null);
  });
});
