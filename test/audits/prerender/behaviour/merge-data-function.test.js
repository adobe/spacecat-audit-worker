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

/**
 * Regression: buildMergeDataFunction handles individual and domain-wide merges correctly.
 *
 * The merge logic existed inline in the old handler and was extracted + exported as
 * buildMergeDataFunction in the path-level-suggestions PR. These tests pin the
 * pre-existing invariants.
 */

import { expect } from 'chai';
import { buildMergeDataFunction } from '../../../../src/prerender/handler.js';

const BASE_URL = 'https://example.com';

describe('buildMergeDataFunction — regression invariants', () => {
  const mapSuggestionData = (s) => ({
    url: s.url,
    contentGainRatio: s.contentGainRatio,
    wordCountBefore: s.wordCountBefore,
    wordCountAfter: s.wordCountAfter,
  });
  const mergeData = buildMergeDataFunction(mapSuggestionData);

  it('individual suggestion: overlays existing data with mapped new fields', () => {
    const existing = { url: `${BASE_URL}/page1`, aiSummary: 'old summary', valuable: true };
    const newItem = {
      url: `${BASE_URL}/page1`, contentGainRatio: 3.0, wordCountBefore: 50, wordCountAfter: 150,
    };

    const result = mergeData(existing, newItem);

    expect(result.aiSummary).to.equal('old summary');
    expect(result.valuable).to.equal(true);
    expect(result.contentGainRatio).to.equal(3.0);
    expect(result.wordCountBefore).to.equal(50);
    expect(result.wordCountAfter).to.equal(150);
  });

  it('individual suggestion: new mapped data overwrites conflicting existing fields', () => {
    const existing = {
      url: `${BASE_URL}/page1`, contentGainRatio: 1.5, wordCountBefore: 30,
    };
    const newItem = {
      url: `${BASE_URL}/page1`, contentGainRatio: 4.0, wordCountBefore: 80, wordCountAfter: 320,
    };

    const result = mergeData(existing, newItem);

    expect(result.contentGainRatio).to.equal(4.0);
    expect(result.wordCountBefore).to.equal(80);
  });

  it('domain-wide suggestion: replaces data entirely', () => {
    const existing = {
      isDomainWide: true, contentGainRatio: 1.0, wordCountBefore: 100, pathPattern: '/*',
    };
    const newItem = {
      key: 'domain-wide-aggregate|prerender',
      data: {
        isDomainWide: true, contentGainRatio: 5.0, wordCountAfter: 1000, pathPattern: '/*',
      },
    };

    const result = mergeData(existing, newItem);

    expect(result.contentGainRatio).to.equal(5.0);
    expect(result.wordCountAfter).to.equal(1000);
    expect(result).to.not.have.property('wordCountBefore');
  });

  it('domain-wide suggestion: preserves edgeDeployed from existing', () => {
    const existing = {
      isDomainWide: true, edgeDeployed: '2025-06-15T00:00:00Z', contentGainRatio: 1.0,
    };
    const newItem = {
      key: 'domain-wide-aggregate|prerender',
      data: { isDomainWide: true, contentGainRatio: 5.0 },
    };

    const result = mergeData(existing, newItem);

    expect(result.edgeDeployed).to.equal('2025-06-15T00:00:00Z');
    expect(result.contentGainRatio).to.equal(5.0);
  });

  it('domain-wide suggestion: does not inject edgeDeployed when absent from existing', () => {
    const existing = { isDomainWide: true, contentGainRatio: 1.0 };
    const newItem = {
      key: 'domain-wide-aggregate|prerender',
      data: { isDomainWide: true, contentGainRatio: 5.0 },
    };

    const result = mergeData(existing, newItem);

    expect(result).to.not.have.property('edgeDeployed');
  });
});
