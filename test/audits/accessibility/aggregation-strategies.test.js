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

import * as chai from 'chai';
import {
  Granularity,
  GRANULARITY_KEY_BUILDERS,
  ISSUE_GRANULARITY_MAP,
  getGranularityForIssueType,
  buildAggregationKey,
  buildSuggestionKey,
} from '../../../src/accessibility/utils/aggregation-strategies.js';

const { expect } = chai;

describe('Aggregation Strategies', () => {
  describe('Granularity Enum', () => {
    it('should have all expected granularity levels', () => {
      expect(Granularity.INDIVIDUAL).to.equal('INDIVIDUAL');
      expect(Granularity.PER_PAGE_PER_COMPONENT).to.equal('PER_PAGE_PER_COMPONENT');
      expect(Granularity.PER_PAGE).to.equal('PER_PAGE');
      expect(Granularity.PER_COMPONENT).to.equal('PER_COMPONENT');
      expect(Granularity.PER_TYPE).to.equal('PER_TYPE');
    });
  });

  describe('GRANULARITY_KEY_BUILDERS', () => {
    it('should have a builder for each granularity level', () => {
      expect(GRANULARITY_KEY_BUILDERS[Granularity.INDIVIDUAL]).to.be.a('function');
      expect(GRANULARITY_KEY_BUILDERS[Granularity.PER_PAGE_PER_COMPONENT]).to.be.a('function');
      expect(GRANULARITY_KEY_BUILDERS[Granularity.PER_PAGE]).to.be.a('function');
      expect(GRANULARITY_KEY_BUILDERS[Granularity.PER_COMPONENT]).to.be.a('function');
      expect(GRANULARITY_KEY_BUILDERS[Granularity.PER_TYPE]).to.be.a('function');
    });
  });

  describe('buildAggregationKey', () => {
    describe('INDIVIDUAL granularity (color-contrast)', () => {
      it('should build key with url|type|selector', () => {
        const key = buildAggregationKey('color-contrast', 'https://example.com/page1', 'div.header', null);
        expect(key).to.equal('https://example.com/page1|color-contrast|div.header');
      });

      it('should include source when provided', () => {
        const key = buildAggregationKey('color-contrast', 'https://example.com/page1', 'div.header', 'ahrefs');
        expect(key).to.equal('https://example.com/page1|color-contrast|div.header|ahrefs');
      });

      it('should handle missing selector', () => {
        const key = buildAggregationKey('color-contrast', 'https://example.com/page1', '', null);
        // buildKey helper filters out empty values, so no trailing pipe
        expect(key).to.equal('https://example.com/page1|color-contrast');
      });
    });

    describe('PER_PAGE_PER_COMPONENT granularity (button-name)', () => {
      it('should build key with url|type (no selector)', () => {
        const key = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', null);
        expect(key).to.equal('https://example.com/page1|button-name');
      });

      it('should group different selectors together', () => {
        const key1 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', null);
        const key2 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.cancel', null);
        expect(key1).to.equal(key2); // Should be same key!
      });

      it('should include source when provided', () => {
        const key = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', 'ahrefs');
        expect(key).to.equal('https://example.com/page1|button-name|ahrefs');
      });
    });

    describe('PER_PAGE granularity (html-has-lang)', () => {
      it('should build key with url only', () => {
        const key = buildAggregationKey('html-has-lang', 'https://example.com/page1', 'html', null);
        expect(key).to.equal('https://example.com/page1');
      });

      it('should group all issue types on same page together', () => {
        const key1 = buildAggregationKey('html-has-lang', 'https://example.com/page1', 'html', null);
        const key2 = buildAggregationKey('meta-viewport', 'https://example.com/page1', 'meta', null);
        expect(key1).to.equal(key2); // Should be same key!
      });

      it('should include source when provided', () => {
        const key = buildAggregationKey('html-has-lang', 'https://example.com/page1', 'html', 'ahrefs');
        expect(key).to.equal('https://example.com/page1|ahrefs');
      });
    });

    describe('PER_COMPONENT granularity (list)', () => {
      it('should build key with type|selector', () => {
        const key = buildAggregationKey('list', 'https://example.com/page1', 'ul.nav-menu', null);
        expect(key).to.equal('list|ul.nav-menu');
      });

      it('should group same component across different pages', () => {
        const key1 = buildAggregationKey('list', 'https://example.com/page1', 'ul.nav-menu', null);
        const key2 = buildAggregationKey('list', 'https://example.com/page2', 'ul.nav-menu', null);
        expect(key1).to.equal(key2); // Should be same key!
      });

      it('should differentiate different component types', () => {
        const key1 = buildAggregationKey('list', 'https://example.com/page1', 'ul.nav-menu', null);
        const key2 = buildAggregationKey('list', 'https://example.com/page1', 'ol.steps', null);
        expect(key1).to.not.equal(key2); // Different selectors = different keys
      });
    });

    describe('PER_TYPE granularity (aria-prohibited-attr)', () => {
      it('should build key with type only', () => {
        const key = buildAggregationKey('aria-prohibited-attr', 'https://example.com/page1', 'div[aria-hidden]', null);
        expect(key).to.equal('aria-prohibited-attr');
      });

      it('should group all instances globally', () => {
        const key1 = buildAggregationKey('aria-prohibited-attr', 'https://example.com/page1', 'div.header', null);
        const key2 = buildAggregationKey('aria-prohibited-attr', 'https://example.com/page2', 'span.label', null);
        const key3 = buildAggregationKey('aria-prohibited-attr', 'https://example.com/page3', 'section.main', null);
        expect(key1).to.equal(key2);
        expect(key2).to.equal(key3); // All should be same key!
      });
    });

    describe('Unmapped issue types', () => {
      it('should default to PER_PAGE_PER_COMPONENT', () => {
        const key = buildAggregationKey('unknown-issue-type', 'https://example.com/page1', 'div.test', null);
        // PER_PAGE_PER_COMPONENT format: url|type
        expect(key).to.equal('https://example.com/page1|unknown-issue-type');
      });
    });
  });

  describe('getGranularityForIssueType', () => {
    it('should return correct granularity for mapped issues', () => {
      expect(getGranularityForIssueType('color-contrast')).to.equal(Granularity.INDIVIDUAL);
      expect(getGranularityForIssueType('button-name')).to.equal(Granularity.PER_PAGE_PER_COMPONENT);
      expect(getGranularityForIssueType('html-has-lang')).to.equal(Granularity.PER_PAGE);
      expect(getGranularityForIssueType('list')).to.equal(Granularity.PER_COMPONENT);
      expect(getGranularityForIssueType('aria-prohibited-attr')).to.equal(Granularity.PER_TYPE);
    });

    it('should default to PER_PAGE_PER_COMPONENT for unmapped issues', () => {
      expect(getGranularityForIssueType('unknown-issue')).to.equal(Granularity.PER_PAGE_PER_COMPONENT);
    });
  });

  describe('ISSUE_GRANULARITY_MAP', () => {
    it('should have entries for all known issue types', () => {
      const expectedIssues = [
        'color-contrast',
        'list',
        'aria-roles',
        'image-alt',
        'link-in-text-block',
        'link-name',
        'target-size',
        'listitem',
        'label',
        'aria-prohibited-attr',
        'button-name',
        'frame-title',
        'aria-valid-attr-value',
        'aria-allowed-attr',
        'aria-hidden-focus',
        'nested-interactive',
        'html-has-lang',
        'meta-viewport',
        'aria-required-children',
        'aria-required-parent',
        'meta-refresh',
        'role-img-alt',
        'aria-input-field-name',
        'scrollable-region-focusable',
        'select-name',
      ];

      expectedIssues.forEach((issueType) => {
        expect(ISSUE_GRANULARITY_MAP[issueType]).to.exist;
        expect(ISSUE_GRANULARITY_MAP[issueType]).to.be.a('string');
      });
    });

    it('should only use valid granularity values', () => {
      const validGranularities = Object.values(Granularity);

      Object.values(ISSUE_GRANULARITY_MAP).forEach((granularity) => {
        expect(validGranularities).to.include(granularity);
      });
    });
  });

  describe('Key Consistency', () => {
    it('should produce consistent keys for same data', () => {
      const key1 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', 'ahrefs');
      const key2 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', 'ahrefs');
      expect(key1).to.equal(key2);
    });

    it('should produce different keys for different pages', () => {
      const key1 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', 'ahrefs');
      const key2 = buildAggregationKey('button-name', 'https://example.com/page2', 'button.submit', 'ahrefs');
      expect(key1).to.not.equal(key2);
    });

    it('should produce different keys for different sources', () => {
      const key1 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', 'ahrefs');
      const key2 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', 'semrush');
      expect(key1).to.not.equal(key2);
    });
  });

  describe('Grouping Behavior', () => {
    describe('PER_PAGE_PER_COMPONENT should group', () => {
      it('all elements with same issue type on same page', () => {
        const keys = [
          buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', null),
          buildAggregationKey('button-name', 'https://example.com/page1', 'button.cancel', null),
          buildAggregationKey('button-name', 'https://example.com/page1', 'button.apply', null),
        ];

        // All should be same
        expect(keys[0]).to.equal(keys[1]);
        expect(keys[1]).to.equal(keys[2]);
      });

      it('but not elements on different pages', () => {
        const key1 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', null);
        const key2 = buildAggregationKey('button-name', 'https://example.com/page2', 'button.submit', null);

        expect(key1).to.not.equal(key2);
      });

      it('but not different issue types', () => {
        const key1 = buildAggregationKey('button-name', 'https://example.com/page1', 'button.submit', null);
        const key2 = buildAggregationKey('image-alt', 'https://example.com/page1', 'img.logo', null);

        expect(key1).to.not.equal(key2);
      });
    });

    describe('PER_COMPONENT should group', () => {
      it('same component across all pages', () => {
        const keys = [
          buildAggregationKey('list', 'https://example.com/page1', 'ul.nav-menu', null),
          buildAggregationKey('list', 'https://example.com/page2', 'ul.nav-menu', null),
          buildAggregationKey('list', 'https://example.com/page3', 'ul.nav-menu', null),
        ];

        expect(keys[0]).to.equal(keys[1]);
        expect(keys[1]).to.equal(keys[2]);
      });
    });

    describe('PER_TYPE should group', () => {
      it('all instances globally', () => {
        const keys = [
          buildAggregationKey('aria-prohibited-attr', 'https://example.com/page1', 'div.header', null),
          buildAggregationKey('aria-prohibited-attr', 'https://example.com/page2', 'span.label', null),
          buildAggregationKey('aria-prohibited-attr', 'https://example.com/page3', 'section.main', null),
        ];

        expect(keys[0]).to.equal(keys[1]);
        expect(keys[1]).to.equal(keys[2]);
        expect(keys[0]).to.equal('aria-prohibited-attr');
      });
    });
  });

  describe('buildSuggestionKey (Database Keys)', () => {
    it('should always use INDIVIDUAL granularity regardless of issue type', () => {
      // Test with button-name which has PER_PAGE_PER_COMPONENT granularity
      const suggestionData1 = {
        url: 'https://example.com/page1',
        issues: [{
          type: 'button-name',
          htmlWithIssues: [{ target_selector: 'button.submit' }],
        }],
      };
      const key1 = buildSuggestionKey(suggestionData1);
      expect(key1).to.equal('https://example.com/page1|button-name|button.submit');

      // Test with aria-prohibited-attr which has PER_TYPE granularity
      const suggestionData2 = {
        url: 'https://example.com/page2',
        issues: [{
          type: 'aria-prohibited-attr',
          htmlWithIssues: [{ target_selector: 'div.header' }],
        }],
      };
      const key2 = buildSuggestionKey(suggestionData2);
      expect(key2).to.equal('https://example.com/page2|aria-prohibited-attr|div.header');
    });

    it('should include trailing pipe for empty selector (backwards compatibility)', () => {
      const suggestionData = {
        url: 'https://example.com/page1',
        issues: [{
          type: 'image-alt',
          htmlWithIssues: [{ target_selector: '' }],
        }],
      };
      const key = buildSuggestionKey(suggestionData);
      expect(key).to.equal('https://example.com/page1|image-alt|');
    });

    it('should include trailing pipe for missing selector (backwards compatibility)', () => {
      const suggestionData = {
        url: 'https://example.com/page1',
        issues: [{
          type: 'label',
          htmlWithIssues: [{}],
        }],
      };
      const key = buildSuggestionKey(suggestionData);
      expect(key).to.equal('https://example.com/page1|label|');
    });

    it('should include source when provided', () => {
      const suggestionData = {
        url: 'https://example.com/page1',
        source: 'ahrefs',
        issues: [{
          type: 'link-name',
          htmlWithIssues: [{ target_selector: 'a.nav-link' }],
        }],
      };
      const key = buildSuggestionKey(suggestionData);
      expect(key).to.equal('https://example.com/page1|link-name|a.nav-link|ahrefs');
    });

    it('should return url when no issues present', () => {
      const suggestionData = {
        url: 'https://example.com/page1',
        issues: [],
      };
      const key = buildSuggestionKey(suggestionData);
      expect(key).to.equal('https://example.com/page1');
    });
  });
});

