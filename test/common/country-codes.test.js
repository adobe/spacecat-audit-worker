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

import { expect } from 'chai';
import { validateCountryCode } from '../../src/common/country-codes.js';

describe('country-codes', () => {
  describe('validateCountryCode', () => {
    it('validates valid country codes', () => {
      expect(validateCountryCode('US')).to.equal('US');
      expect(validateCountryCode('us')).to.equal('US');
      expect(validateCountryCode('GB')).to.equal('GB');
      expect(validateCountryCode('UK')).to.equal('UK');
    });

    it('returns GLOBAL for invalid codes', () => {
      expect(validateCountryCode('ABC')).to.equal('GLOBAL');
      expect(validateCountryCode('EU')).to.equal('GLOBAL');
      expect(validateCountryCode('EZ')).to.equal('GLOBAL');
      expect(validateCountryCode('XA')).to.equal('GLOBAL');
      expect(validateCountryCode(null)).to.equal('GLOBAL');
      expect(validateCountryCode('')).to.equal('GLOBAL');
    });

    it('handles GLOBAL country code correctly', () => {
      expect(validateCountryCode('GLOBAL')).to.equal('GLOBAL');
      expect(validateCountryCode('global')).to.equal('GLOBAL');
    });

    it('returns GLOBAL for language codes that collide with a real country (LLMO-7230)', () => {
      expect(validateCountryCode('VI')).to.equal('GLOBAL'); // Vietnamese vs Virgin Islands
      expect(validateCountryCode('vi')).to.equal('GLOBAL');
      expect(validateCountryCode('ML')).to.equal('GLOBAL'); // Malayalam vs Mali
      expect(validateCountryCode('NE')).to.equal('GLOBAL'); // Nepali vs Niger
      expect(validateCountryCode('MR')).to.equal('GLOBAL'); // Marathi vs Mauritania
      expect(validateCountryCode('KN')).to.equal('GLOBAL'); // Kannada vs St Kitts
      expect(validateCountryCode('BN')).to.equal('GLOBAL'); // Bengali vs Brunei
      expect(validateCountryCode('GU')).to.equal('GLOBAL'); // Gujarati vs Guam
      expect(validateCountryCode('MS')).to.equal('GLOBAL'); // Malay(sian) vs Montserrat
      expect(validateCountryCode('SR')).to.equal('GLOBAL'); // Serbian vs Suriname
      expect(validateCountryCode('SL')).to.equal('GLOBAL'); // Slovenian vs Sierra Leone (Slovak is 'sk', not 'sl')
      expect(validateCountryCode('SV')).to.equal('GLOBAL'); // Swedish vs El Salvador
      expect(validateCountryCode('ET')).to.equal('GLOBAL'); // Estonian vs Ethiopia
      expect(validateCountryCode('GA')).to.equal('GLOBAL'); // Irish/Georgian vs Gabon
      expect(validateCountryCode('GL')).to.equal('GLOBAL'); // "Global" locale (/en_gl/) vs Greenland
    });

    it('does not ignore-list countries with genuine fleet-wide traffic (LLMO-7230)', () => {
      expect(validateCountryCode('CA')).to.equal('CA');
      expect(validateCountryCode('MY')).to.equal('MY');
      expect(validateCountryCode('ID')).to.equal('ID');
      expect(validateCountryCode('TH')).to.equal('TH');
      expect(validateCountryCode('BE')).to.equal('BE');
      expect(validateCountryCode('DE')).to.equal('DE');
      expect(validateCountryCode('FR')).to.equal('FR');
      // CY verified against live traffic: /cy/el/... is a genuine Cyprus (country) +
      // Greek (language) path, not a Welsh-language leak, so CY stays a real code
      expect(validateCountryCode('CY')).to.equal('CY');
    });

    it('allows PA to be ignored per-site (e.g. Zee5 Punjabi /pa/) without a global ignore', () => {
      expect(validateCountryCode('PA')).to.equal('PA');
      expect(validateCountryCode('PA', ['PA'])).to.equal('GLOBAL');
    });

    it('returns GLOBAL for codes in per-site ignore list', () => {
      expect(validateCountryCode('PS', ['PS'])).to.equal('GLOBAL');
      expect(validateCountryCode('ps', ['PS'])).to.equal('GLOBAL');
      expect(validateCountryCode('AD', ['ad', 'ps'])).to.equal('GLOBAL');
    });

    it('returns valid code when not in per-site ignore list', () => {
      expect(validateCountryCode('US', ['PS'])).to.equal('US');
      expect(validateCountryCode('DE', ['PS', 'AD'])).to.equal('DE');
    });

    it('handles empty per-site ignore list', () => {
      expect(validateCountryCode('US', [])).to.equal('US');
    });
  });
});
