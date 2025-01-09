/*
 * Copyright 2024 Adobe. All rights reserved.
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

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import {
  getBaseUrlPagesFromSitemapContents,
  getUrlWithoutPath,
} from '../../src/support/utils.js';

use(sinonChai);
use(chaiAsPromised);

describe('getUrlWithoutPath', () => {
  it('returns the URL without the path from a URL with a path', () => {
    const url = 'https://www.example.com/path/to/resource';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });

  it('returns the same URL from a URL without a path', () => {
    const url = 'https://www.example.com';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });

  it('returns the URL without the path from a URL with a path and query parameters', () => {
    const url = 'https://www.example.com/path/to/resource?param=value';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });

  it('returns the URL without the path from a URL with a path and a fragment', () => {
    const url = 'https://www.example.com/path/to/resource#fragment';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });
});

describe('getBaseUrlPagesFromSitemapContents', () => {
  it('should return an empty array when the sitemap content is empty', () => {
    const result = getBaseUrlPagesFromSitemapContents('https://my-site.adbe', undefined);
    expect(result).to.deep.equal([]);
  });
});
