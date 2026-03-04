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
import { createOpportunityData } from '../../../src/youtube-analysis/opportunity-data-mapper.js';

describe('YouTube Analysis Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should return all default values when opportunityData is empty', () => {
      const result = createOpportunityData({ opportunityData: {} });

      expect(result).to.deep.equal({
        runbook: 'https://adobe.sharepoint.com/sites/youtube-sentiment-analysis',
        origin: 'AUTOMATION',
        type: 'generic-opportunity',
        title: '[ʙᴇᴛᴀ] Cited YouTube Sentiment Analysis',
        description: 'YouTube sentiment analysis for cited videos.',
        status: 'NEW',
        tags: ['Video Content', 'social', 'Youtube', 'isElmo', 'Social Media'],
        data: { dataSources: ['Site', 'Page'] },
      });
    });

    it('should return all default values when called with no arguments', () => {
      const result = createOpportunityData();

      expect(result.runbook).to.equal('https://adobe.sharepoint.com/sites/youtube-sentiment-analysis');
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.type).to.equal('generic-opportunity');
      expect(result.title).to.equal('[ʙᴇᴛᴀ] Cited YouTube Sentiment Analysis');
      expect(result.description).to.equal('YouTube sentiment analysis for cited videos.');
      expect(result.status).to.equal('NEW');
    });

    it('should use values from opportunityData when provided', () => {
      const opportunityData = {
        runbook: 'https://custom-runbook.com',
        origin: 'ESS_OPS',
        type: 'custom-type',
        title: '[ʙᴇᴛᴀ] Cited YouTube Sentiment Analysis',
        description: 'Custom description for cited videos.',
        status: 'OPEN',
        tags: ['Custom', 'Tags'],
        data: { dataSources: ['Site', 'Page'], extra: 'field' },
      };

      const result = createOpportunityData({ opportunityData });

      expect(result).to.deep.equal(opportunityData);
    });

    it('should merge partial opportunityData with defaults', () => {
      const opportunityData = {
        title: '[ʙᴇᴛᴀ] Partial Title',
        origin: 'ESS_OPS',
      };

      const result = createOpportunityData({ opportunityData });

      expect(result.title).to.equal('[ʙᴇᴛᴀ] Partial Title');
      expect(result.origin).to.equal('ESS_OPS');
      expect(result.runbook).to.equal('https://adobe.sharepoint.com/sites/youtube-sentiment-analysis');
      expect(result.type).to.equal('generic-opportunity');
      expect(result.description).to.equal('YouTube sentiment analysis for cited videos.');
      expect(result.status).to.equal('NEW');
      expect(result.tags).to.deep.equal(['Video Content', 'social', 'Youtube', 'isElmo', 'Social Media']);
      expect(result.data).to.deep.equal({ dataSources: ['Site', 'Page'] });
    });

    it('should include correct default tags', () => {
      const result = createOpportunityData({ opportunityData: {} });

      expect(result.tags).to.be.an('array').with.lengthOf(5);
      expect(result.tags).to.include('Video Content');
      expect(result.tags).to.include('social');
      expect(result.tags).to.include('Youtube');
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('Social Media');
    });

    it('should include correct default data sources', () => {
      const result = createOpportunityData({ opportunityData: {} });

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.deep.equal(['Site', 'Page']);
    });

    it('should return default values when opportunityData is undefined', () => {
      const result = createOpportunityData({ opportunityData: undefined });

      expect(result.type).to.equal('generic-opportunity');
      expect(result.status).to.equal('NEW');
    });
  });
});
