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

describe('Topic Patterns', () => {
  let TOPIC_PATTERNS;

  before(async () => {
    ({ TOPIC_PATTERNS } = await import('../../../src/cdn-logs-report/constants/topic-patterns.js'));
  });

  it('extracts topics from bulk.com product URLs', () => {
    const pattern = TOPIC_PATTERNS['bulk.com'][0];
    const testUrls = [
      '/products/pure-whey-protein/',
      '/products/creatine-monohydrate/',
      '/en/products/protein-powder/',
      '/not-a-product/',
    ];

    const regex = new RegExp(pattern.regex);
    expect(regex.exec(testUrls[0])?.[1]).to.equal('pure-whey-protein');
    expect(regex.exec(testUrls[1])?.[1]).to.equal('creatine-monohydrate');
    expect(regex.exec(testUrls[2])?.[1]).to.equal('protein-powder');
    expect(regex.exec(testUrls[3])?.[1]).to.be.undefined;
  });

  it('tests adobe.com URL patterns', () => {
    // note: this patterns are designed for SQL, may behave differently in JS
    const patterns = TOPIC_PATTERNS['adobe.com'];
    const testUrls = [
      '/acrobat/',
      '/acrobat.html',
      '/products/acrobat/',
      '/products/firefly/',
      '/ai/generative-firefly/',
      '/not-matching/',
    ];

    const acrobatPattern = patterns.find((p) => p.name === 'Acrobat');
    const acrobatRegex = new RegExp(acrobatPattern.regex);
    expect(acrobatPattern.regex).to.include('acrobat');
    expect(acrobatRegex.test(testUrls[0])).to.be.true;
    expect(acrobatRegex.test(testUrls[1])).to.be.true;
    expect(acrobatRegex.test(testUrls[2])).to.be.true;

    const fireflyPattern = patterns.find((p) => p.name === 'Firefly');
    const fireflyRegex = new RegExp(fireflyPattern.regex);
    expect(fireflyPattern.regex).to.include('firefly');
    expect(fireflyRegex.test(testUrls[3])).to.be.true;
    expect(fireflyRegex.test(testUrls[4])).to.be.true;

    const anyMatch = patterns.some((p) => new RegExp(p.regex).test(testUrls[5]));
    expect(anyMatch).to.be.false;
  });

  it('tests business.adobe.com URL patterns', () => {
    const patterns = TOPIC_PATTERNS['business.adobe.com'];
    const testUrls = [
      '/products/',
      '/products/analytics/',
      '/not-matching/',
    ];

    const enterprisePattern = patterns.find((p) => p.name === 'Enterprise Products');
    const enterpriseRegex = new RegExp(enterprisePattern.regex);
    expect(enterprisePattern.regex).to.include('products');
    expect(enterpriseRegex.test(testUrls[0])).to.be.true;
    expect(enterpriseRegex.test(testUrls[1])).to.be.true;
    expect(enterpriseRegex.test(testUrls[2])).to.be.false;
  });

  it('handles unknown domains gracefully', () => {
    expect(TOPIC_PATTERNS['unknown-domain.com']).to.be.undefined;
  });
});
