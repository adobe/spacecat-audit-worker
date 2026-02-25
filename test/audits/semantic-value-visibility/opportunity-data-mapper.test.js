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
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createOpportunityData } from '../../../src/semantic-value-visibility/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = join(__dirname, '../../fixtures/semantic-value-visibility');
const krisshopFixture = JSON.parse(readFileSync(join(fixturesPath, 'Krisshop.json'), 'utf8'));

describe('Semantic Value Visibility Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const result = createOpportunityData({ guidance: krisshopFixture.guidance });

      expect(result.origin).to.equal('AUTOMATION');
      expect(result.title).to.equal('Improve image semantic visibility for LLMs');
      expect(result.description).to.include('Marketing images on this site contain text');
      expect(result.tags).to.deep.equal(['LLMO', 'SEO', 'Images']);
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData({ guidance: krisshopFixture.guidance });

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include guidance with insight, rationale, recommendation', () => {
      const result = createOpportunityData({ guidance: krisshopFixture.guidance });

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.insight).to.equal(krisshopFixture.guidance.insight);
      expect(result.guidance.rationale).to.equal(krisshopFixture.guidance.rationale);
      expect(result.guidance.recommendation).to.equal(krisshopFixture.guidance.recommendation);
    });

    it('should have empty runbook', () => {
      const result = createOpportunityData({ guidance: krisshopFixture.guidance });

      expect(result.runbook).to.equal('');
    });
  });
});
