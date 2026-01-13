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
import { createOpportunityData } from '../../../src/llm-blocked/opportunity-data-mapper.js';

describe('LLM Blocked Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const props = {
        fullRobots: 'User-agent: *\nDisallow: /',
        numProcessedUrls: 100,
      };

      const result = createOpportunityData(props);

      expect(result).to.be.an('object');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result.title).to.include('Robots.txt');
      expect(result.title).to.include('AI crawlers');
      expect(result).to.have.property('description');
      expect(result.description).to.include('LLM user agents');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct guidance steps', () => {
      const props = {
        fullRobots: 'User-agent: *\nDisallow: /',
        numProcessedUrls: 50,
      };

      const result = createOpportunityData(props);

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(3);
      expect(result.guidance.steps[0]).to.include('Check each listed line number');
      expect(result.guidance.steps[1]).to.include('update the line');
      expect(result.guidance.steps[2]).to.include('intentionally blocked');
    });

    it('should include correct tags', () => {
      const props = {
        fullRobots: 'User-agent: *\nDisallow: /',
        numProcessedUrls: 100,
      };

      const result = createOpportunityData(props);

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('llm');
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('tech-geo');
    });

    it('should include fullRobots and numProcessedUrls in data', () => {
      const props = {
        fullRobots: 'User-agent: *\nDisallow: /admin',
        numProcessedUrls: 250,
      };

      const result = createOpportunityData(props);

      expect(result.data.fullRobots).to.equal('User-agent: *\nDisallow: /admin');
      expect(result.data.numProcessedUrls).to.equal(250);
    });

    it('should handle empty props', () => {
      const result = createOpportunityData({});

      expect(result.data).to.be.an('object');
      expect(result.data).to.have.property('fullRobots');
      expect(result.data).to.have.property('numProcessedUrls');
    });

    it('should have title mentioning robots.txt and AI crawlers', () => {
      const result = createOpportunityData({ fullRobots: '', numProcessedUrls: 0 });

      expect(result.title).to.include('Robots.txt');
      expect(result.title).to.include('AI crawlers');
    });

    it('should have description mentioning LLM user agents', () => {
      const result = createOpportunityData({ fullRobots: '', numProcessedUrls: 0 });

      expect(result.description).to.include('LLM user agents');
      expect(result.description).to.include('disallowed');
    });
  });
});

