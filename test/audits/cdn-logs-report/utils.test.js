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
import { validateCountryCode } from '../../../src/cdn-logs-report/utils/report-utils.js';
import { DEFAULT_COUNTRY_PATTERNS } from '../../../src/cdn-logs-report/constants/country-patterns.js';

function extractCC(url) {
  for (const { regex } of DEFAULT_COUNTRY_PATTERNS) {
    const pattern = new RegExp(regex, 'i'); // case-insensitive match
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }
  return null; // No country code found
}

describe('CDN logs report utils', () => {
  describe('Parse correct country code', () => {
    it('should return true for preview pages', () => {
      expect(validateCountryCode(extractCC('genuine/ooc-dm-twp-row-cx6-nc.html'))).to.equal('GLOBAL');
      expect(validateCountryCode(extractCC('th_th/genuine/ooc-dm-ses-cx6-nc.html'))).to.equal('TH');
      expect(validateCountryCode(extractCC('/'))).to.equal('GLOBAL');
      expect(validateCountryCode(extractCC('in/creativecloud.html'))).to.equal('IN');
      expect(validateCountryCode(extractCC('kr/genuine/ooc-dm-ses-cx6-nc.html'))).to.equal('KR');
      expect(validateCountryCode(extractCC('upload'))).to.equal('GLOBAL');
      expect(validateCountryCode(extractCC('id_id/genuine/ooc-dm-ses-cx6-nc.html'))).to.equal('ID');
      expect(validateCountryCode(extractCC('/uk/'))).to.equal('UK');
      expect(validateCountryCode(extractCC('/se/'))).to.equal('SE');
      expect(validateCountryCode(extractCC('/nl/products/pure-whey-protein/bpb-wpc8-0000'))).to.equal('NL');
      expect(validateCountryCode(extractCC('/fr/search'))).to.equal('FR');
      expect(validateCountryCode(extractCC('/ie/products/creatine-monohydrate/bpb-cmon-0000'))).to.equal('IE');
      expect(validateCountryCode(extractCC('/sendfriend/'))).to.equal('GLOBAL');
    });
  });
});
