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
import { trimTagValue, normalizeTagValue, getIssueRanking } from '../../src/utils/seo-utils.js';

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

describe('normalizeTagValue', () => {
  it('should convert string to lowercase', () => {
    const result = normalizeTagValue('Error Page');
    expect(result).to.equal('error page');
  });

  it('should handle string with mixed case', () => {
    const result = normalizeTagValue('404 Not Found');
    expect(result).to.equal('404 not found');
  });

  it('should take first non-empty value from array', () => {
    const result = normalizeTagValue(['Error Page', 'Another Title']);
    expect(result).to.equal('error page');
  });

  it('should skip empty strings in array', () => {
    const result = normalizeTagValue(['', '  ', 'Valid Title']);
    expect(result).to.equal('valid title');
  });

  it('should handle array with null/undefined elements', () => {
    const result = normalizeTagValue([null, undefined, '403 Forbidden']);
    expect(result).to.equal('403 forbidden');
  });

  it('should return empty string for null', () => {
    const result = normalizeTagValue(null);
    expect(result).to.equal('');
  });

  it('should return empty string for undefined', () => {
    const result = normalizeTagValue(undefined);
    expect(result).to.equal('');
  });

  it('should return empty string for empty array', () => {
    const result = normalizeTagValue([]);
    expect(result).to.equal('');
  });

  it('should return empty string for array with only empty strings', () => {
    const result = normalizeTagValue(['', '  ', '']);
    expect(result).to.equal('');
  });

  it('should return empty string for non-string value', () => {
    const result = normalizeTagValue(123);
    expect(result).to.equal('');
  });

  it('should return empty string for boolean value', () => {
    const result = normalizeTagValue(true);
    expect(result).to.equal('');
  });

  it('should preserve original case when toLowerCase is false', () => {
    const result = normalizeTagValue('Error Page', false);
    expect(result).to.equal('Error Page');
  });

  it('should preserve original case for array when toLowerCase is false', () => {
    const result = normalizeTagValue(['Error Page'], false);
    expect(result).to.equal('Error Page');
  });

  it('should handle real-world error page title', () => {
    // Real CloudFront 403 example
    const result = normalizeTagValue('403 ERROR - Amazon S3');
    expect(result).to.equal('403 error - amazon s3');
  });

  it('should handle h1 array from scraper', () => {
    // Real scraper format for h1
    const result = normalizeTagValue(['404 Not Found', 'Error']);
    expect(result).to.equal('404 not found');
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
