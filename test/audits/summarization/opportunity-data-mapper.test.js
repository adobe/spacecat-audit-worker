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
import { createOpportunityData } from '../../../src/summarization/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Summarization Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const siteId = 'site-123';
      const auditId = 'audit-456';
      const guidance = [
        {
          insight: 'Test insight',
          rationale: 'Test rationale',
          recommendation: 'Test recommendation',
          type: 'CONTENT_UPDATE',
        },
      ];

      const result = createOpportunityData(siteId, auditId, guidance);

      expect(result).to.be.an('object');
      expect(result).to.have.property('siteId', siteId);
      expect(result).to.have.property('auditId', auditId);
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('adobe.sharepoint.com');
      expect(result.runbook).to.include('Summarization_Runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('type', 'summarization');
      expect(result).to.have.property('title', 'Add LLM-Friendly Summaries');
      expect(result).to.have.property('description');
      expect(result.description).to.include('summarization');
      expect(result).to.have.property('status', 'NEW');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct runbook URL', () => {
      const result = createOpportunityData('site-1', 'audit-1', []);

      expect(result.runbook).to.include('adobe.sharepoint.com');
      expect(result.runbook).to.include('Experience_Success_Studio_Summarization_Runbook');
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData('site-1', 'audit-1', []);

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(2);
      expect(result.data.dataSources).to.include(DATA_SOURCES.AHREFS);
      expect(result.data.dataSources).to.include(DATA_SOURCES.PAGE);
    });

    it('should include guidance array', () => {
      const guidance = [
        {
          insight: 'Insight 1',
          rationale: 'Rationale 1',
          recommendation: 'Recommendation 1',
          type: 'CONTENT_UPDATE',
        },
      ];

      const result = createOpportunityData('site-1', 'audit-1', guidance);

      expect(result.guidance).to.deep.equal(guidance);
    });

    it('should handle empty guidance array', () => {
      const result = createOpportunityData('site-1', 'audit-1', []);

      expect(result.guidance).to.deep.equal([]);
    });

    it('should include correct tags', () => {
      const result = createOpportunityData('site-1', 'audit-1', []);

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('content');
    });

    it('should have description mentioning LLM and summarization', () => {
      const result = createOpportunityData('site-1', 'audit-1', []);

      expect(result.description).to.include('summarization');
      expect(result.description).to.include('LLM');
    });
  });
});

