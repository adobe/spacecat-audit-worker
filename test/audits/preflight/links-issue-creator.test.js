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
import { createBrokenLinkIssue } from '../../../src/preflight/links.js';

describe('createBrokenLinkIssue - Lines 86-96 Coverage', () => {
  const baseURLOrigin = 'https://test-site.com';

  describe('line 95 - aiSuggestion with non-empty urlsSuggested', () => {
    it('should set aiSuggestion to first URL when urlsSuggested has items', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        404,
        baseURLOrigin,
        ['https://test-site.com/suggested-page1', 'https://test-site.com/suggested-page2'],
        'Page moved'
      );

      expect(issue.aiSuggestion).to.equal('https://test-site.com/suggested-page1');
      expect(issue.aiRationale).to.equal('Page moved');
    });

    it('should preserve trailing slash for paths (stripTrailingSlash only removes root trailing slash)', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        404,
        baseURLOrigin,
        ['https://test-site.com/suggested-page-with-trailing-slash/'],
        'With trailing slash'
      );

      // stripTrailingSlash only removes trailing slash if path is '/', not for other paths
      expect(issue.aiSuggestion).to.equal('https://test-site.com/suggested-page-with-trailing-slash/');
    });

    it('should replace origin in aiSuggestion URLs', () => {
      const issue = createBrokenLinkIssue(
        'https://preview-site.com/broken-page',
        404,
        'https://production-site.com', // Different baseURLOrigin
        ['https://preview-site.com/suggested-page'],
        'Origin replacement test'
      );

      expect(issue.aiSuggestion).to.equal('https://production-site.com/suggested-page');
    });
  });

  describe('line 89 - aiSuggestion else branch (empty urlsSuggested)', () => {
    it('should set aiSuggestion to undefined when urlsSuggested is empty', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        404,
        baseURLOrigin,
        [],
        'No suggestions'
      );

      expect(issue.aiSuggestion).to.be.undefined;
    });

    it('should set aiSuggestion to undefined when urlsSuggested is undefined', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        404,
        baseURLOrigin,
        undefined,
        'Undefined suggestions'
      );

      expect(issue.aiSuggestion).to.be.undefined;
    });

    it('should set aiSuggestion to undefined when urlsSuggested is null', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        404,
        baseURLOrigin,
        null,
        'Null suggestions'
      );

      expect(issue.aiSuggestion).to.be.undefined;
    });
  });

  describe('complete issue object structure', () => {
    it('should create complete issue object with all fields', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        404,
        baseURLOrigin,
        ['https://test-site.com/suggested-page'],
        'Complete test'
      );

      // Line 91: url field with origin replacement and trailing slash strip
      expect(issue.url).to.equal('https://test-site.com/broken-page');

      // Line 92: issue field with status
      expect(issue.issue).to.equal('Status 404');

      // Line 93: seoImpact field
      expect(issue.seoImpact).to.equal('High');

      // Line 94: seoRecommendation field
      expect(issue.seoRecommendation).to.equal('Fix or remove broken links to improve user experience and SEO');

      // Line 95: aiSuggestion field (ternary operator)
      expect(issue.aiSuggestion).to.equal('https://test-site.com/suggested-page');

      // Line 96: aiRationale field
      expect(issue.aiRationale).to.equal('Complete test');
    });

    it('should handle URL with trailing slash and replace origin', () => {
      const issue = createBrokenLinkIssue(
        'https://preview-site.com/broken-page/',
        404,
        'https://test-site.com',
        ['https://preview-site.com/suggested-page/'],
        'Trailing slashes and origin'
      );

      // stripTrailingSlash only removes trailing slash if path is '/', so paths with trailing slashes are preserved
      expect(issue.url).to.equal('https://test-site.com/broken-page/');
      expect(issue.aiSuggestion).to.equal('https://test-site.com/suggested-page/');
    });

    it('should handle multiple suggestions but only use first one', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        404,
        baseURLOrigin,
        [
          'https://test-site.com/suggested1',
          'https://test-site.com/suggested2',
          'https://test-site.com/suggested3',
        ],
        'Multiple suggestions'
      );

      // Only first suggestion should be used
      expect(issue.aiSuggestion).to.equal('https://test-site.com/suggested1');
    });

    it('should handle different HTTP status codes', () => {
      const statuses = [404, 500, 403, 410];

      statuses.forEach((status) => {
        const issue = createBrokenLinkIssue(
          'https://test-site.com/broken-page',
          status,
          baseURLOrigin,
          [],
          'Status test'
        );

        expect(issue.issue).to.equal(`Status ${status}`);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle URLs without trailing slashes', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken',
        404,
        baseURLOrigin,
        ['https://test-site.com/suggested'],
        'No trailing slash'
      );

      expect(issue.url).to.equal('https://test-site.com/broken');
      expect(issue.aiSuggestion).to.equal('https://test-site.com/suggested');
    });

    it('should handle complex URL paths with multiple segments', () => {
      const issue = createBrokenLinkIssue(
        'https://test-site.com/path/to/broken/page',
        404,
        baseURLOrigin,
        ['https://test-site.com/path/to/suggested/page'],
        'Complex paths'
      );

      expect(issue.url).to.equal('https://test-site.com/path/to/broken/page');
      expect(issue.aiSuggestion).to.equal('https://test-site.com/path/to/suggested/page');
    });

    it('should preserve aiRationale even when no suggestions', () => {
      const rationale = 'This page has been permanently removed';
      const issue = createBrokenLinkIssue(
        'https://test-site.com/broken-page',
        410,
        baseURLOrigin,
        [],
        rationale
      );

      expect(issue.aiRationale).to.equal(rationale);
      expect(issue.aiSuggestion).to.be.undefined;
    });
  });
});
