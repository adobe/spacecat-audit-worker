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
import { trimTagValue, getIssueRanking } from '../../src/utils/seo-utils.js';

describe('trimTagValue', () => {
  it('should trim leading and trailing whitespace from string', () => {
    const result = trimTagValue('   Hello World   ');
    expect(result).to.equal('Hello World');
  });

  it('should trim whitespace from array of strings', () => {
    const result = trimTagValue(['  title  ', '  h1  ']);
    expect(result).to.deep.equal(['title', 'h1']);
  });

  it('should handle array with non-string items', () => {
    // This covers the branch: typeof item === 'string' ? trim : item
    const result = trimTagValue(['  text  ', 123, null]);
    expect(result).to.deep.equal(['text', 123, null]);
  });

  it('should return null/undefined/empty values unchanged', () => {
    expect(trimTagValue(null)).to.be.null;
    expect(trimTagValue(undefined)).to.be.undefined;
    expect(trimTagValue('')).to.equal('');
  });

  it('should return non-string, non-array values unchanged', () => {
    // This covers the branch: typeof value === 'string' ? trim : value
    expect(trimTagValue(123)).to.equal(123);
    expect(trimTagValue(true)).to.equal(true);
  });

  it('should trim real-world example with excessive whitespace', () => {
    // Real example from Okta "IP Spoofing" page
    const result = trimTagValue('                    What Is Federated Identity?                    ');
    expect(result).to.equal('What Is Federated Identity?');
  });
});

// Minimal tests for getIssueRanking to cover uncovered edge cases
// (Most of getIssueRanking is already tested through integration tests)
describe('getIssueRanking - edge cases', () => {
  it('should return -1 for empty tagName', () => {
    expect(getIssueRanking('', 'Missing Title')).to.equal(-1);
  });

  it('should return -1 for null tagName', () => {
    expect(getIssueRanking(null, 'Missing Title')).to.equal(-1);
  });

  it('should return -1 for empty issue', () => {
    expect(getIssueRanking('title', '')).to.equal(-1);
  });

  it('should return -1 for null issue', () => {
    expect(getIssueRanking('title', null)).to.equal(-1);
  });

  it('should return -1 for unknown tagName', () => {
    expect(getIssueRanking('unknown-tag', 'Missing Something')).to.equal(-1);
  });

  it('should return correct rank for known issue', () => {
    // Cover the positive path through the function
    expect(getIssueRanking('title', 'Missing Title')).to.equal(1);
  });

  it('should return -1 for unknown issue word', () => {
    // Cover the loop that doesn't find a match (line 100)
    expect(getIssueRanking('title', 'Something Random')).to.equal(-1);
  });
});
