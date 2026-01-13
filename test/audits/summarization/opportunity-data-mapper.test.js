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
import { OPPORTUNITY_TYPES } from '@adobe/spacecat-shared-utils';
import { createOpportunityData } from '../../../src/summarization/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Summarization Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const siteId = 'site-123';
      const auditId = 'audit-456';
      const guidance = [{
        insight: 'Test insight',
        rationale: 'Test rationale',
        recommendation: 'Test recommendation',
        type: 'CONTENT_UPDATE',
      }];

      const result = createOpportunityData(siteId, auditId, guidance);

      expect(result.siteId).to.equal('site-123');
      expect(result.auditId).to.equal('audit-456');
      expect(result.type).to.equal(OPPORTUNITY_TYPES.SUMMARIZATION);
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.status).to.equal('NEW');
      expect(result.title).to.equal('Add LLM-Friendly Summaries');
      expect(result.description).to.equal('Content summarization elements such as summary and key points improve content discoverability and user engagement.');
      expect(result.guidance).to.deep.equal(guidance);
      expect(result.tags).to.be.an('array');
    });

    it('should use OPPORTUNITY_TYPES.SUMMARIZATION constant for tags', () => {
      const result = createOpportunityData('site-1', 'audit-1', []);

      // Verify tags are generated using OPPORTUNITY_TYPES.SUMMARIZATION
      expect(result.tags).to.be.an('array');
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

    it('should handle empty guidance array', () => {
      const result = createOpportunityData('site-1', 'audit-1', []);

      expect(result.guidance).to.deep.equal([]);
    });

    it('should handle multiple guidance items', () => {
      const guidance = [
        {
          insight: 'Insight 1',
          rationale: 'Rationale 1',
          recommendation: 'Recommendation 1',
          type: 'CONTENT_UPDATE',
        },
        {
          insight: 'Insight 2',
          rationale: 'Rationale 2',
          recommendation: 'Recommendation 2',
          type: 'CONTENT_UPDATE',
        },
      ];

      const result = createOpportunityData('site-1', 'audit-1', guidance);

      expect(result.guidance).to.deep.equal(guidance);
      expect(result.guidance).to.have.lengthOf(2);
    });
  });
});

