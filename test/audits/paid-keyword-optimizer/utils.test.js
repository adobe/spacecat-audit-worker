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
import { normalizeUrl } from '../../../src/paid-keyword-optimizer/utils.js';

describe('paid-keyword-optimizer utils — normalizeUrl', () => {
  it('strips the www. prefix from the hostname', () => {
    expect(normalizeUrl('https://www.example.com/page')).to.equal('https://example.com/page');
  });

  it('is idempotent on an already-normalized URL', () => {
    expect(normalizeUrl('https://example.com/page')).to.equal('https://example.com/page');
  });

  it('returns the input unchanged when it is not a parseable URL', () => {
    expect(normalizeUrl('not a url')).to.equal('not a url');
  });

  it('preserves port, query, and fragment while stripping www.', () => {
    expect(normalizeUrl('https://www.example.com:8080/path?q=1#hash'))
      .to.equal('https://example.com:8080/path?q=1#hash');
  });
});
