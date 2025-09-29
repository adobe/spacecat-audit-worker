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
import { LanguageTree } from '../../../src/content-fragment-broken-links/domain/language/language-tree.js';

describe('LanguageTree', () => {
  describe('COUNTRY_CODE_GROUPS', () => {
    it('should contain expected country code groups', () => {
      expect(LanguageTree.COUNTRY_CODE_GROUPS).to.have.property('FR');
      expect(LanguageTree.COUNTRY_CODE_GROUPS).to.have.property('DE');
      expect(LanguageTree.COUNTRY_CODE_GROUPS).to.have.property('US');
      expect(LanguageTree.COUNTRY_CODE_GROUPS).to.have.property('ES');
      expect(LanguageTree.COUNTRY_CODE_GROUPS).to.have.property('IT');
      expect(LanguageTree.COUNTRY_CODE_GROUPS).to.have.property('CN');
      expect(LanguageTree.COUNTRY_CODE_GROUPS).to.have.property('RU');
    });

    it('should have FR group with correct countries', () => {
      expect(LanguageTree.COUNTRY_CODE_GROUPS.FR).to.deep.equal(['FR', 'MC']);
    });

    it('should have DE group with correct countries', () => {
      expect(LanguageTree.COUNTRY_CODE_GROUPS.DE).to.deep.equal(['DE', 'AT', 'LI']);
    });

    it('should have US group with correct countries', () => {
      expect(LanguageTree.COUNTRY_CODE_GROUPS.US).to.deep.equal(['US', 'GB', 'CA', 'AU', 'NZ', 'IE']);
    });
  });

  describe('LOCALE_CODE_GROUPS', () => {
    it('should contain expected locale code groups', () => {
      expect(LanguageTree.LOCALE_CODE_GROUPS).to.have.property('fr-FR');
      expect(LanguageTree.LOCALE_CODE_GROUPS).to.have.property('de-DE');
      expect(LanguageTree.LOCALE_CODE_GROUPS).to.have.property('en-US');
      expect(LanguageTree.LOCALE_CODE_GROUPS).to.have.property('es-ES');
      expect(LanguageTree.LOCALE_CODE_GROUPS).to.have.property('it-IT');
      expect(LanguageTree.LOCALE_CODE_GROUPS).to.have.property('zh-CN');
      expect(LanguageTree.LOCALE_CODE_GROUPS).to.have.property('ru-RU');
    });

    it('should have fr-FR group with correct locales', () => {
      expect(LanguageTree.LOCALE_CODE_GROUPS['fr-FR']).to.deep.equal(['fr-FR', 'ca-FR', 'fr-CA', 'fr-BE', 'fr-CH']);
    });

    it('should have en-US group with correct locales', () => {
      expect(LanguageTree.LOCALE_CODE_GROUPS['en-US']).to.deep.equal(['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ']);
    });
  });

  describe('COUNTRY_TO_ROOT', () => {
    it('should have reverse mappings for country codes', () => {
      expect(LanguageTree.COUNTRY_TO_ROOT.FR).to.equal('FR');
      expect(LanguageTree.COUNTRY_TO_ROOT.MC).to.equal('FR');
      expect(LanguageTree.COUNTRY_TO_ROOT.DE).to.equal('DE');
      expect(LanguageTree.COUNTRY_TO_ROOT.AT).to.equal('DE');
      expect(LanguageTree.COUNTRY_TO_ROOT.US).to.equal('US');
      expect(LanguageTree.COUNTRY_TO_ROOT.GB).to.equal('US');
    });
  });

  describe('LOCALE_TO_ROOT', () => {
    it('should have reverse mappings for locale codes', () => {
      expect(LanguageTree.LOCALE_TO_ROOT['fr-FR']).to.equal('fr-FR');
      expect(LanguageTree.LOCALE_TO_ROOT['ca-FR']).to.equal('fr-FR');
      expect(LanguageTree.LOCALE_TO_ROOT['en-US']).to.equal('en-US');
      expect(LanguageTree.LOCALE_TO_ROOT['en-GB']).to.equal('en-US');
    });
  });

  describe('findSimilarLanguageRoots', () => {
    it('should return empty array for null locale', () => {
      const result = LanguageTree.findSimilarLanguageRoots(null);
      expect(result).to.deep.equal([]);
    });

    it('should return empty array for empty locale', () => {
      const result = LanguageTree.findSimilarLanguageRoots('');
      expect(result).to.deep.equal([]);
    });

    it('should return case variations for 2-letter locale', () => {
      const result = LanguageTree.findSimilarLanguageRoots('FR');
      expect(result).to.include('fr');
      // Note: FR itself is removed from the result since it's the original
    });

    it('should return case variations for 5-letter locale', () => {
      const result = LanguageTree.findSimilarLanguageRoots('fr-FR');
      expect(result).to.include('fr-fr');
      expect(result).to.include('FR-fr');
      expect(result).to.include('FR-FR');
      expect(result).to.include('fr_fr');
      expect(result).to.include('fr_FR');
      expect(result).to.include('FR_fr');
      expect(result).to.include('FR_FR');
      // Note: fr-FR itself is removed from the result since it's the original
    });

    it('should include English fallbacks', () => {
      const result = LanguageTree.findSimilarLanguageRoots('fr-FR');
      expect(result).to.include('us');
      expect(result).to.include('US');
      expect(result).to.include('en-us');
      expect(result).to.include('en-US');
      expect(result).to.include('gb');
      expect(result).to.include('GB');
      expect(result).to.include('en-gb');
      expect(result).to.include('en-GB');
    });

    it('should include siblings for known locale', () => {
      const result = LanguageTree.findSimilarLanguageRoots('fr-FR');
      expect(result).to.include('ca-FR');
      expect(result).to.include('fr-CA');
      expect(result).to.include('fr-BE');
      expect(result).to.include('fr-CH');
    });

    it('should not include the original locale', () => {
      const result = LanguageTree.findSimilarLanguageRoots('fr-FR');
      expect(result).to.not.include('fr-FR');
    });

    it('should handle unknown locale gracefully', () => {
      const result = LanguageTree.findSimilarLanguageRoots('xx-XX');
      expect(result).to.include('xx-xx');
      expect(result).to.include('XX-xx');
      expect(result).to.include('XX-XX');
      expect(result).to.include('xx_xx');
      expect(result).to.include('xx_XX');
      expect(result).to.include('XX_xx');
      expect(result).to.include('XX_XX');
      // Note: xx-XX itself is removed from the result since it's the original
    });

    it('should handle case where no siblings can be found', () => {
      // Temporarily modify the mappings to create this scenario
      const originalCountryToRoot = { ...LanguageTree.COUNTRY_TO_ROOT };
      const originalCountryGroups = { ...LanguageTree.COUNTRY_CODE_GROUPS };

      try {
        // Make COUNTRY_TO_ROOT return a value that doesn't exist in COUNTRY_CODE_GROUPS
        LanguageTree.COUNTRY_TO_ROOT.ZZ = 'NONEXISTENT';

        // Ensure NONEXISTENT is not in COUNTRY_CODE_GROUPS
        delete LanguageTree.COUNTRY_CODE_GROUPS.NONEXISTENT;

        const result = LanguageTree.findSimilarLanguageRoots('ZZ');

        // Should still return case variations and English fallbacks, but no siblings
        expect(result).to.include('zz'); // Case variation
        expect(result).to.include('us'); // English fallback
        expect(result).to.include('en-us'); // English fallback
        // Should not crash and should handle the empty siblings array (|| [])
        expect(result).to.be.an('array');
      } finally {
        // Restore original mappings
        LanguageTree.COUNTRY_TO_ROOT = originalCountryToRoot;
        LanguageTree.COUNTRY_CODE_GROUPS = originalCountryGroups;
      }
    });
  });

  describe('generateCaseVariations', () => {
    it('should return empty array for null locale', () => {
      const result = LanguageTree.generateCaseVariations(null);
      expect(result).to.deep.equal([]);
    });

    it('should return empty array for empty locale', () => {
      const result = LanguageTree.generateCaseVariations('');
      expect(result).to.deep.equal([]);
    });

    it('should generate variations for 2-letter locale', () => {
      const result = LanguageTree.generateCaseVariations('FR');
      expect(result).to.deep.equal(['fr']);
    });

    it('should generate variations for 5-letter locale with hyphen', () => {
      const result = LanguageTree.generateCaseVariations('fr-FR');
      expect(result).to.deep.equal([
        'fr-fr', 'FR-fr', 'FR-FR',
        'fr_fr', 'fr_FR', 'FR_fr', 'FR_FR',
      ]);
    });

    it('should generate variations for 5-letter locale with underscore', () => {
      const result = LanguageTree.generateCaseVariations('fr_FR');
      expect(result).to.deep.equal([
        'fr-fr', 'fr-FR', 'FR-fr', 'FR-FR',
        'fr_fr', 'FR_fr', 'FR_FR',
      ]);
    });

    it('should not include the original locale', () => {
      const result = LanguageTree.generateCaseVariations('fr-FR');
      expect(result).to.not.include('fr-FR');
    });

    it('should handle invalid 5-letter locale', () => {
      const result = LanguageTree.generateCaseVariations('fr-FR-X');
      expect(result).to.deep.equal([]);
    });
  });

  describe('findRootForLocale', () => {
    it('should return null for null locale', () => {
      const result = LanguageTree.findRootForLocale(null);
      expect(result).to.be.null;
    });

    it('should return null for empty locale', () => {
      const result = LanguageTree.findRootForLocale('');
      expect(result).to.be.null;
    });

    it('should find root for 2-letter country code', () => {
      const result = LanguageTree.findRootForLocale('FR');
      expect(result).to.equal('FR');
    });

    it('should find root for 2-letter country code in group', () => {
      const result = LanguageTree.findRootForLocale('MC');
      expect(result).to.equal('FR');
    });

    it('should find root for 5-letter locale code', () => {
      const result = LanguageTree.findRootForLocale('fr-FR');
      expect(result).to.equal('fr-FR');
    });

    it('should find root for 5-letter locale code in group', () => {
      const result = LanguageTree.findRootForLocale('ca-FR');
      expect(result).to.equal('fr-FR');
    });

    it('should return null for unknown locale', () => {
      const result = LanguageTree.findRootForLocale('xx-XX');
      expect(result).to.be.null;
    });

    it('should return locale itself when it is a root in groups but not in reverse mappings', () => {
      // Temporarily modify the reverse mappings to simulate this scenario
      const originalCountryToRoot = { ...LanguageTree.COUNTRY_TO_ROOT };
      const originalLocaleToRoot = { ...LanguageTree.LOCALE_TO_ROOT };

      try {
        // Remove 'FR' from COUNTRY_TO_ROOT but keep it in COUNTRY_CODE_GROUPS
        delete LanguageTree.COUNTRY_TO_ROOT.FR;

        const result = LanguageTree.findRootForLocale('FR');
        expect(result).to.equal('FR'); // Should return the locale itself
      } finally {
        LanguageTree.COUNTRY_TO_ROOT = originalCountryToRoot;
        LanguageTree.LOCALE_TO_ROOT = originalLocaleToRoot;
      }
    });
  });

  describe('findEnglishFallbacks', () => {
    it('should return expected English fallbacks', () => {
      const result = LanguageTree.findEnglishFallbacks();
      expect(result).to.deep.equal([
        'us', 'US', 'en-us', 'en_us', 'en-US', 'en_US',
        'gb', 'GB', 'en-gb', 'en_gb', 'en-GB', 'en_GB',
      ]);
    });
  });
});
