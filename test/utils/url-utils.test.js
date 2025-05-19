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
import { isPreviewPage } from '../../src/utils/url-utils.js';

describe('isPreviewPage', () => {
  it('should return true for preview pages', () => {
    const url = 'https://www.example.page/test1';
    const result = isPreviewPage(url);
    expect(result).to.be.true;
  });

  it('should return false for non-preview pages', () => {
    const url = 'https://www.example.com/test1';
    const result = isPreviewPage(url);
    expect(result).to.be.false;
  });
});
