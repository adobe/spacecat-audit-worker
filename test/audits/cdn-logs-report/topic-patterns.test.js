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

  it('extracts topics from adobe.com URLs with multiple patterns', () => {
    const patterns = TOPIC_PATTERNS['adobe.com'];
    const testUrls = [
      '/products/photoshop.html',
      '/products/illustrator.html',
      '/express/business',
      '/creativecloud/',
      '/not-matching/',
    ];

    const productPattern = patterns.find((p) => p.name === 'Individual Creative Applications');
    const productRegex = new RegExp(productPattern.regex);
    expect(productRegex.test(testUrls[0])).to.be.true;
    expect(productRegex.test(testUrls[1])).to.be.true;

    const expressPattern = patterns.find((p) => p.name === 'Express Creative Tools');
    const expressRegex = new RegExp(expressPattern.regex);
    expect(expressRegex.test(testUrls[2])).to.be.true;

    const ccPattern = patterns.find((p) => p.name === 'Creative Cloud Suite');
    const ccRegex = new RegExp(ccPattern.regex);
    expect(ccRegex.test(testUrls[3])).to.be.true;

    const anyMatch = patterns.some((p) => new RegExp(p.regex).test(testUrls[4]));
    expect(anyMatch).to.be.false;
  });

  it('handles unknown domains gracefully', () => {
    expect(TOPIC_PATTERNS['unknown-domain.com']).to.be.undefined;
  });
});
