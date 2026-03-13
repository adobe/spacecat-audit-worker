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
  filterByStatusIfNeeded,
  filterByItemTypes,
  isCanonicalOrHreflangLink,
} from '../../../src/internal-links/result-utils.js';

describe('internal-links result utils', () => {
  it('filters links by configured status buckets', () => {
    const links = [
      { urlTo: '/a', statusBucket: 'not_found_404' },
      { urlTo: '/b', statusBucket: 'server_error_5xx' },
      { urlTo: '/c', statusBucket: null },
    ];

    expect(filterByStatusIfNeeded(links, ['not_found_404'])).to.deep.equal([
      { urlTo: '/a', statusBucket: 'not_found_404' },
    ]);
  });

  it('filters links by configured item types treating missing itemType as link', () => {
    const links = [
      { urlTo: '/a' },
      { urlTo: '/b', itemType: 'image' },
      { urlTo: '/c', itemType: 'form' },
    ];

    expect(filterByItemTypes(links, ['link', 'form'])).to.deep.equal([
      { urlTo: '/a' },
      { urlTo: '/c', itemType: 'form' },
    ]);
  });

  it('identifies canonical and alternate links for exclusion', () => {
    expect(isCanonicalOrHreflangLink({ itemType: 'canonical' })).to.equal(true);
    expect(isCanonicalOrHreflangLink({ itemType: 'alternate' })).to.equal(true);
    expect(isCanonicalOrHreflangLink({ itemType: 'link' })).to.equal(false);
  });
});
