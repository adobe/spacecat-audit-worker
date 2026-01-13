/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE/2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

import { expect } from 'chai';
import { createOpportunityData } from '../../../src/prerender/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Prerender Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook', '');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Recover Content Visibility');
      expect(result).to.have.property('description');
      expect(result.description).to.include('Pre-rendering');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct guidance steps', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(2);
      expect(result.guidance.steps[0]).to.include('Review URLs');
      expect(result.guidance.steps[1]).to.include('server-side rendering');
    });

    it('should include recommendations in guidance', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.guidance.recommendations).to.be.an('array');
      expect(result.guidance.recommendations).to.have.length(1);
      expect(result.guidance.recommendations[0]).to.have.property('recommendation');
      expect(result.guidance.recommendations[0].recommendation).to.include('pre-render');
    });

    it('should include correct data sources', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(2);
      expect(result.data.dataSources).to.include(DATA_SOURCES.AHREFS);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include correct tags', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('tech-geo');
    });

    it('should include thresholds in data', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.data.thresholds).to.be.an('object');
      expect(result.data.thresholds).to.have.property('contentGainRatio');
    });

    it('should include benefits array', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.data.benefits).to.be.an('array');
      expect(result.data.benefits).to.have.length(2);
      expect(result.data.benefits[0]).to.include('LLM visibility');
      expect(result.data.benefits[1]).to.include('LLM indexing');
    });

    it('should set scrapeForbidden to true when auditResult.scrapeForbidden is true', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: true,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.data.scrapeForbidden).to.equal(true);
    });

    it('should set scrapeForbidden to false when auditResult.scrapeForbidden is false', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const result = createOpportunityData(auditData);

      expect(result.data.scrapeForbidden).to.equal(false);
    });

    it('should handle missing auditResult', () => {
      const result = createOpportunityData({});

      expect(result.data.scrapeForbidden).to.equal(false);
    });

    it('should handle missing scrapeForbidden', () => {
      const auditData = {
        auditResult: {},
      };

      const result = createOpportunityData(auditData);

      expect(result.data.scrapeForbidden).to.equal(false);
    });

    it('should handle null auditData', () => {
      const result = createOpportunityData(null);

      expect(result.data.scrapeForbidden).to.equal(false);
    });
  });
});

