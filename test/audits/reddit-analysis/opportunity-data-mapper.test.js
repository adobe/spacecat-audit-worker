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
import { createOpportunityData } from '../../../src/reddit-analysis/opportunity-data-mapper.js';

describe('Reddit Analysis Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with defaults when no opportunityData provided', () => {
      const result = createOpportunityData({});

      expect(result.origin).to.equal('AUTOMATION');
      expect(result.type).to.equal('reddit-analysis');
      expect(result.status).to.equal('NEW');
      expect(result.runbook).to.equal('');
      expect(result.title).to.equal('Reddit presence: Improve brand sentiment and visibility');
    });

    it('should use values from opportunityData when provided', () => {
      const opportunityData = {
        title: '[ʙᴇᴛᴀ] Reddit Sentiment Analysis - Cited',
        description: 'Custom description',
        runbook: 'https://adobe.sharepoint.com/sites/reddit-analysis',
        status: 'IN_PROGRESS',
        tags: ['Reddit', 'Social Media'],
        data: { dataSources: ['Site'] },
      };

      const result = createOpportunityData({ opportunityData });

      expect(result.title).to.equal(opportunityData.title);
      expect(result.description).to.equal(opportunityData.description);
      expect(result.runbook).to.equal(opportunityData.runbook);
      expect(result.status).to.equal(opportunityData.status);
      expect(result.tags).to.deep.equal(['Reddit', 'Social Media', 'isElmo', 'earned']);
      expect(result.data.dataSources).to.deep.equal(['Site', 'Page']);
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.type).to.equal('reddit-analysis');
    });

    it('should include correct default title and description', () => {
      const result = createOpportunityData({});

      expect(result.title).to.equal('Reddit presence: Improve brand sentiment and visibility');
      expect(result.description).to.include('Reddit');
      expect(result.description).to.include('brand sentiment');
    });

    it('should include correct default tags', () => {
      const result = createOpportunityData({});

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('Reddit');
      expect(result.tags).to.include('earned');
    });

    it('should include default data sources', () => {
      const result = createOpportunityData({});

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.be.an('array');
      expect(result.data.dataSources).to.have.lengthOf(2);
    });

    it('should merge dataSources when opportunityData.data exists without dataSources', () => {
      const opportunityData = {
        data: { customField: 'value' },
      };

      const result = createOpportunityData({ opportunityData });

      expect(result.data.customField).to.equal('value');
      expect(result.data.dataSources).to.deep.equal(['Site', 'Page']);
    });

    it('should deduplicate tags when opportunityData contains defaults', () => {
      const opportunityData = {
        tags: ['isElmo', 'Reddit', 'earned', 'custom'],
      };

      const result = createOpportunityData({ opportunityData });

      expect(result.tags).to.deep.equal(['isElmo', 'Reddit', 'earned', 'custom']);
    });

    it('should deduplicate dataSources when opportunityData contains defaults', () => {
      const opportunityData = {
        data: { dataSources: ['Site', 'Page', 'GSC'] },
      };

      const result = createOpportunityData({ opportunityData });

      expect(result.data.dataSources).to.deep.equal(['Site', 'Page', 'GSC']);
    });

    it('should handle empty call gracefully', () => {
      const result = createOpportunityData();

      expect(result.origin).to.equal('AUTOMATION');
      expect(result.type).to.equal('reddit-analysis');
      expect(result.status).to.equal('NEW');
    });
  });
});
