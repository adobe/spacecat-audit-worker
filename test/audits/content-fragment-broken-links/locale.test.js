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
import { Locale } from '../../../src/content-fragment-broken-links/domain/language/locale.js';
import { LocaleType } from '../../../src/content-fragment-broken-links/domain/language/locale-type.js';

describe('Locale', () => {
  describe('FIVE_LETTER_PATTERN', () => {
    it('should match valid 5-letter locales with hyphen', () => {
      expect(Locale.FIVE_LETTER_PATTERN.test('en-US')).to.be.true;
      expect(Locale.FIVE_LETTER_PATTERN.test('fr-FR')).to.be.true;
      expect(Locale.FIVE_LETTER_PATTERN.test('de-DE')).to.be.true;
    });

    it('should match valid 5-letter locales with underscore', () => {
      expect(Locale.FIVE_LETTER_PATTERN.test('en_US')).to.be.true;
      expect(Locale.FIVE_LETTER_PATTERN.test('fr_FR')).to.be.true;
      expect(Locale.FIVE_LETTER_PATTERN.test('de_DE')).to.be.true;
    });

    it('should not match invalid patterns', () => {
      expect(Locale.FIVE_LETTER_PATTERN.test('en')).to.be.false;
      expect(Locale.FIVE_LETTER_PATTERN.test('en-US-')).to.be.false;
      expect(Locale.FIVE_LETTER_PATTERN.test('en-US-X')).to.be.false;
      expect(Locale.FIVE_LETTER_PATTERN.test('en_US_')).to.be.false;
      expect(Locale.FIVE_LETTER_PATTERN.test('en-US')).to.be.true;
      expect(Locale.FIVE_LETTER_PATTERN.test('en_US')).to.be.true;
    });
  });

  describe('TWO_LETTER_PATTERN', () => {
    it('should match valid 2-letter codes', () => {
      expect(Locale.TWO_LETTER_PATTERN.test('US')).to.be.true;
      expect(Locale.TWO_LETTER_PATTERN.test('FR')).to.be.true;
      expect(Locale.TWO_LETTER_PATTERN.test('DE')).to.be.true;
      expect(Locale.TWO_LETTER_PATTERN.test('us')).to.be.true;
      expect(Locale.TWO_LETTER_PATTERN.test('fr')).to.be.true;
    });

    it('should not match invalid patterns', () => {
      expect(Locale.TWO_LETTER_PATTERN.test('U')).to.be.false;
      expect(Locale.TWO_LETTER_PATTERN.test('USA')).to.be.false;
      expect(Locale.TWO_LETTER_PATTERN.test('')).to.be.false;
      expect(Locale.TWO_LETTER_PATTERN.test('US')).to.be.true;
      expect(Locale.TWO_LETTER_PATTERN.test('FR')).to.be.true;
    });
  });

  describe('constructor', () => {
    it('should create locale with correct properties', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.code).to.equal('en-US');
      expect(locale.type).to.equal(LocaleType.FIVE_LETTER_LOCALE);
      expect(locale.language).to.equal('en');
      expect(locale.country).to.equal('US');
    });
  });

  describe('fromCode', () => {
    it('should return null for null code', () => {
      const result = Locale.fromCode(null);
      expect(result).to.be.null;
    });

    it('should return null for empty code', () => {
      const result = Locale.fromCode('');
      expect(result).to.be.null;
    });

    it('should return null for invalid code', () => {
      const result = Locale.fromCode('invalid');
      expect(result).to.be.null;
    });

    it('should return null for whitespace only code', () => {
      const result = Locale.fromCode('   ');
      expect(result).to.be.null;
    });

    it('should create 5-letter locale with hyphen', () => {
      const result = Locale.fromCode('en-US');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('en-US');
      expect(result.type).to.equal(LocaleType.FIVE_LETTER_LOCALE);
      expect(result.language).to.equal('en');
      expect(result.country).to.equal('US');
    });

    it('should create 5-letter locale with underscore', () => {
      const result = Locale.fromCode('en_US');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('en_US');
      expect(result.type).to.equal(LocaleType.FIVE_LETTER_LOCALE);
      expect(result.language).to.equal('en');
      expect(result.country).to.equal('US');
    });

    it('should create 2-letter country code', () => {
      const result = Locale.fromCode('US');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('US');
      expect(result.type).to.equal(LocaleType.TWO_LETTER_COUNTRY);
      expect(result.language).to.be.null;
      expect(result.country).to.equal('US');
    });

    it('should handle lowercase 2-letter country code', () => {
      const result = Locale.fromCode('us');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('us');
      expect(result.type).to.equal(LocaleType.TWO_LETTER_COUNTRY);
      expect(result.language).to.be.null;
      expect(result.country).to.equal('US');
    });

    it('should trim whitespace', () => {
      const result = Locale.fromCode('  en-US  ');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('en-US');
    });
  });

  describe('fromPath', () => {
    it('should return null for null path', () => {
      const result = Locale.fromPath(null);
      expect(result).to.be.null;
    });

    it('should return null for path without locale', () => {
      const result = Locale.fromPath('/content/dam/images/photo.jpg');
      expect(result).to.be.null;
    });

    it('should extract 5-letter locale from path', () => {
      const result = Locale.fromPath('/content/dam/en-US/images/photo.jpg');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('en-US');
      expect(result.type).to.equal(LocaleType.FIVE_LETTER_LOCALE);
    });

    it('should extract 5-letter locale with underscore from path', () => {
      const result = Locale.fromPath('/content/dam/en_US/images/photo.jpg');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('en_US');
      expect(result.type).to.equal(LocaleType.FIVE_LETTER_LOCALE);
    });

    it('should extract 2-letter country from path', () => {
      const result = Locale.fromPath('/content/dam/US/images/photo.jpg');
      expect(result).to.be.instanceOf(Locale);
      expect(result.code).to.equal('US');
      expect(result.type).to.equal(LocaleType.TWO_LETTER_COUNTRY);
    });
  });

  describe('getCode', () => {
    it('should return the code', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.getCode()).to.equal('en-US');
    });
  });

  describe('getType', () => {
    it('should return the type', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.getType()).to.equal(LocaleType.FIVE_LETTER_LOCALE);
    });
  });

  describe('getLanguage', () => {
    it('should return the language', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.getLanguage()).to.equal('en');
    });
  });

  describe('getCountry', () => {
    it('should return the country', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.getCountry()).to.equal('US');
    });
  });

  describe('isValid', () => {
    it('should return true for valid locale', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.isValid()).to.be.true;
    });

    it('should return false for locale without code', () => {
      const locale = new Locale('', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.isValid()).to.be.false;
    });

    it('should return false for locale with null code', () => {
      const locale = new Locale(null, LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      expect(locale.isValid()).to.be.false;
    });
  });

  describe('replaceInPath', () => {
    it('should return original path if no code', () => {
      const locale = new Locale('', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      const result = locale.replaceInPath('/content/dam/en-US/images/photo.jpg', 'fr-FR');
      expect(result).to.equal('/content/dam/en-US/images/photo.jpg');
    });

    it('should return original path if no path', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      const result = locale.replaceInPath(null, 'fr-FR');
      expect(result).to.be.null;
    });

    it('should replace locale in path', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      const result = locale.replaceInPath('/content/dam/en-US/images/photo.jpg', 'fr-FR');
      expect(result).to.equal('/content/dam/fr-FR/images/photo.jpg');
    });

    it('should not replace locale if not found', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      const result = locale.replaceInPath('/content/dam/fr-FR/images/photo.jpg', 'de-DE');
      expect(result).to.equal('/content/dam/fr-FR/images/photo.jpg');
    });
  });

  describe('toJSON', () => {
    it('should return JSON representation', () => {
      const locale = new Locale('en-US', LocaleType.FIVE_LETTER_LOCALE, 'en', 'US');
      const result = locale.toJSON();
      expect(result).to.deep.equal({
        code: 'en-US',
        type: LocaleType.FIVE_LETTER_LOCALE,
        language: 'en',
        country: 'US',
      });
    });
  });
});
