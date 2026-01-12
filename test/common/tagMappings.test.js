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

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import {
  OPPORTUNITY_TAG_MAPPINGS,
  getTagsForOpportunityType,
  mergeTagsWithHardcodedTags,
} from '../../src/common/tagMappings.js';

use(sinonChai);

describe('tagMappings', () => {
  describe('OPPORTUNITY_TAG_MAPPINGS', () => {
    it('should contain all expected opportunity type mappings', () => {
      expect(OPPORTUNITY_TAG_MAPPINGS).to.be.an('object');
      expect(OPPORTUNITY_TAG_MAPPINGS).to.have.property('cwv');
      expect(OPPORTUNITY_TAG_MAPPINGS).to.have.property('meta-tags');
      expect(OPPORTUNITY_TAG_MAPPINGS).to.have.property('alt-text');
      expect(OPPORTUNITY_TAG_MAPPINGS).to.have.property('high-form-views-low-conversions');
      expect(OPPORTUNITY_TAG_MAPPINGS).to.have.property('generic-opportunity');
    });

    it('should have correct tags for cwv', () => {
      expect(OPPORTUNITY_TAG_MAPPINGS.cwv).to.deep.equal(['Core Web Vitals', 'Web Performance']);
    });

    it('should have correct tags for meta-tags', () => {
      expect(OPPORTUNITY_TAG_MAPPINGS['meta-tags']).to.deep.equal(['Meta Tags', 'SEO']);
    });

    it('should have correct tags for alt-text', () => {
      expect(OPPORTUNITY_TAG_MAPPINGS['alt-text']).to.deep.equal(['Alt-Text', 'Accessibility', 'SEO']);
    });

    it('should have correct tags for high-form-views-low-conversions', () => {
      expect(OPPORTUNITY_TAG_MAPPINGS['high-form-views-low-conversions']).to.deep.equal(['Form Conversion', 'Conversion']);
    });

    it('should have correct tags for generic-opportunity', () => {
      expect(OPPORTUNITY_TAG_MAPPINGS['generic-opportunity']).to.deep.equal(['Generic', 'Opportunity']);
    });
  });

  describe('getTagsForOpportunityType', () => {
    it('should return tags for valid opportunity type', () => {
      const result = getTagsForOpportunityType('cwv');
      expect(result).to.deep.equal(['Core Web Vitals', 'Web Performance']);
    });

    it('should return tags for meta-tags opportunity type', () => {
      const result = getTagsForOpportunityType('meta-tags');
      expect(result).to.deep.equal(['Meta Tags', 'SEO']);
    });

    it('should return tags for alt-text opportunity type', () => {
      const result = getTagsForOpportunityType('alt-text');
      expect(result).to.deep.equal(['Alt-Text', 'Accessibility', 'SEO']);
    });

    it('should return tags for high-form-views-low-conversions opportunity type', () => {
      const result = getTagsForOpportunityType('high-form-views-low-conversions');
      expect(result).to.deep.equal(['Form Conversion', 'Conversion']);
    });

    it('should return tags for a11y-assistive opportunity type', () => {
      const result = getTagsForOpportunityType('a11y-assistive');
      expect(result).to.deep.equal(['ARIA Labels', 'Accessibility']);
    });

    it('should return tags for a11y-color-contrast opportunity type', () => {
      const result = getTagsForOpportunityType('a11y-color-contrast');
      expect(result).to.deep.equal(['Color Contrast', 'Accessibility', 'Engagement']);
    });

    it('should return tags for form-accessibility opportunity type', () => {
      const result = getTagsForOpportunityType('form-accessibility');
      expect(result).to.deep.equal(['Form Accessibility', 'Accessibility', 'Engagement']);
    });

    it('should return empty array for unknown opportunity type', () => {
      const result = getTagsForOpportunityType('unknown-type');
      expect(result).to.deep.equal([]);
    });

    it('should return empty array for undefined opportunity type', () => {
      const result = getTagsForOpportunityType(undefined);
      expect(result).to.deep.equal([]);
    });

    it('should return empty array for null opportunity type', () => {
      const result = getTagsForOpportunityType(null);
      expect(result).to.deep.equal([]);
    });

    it('should return empty array for empty string opportunity type', () => {
      const result = getTagsForOpportunityType('');
      expect(result).to.deep.equal([]);
    });
  });

  describe('mergeTagsWithHardcodedTags', () => {
    it('should return current tags unchanged for generic-opportunity', () => {
      const currentTags = ['Custom Tag', 'Another Tag'];
      const result = mergeTagsWithHardcodedTags('generic-opportunity', currentTags);
      expect(result).to.deep.equal(currentTags);
    });

    it('should return empty array for generic-opportunity with no current tags', () => {
      const result = mergeTagsWithHardcodedTags('generic-opportunity', []);
      expect(result).to.deep.equal([]);
    });

    it('should return current tags for generic-opportunity with undefined currentTags', () => {
      const result = mergeTagsWithHardcodedTags('generic-opportunity', undefined);
      expect(result).to.deep.equal([]);
    });

    it('should return current tags when opportunity type has no mapping', () => {
      const currentTags = ['Existing Tag'];
      const result = mergeTagsWithHardcodedTags('unknown-type', currentTags);
      expect(result).to.deep.equal(currentTags);
    });

    it('should return current tags when opportunity type has empty mapping', () => {
      const currentTags = ['Existing Tag'];
      // This tests the case where getTagsForOpportunityType returns empty array
      const result = mergeTagsWithHardcodedTags('unknown-type', currentTags);
      expect(result).to.deep.equal(currentTags);
    });

    it('should return hardcoded tags when currentTags is empty', () => {
      const result = mergeTagsWithHardcodedTags('cwv', []);
      expect(result).to.deep.equal(['Core Web Vitals', 'Web Performance']);
    });

    it('should return hardcoded tags when currentTags is undefined', () => {
      const result = mergeTagsWithHardcodedTags('cwv', undefined);
      expect(result).to.deep.equal(['Core Web Vitals', 'Web Performance']);
    });

    it('should return hardcoded tags when currentTags is null', () => {
      const result = mergeTagsWithHardcodedTags('cwv', null);
      expect(result).to.deep.equal(['Core Web Vitals', 'Web Performance']);
    });

    it('should replace all tags with hardcoded tags', () => {
      const currentTags = ['Old Tag', 'Another Old Tag'];
      const result = mergeTagsWithHardcodedTags('meta-tags', currentTags);
      expect(result).to.deep.equal(['Meta Tags', 'SEO']);
    });

    it('should preserve isElmo tag when present', () => {
      const currentTags = ['isElmo', 'Old Tag'];
      const result = mergeTagsWithHardcodedTags('alt-text', currentTags);
      expect(result).to.deep.equal(['Alt-Text', 'Accessibility', 'SEO', 'isElmo']);
    });

    it('should preserve isASO tag when present', () => {
      const currentTags = ['isASO', 'Old Tag'];
      const result = mergeTagsWithHardcodedTags('alt-text', currentTags);
      expect(result).to.deep.equal(['Alt-Text', 'Accessibility', 'SEO', 'isASO']);
    });

    it('should preserve both isElmo and isASO tags when present', () => {
      const currentTags = ['isElmo', 'isASO', 'Old Tag'];
      const result = mergeTagsWithHardcodedTags('alt-text', currentTags);
      expect(result).to.deep.equal(['Alt-Text', 'Accessibility', 'SEO', 'isElmo', 'isASO']);
    });

    it('should not duplicate isElmo if already in hardcoded tags', () => {
      // Note: This tests the logic but in practice, hardcoded tags don't contain isElmo/isASO
      const currentTags = ['isElmo'];
      const result = mergeTagsWithHardcodedTags('alt-text', currentTags);
      expect(result).to.include('isElmo');
      expect(result.filter((tag) => tag === 'isElmo').length).to.equal(1);
    });

    it('should not duplicate isASO if already in hardcoded tags', () => {
      const currentTags = ['isASO'];
      const result = mergeTagsWithHardcodedTags('alt-text', currentTags);
      expect(result).to.include('isASO');
      expect(result.filter((tag) => tag === 'isASO').length).to.equal(1);
    });

    it('should preserve isElmo and isASO but remove other tags', () => {
      const currentTags = ['isElmo', 'isASO', 'Custom Tag', 'Another Custom Tag'];
      const result = mergeTagsWithHardcodedTags('high-form-views-low-conversions', currentTags);
      expect(result).to.deep.equal(['Form Conversion', 'Conversion', 'isElmo', 'isASO']);
    });

    it('should handle multiple preserved tags correctly', () => {
      const currentTags = ['isElmo', 'isASO'];
      const result = mergeTagsWithHardcodedTags('a11y-color-contrast', currentTags);
      expect(result).to.deep.equal(['Color Contrast', 'Accessibility', 'Engagement', 'isElmo', 'isASO']);
    });

    it('should work with single hardcoded tag', () => {
      const result = mergeTagsWithHardcodedTags('high-organic-low-ctr', ['isElmo']);
      expect(result).to.deep.equal(['Low CTR', 'Engagement', 'isElmo']);
    });

    it('should work with multiple hardcoded tags', () => {
      const result = mergeTagsWithHardcodedTags('alt-text', ['isASO']);
      expect(result).to.deep.equal(['Alt-Text', 'Accessibility', 'SEO', 'isASO']);
    });

    it('should handle empty currentTags array', () => {
      const result = mergeTagsWithHardcodedTags('sitemap', []);
      expect(result).to.deep.equal(['Sitemap', 'SEO']);
    });

    it('should handle currentTags with only non-preserved tags', () => {
      const currentTags = ['Custom Tag', 'Another Tag'];
      const result = mergeTagsWithHardcodedTags('canonical', currentTags);
      expect(result).to.deep.equal(['Canonical URLs', 'SEO']);
    });

    it('should handle currentTags with mixed preserved and non-preserved tags', () => {
      const currentTags = ['isElmo', 'Custom Tag', 'isASO', 'Another Custom Tag'];
      const result = mergeTagsWithHardcodedTags('headings', currentTags);
      expect(result).to.deep.equal(['Headings', 'SEO', 'Engagement', 'isElmo', 'isASO']);
    });

    it('should handle all opportunity types in mappings', () => {
      const opportunityTypes = Object.keys(OPPORTUNITY_TAG_MAPPINGS);
      opportunityTypes.forEach((type) => {
        if (type === 'generic-opportunity') {
          // Generic should return current tags
          const result = mergeTagsWithHardcodedTags(type, ['Custom Tag']);
          expect(result).to.deep.equal(['Custom Tag']);
        } else {
          // All others should return hardcoded tags
          const result = mergeTagsWithHardcodedTags(type, []);
          expect(result).to.deep.equal(OPPORTUNITY_TAG_MAPPINGS[type]);
        }
      });
    });

    it('should preserve isElmo and isASO for all opportunity types', () => {
      const opportunityTypes = Object.keys(OPPORTUNITY_TAG_MAPPINGS).filter(
        (type) => type !== 'generic-opportunity',
      );
      opportunityTypes.forEach((type) => {
        const result = mergeTagsWithHardcodedTags(type, ['isElmo', 'isASO', 'Custom Tag']);
        expect(result).to.include('isElmo');
        expect(result).to.include('isASO');
        expect(result).to.not.include('Custom Tag');
        expect(result).to.deep.equal([
          ...OPPORTUNITY_TAG_MAPPINGS[type],
          'isElmo',
          'isASO',
        ]);
      });
    });

    it('should handle case where preserved tag already exists in hardcoded tags (edge case)', () => {
      // This tests the !mergedTags.includes(tag) check in the forEach loop
      // In practice, hardcoded tags don't contain isElmo/isASO, but we test the logic
      const currentTags = ['isElmo'];
      const result = mergeTagsWithHardcodedTags('sitemap', currentTags);
      // Verify isElmo is added only once
      expect(result.filter((tag) => tag === 'isElmo').length).to.equal(1);
      expect(result).to.include('isElmo');
    });

    it('should handle case where isElmo appears multiple times in currentTags', () => {
      // This tests the filter logic - it should only preserve unique isElmo/isASO tags
      const currentTags = ['isElmo', 'isElmo', 'Custom Tag'];
      const result = mergeTagsWithHardcodedTags('canonical', currentTags);
      // After filtering and merging, isElmo should appear only once
      expect(result.filter((tag) => tag === 'isElmo').length).to.equal(1);
      expect(result).to.include('isElmo');
      expect(result).to.not.include('Custom Tag');
    });

    it('should handle case where isASO appears multiple times in currentTags', () => {
      const currentTags = ['isASO', 'isASO', 'Custom Tag'];
      const result = mergeTagsWithHardcodedTags('hreflang', currentTags);
      expect(result.filter((tag) => tag === 'isASO').length).to.equal(1);
      expect(result).to.include('isASO');
      expect(result).to.not.include('Custom Tag');
    });

    it('should handle all opportunity types with preserved tags in correct order', () => {
      // Test that preserved tags are always added after hardcoded tags
      const result = mergeTagsWithHardcodedTags('readability', ['isElmo', 'isASO']);
      const hardcodedIndex = result.indexOf('Readability');
      const isElmoIndex = result.indexOf('isElmo');
      const isASOIndex = result.indexOf('isASO');
      expect(hardcodedIndex).to.be.lessThan(isElmoIndex);
      expect(hardcodedIndex).to.be.lessThan(isASOIndex);
    });
  });
});
