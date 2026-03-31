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
import { createOpportunityData } from '../../../src/product-metatags/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Product Metatags Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const result = createOpportunityData({
        detectedTags: { '/page1': {} },
        projectedTrafficLost: 1000,
      });

      expect(result.runbook).to.be.a('string');
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.title).to.be.a('string');
      expect(result.description).to.be.a('string');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result.tags).to.be.an('array');
      expect(result.data).to.have.property('detectedTags');
      expect(result.data).to.have.property('projectedTrafficLost', 1000);
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });

    it('should include magentoEnvironmentId when provided', () => {
      const result = createOpportunityData({
        magentoEnvironmentId: 'magento-env-123',
        projectedTrafficLost: 500,
      });

      expect(result.data).to.have.property('magentoEnvironmentId', 'magento-env-123');
      expect(result.data).to.have.property('projectedTrafficLost', 500);
      expect(result.data.dataSources).to.deep.equal([
        DATA_SOURCES.AHREFS,
        DATA_SOURCES.RUM,
        DATA_SOURCES.SITE,
      ]);
    });

    it('should not include magentoEnvironmentId when not provided', () => {
      const result = createOpportunityData({
        projectedTrafficValue: 200,
      });

      expect(result.data).to.not.have.property('magentoEnvironmentId');
      expect(result.data).to.have.property('projectedTrafficValue', 200);
    });

    it('should not include magentoEnvironmentId when null', () => {
      const result = createOpportunityData({
        magentoEnvironmentId: null,
        detectedTags: {},
      });

      expect(result.data).to.not.have.property('magentoEnvironmentId');
      expect(result.data).to.have.property('detectedTags');
    });

    it('should not include magentoEnvironmentId when empty string', () => {
      const result = createOpportunityData({
        magentoEnvironmentId: '',
        detectedTags: {},
      });

      expect(result.data).to.not.have.property('magentoEnvironmentId');
    });

    it('should work with minimal props', () => {
      const result = createOpportunityData();

      expect(result.runbook).to.be.a('string');
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.data).to.have.property('dataSources');
      expect(result.data.dataSources).to.deep.equal([
        DATA_SOURCES.AHREFS,
        DATA_SOURCES.RUM,
        DATA_SOURCES.SITE,
      ]);
    });

    it('should spread all other props into data', () => {
      const result = createOpportunityData({
        detectedTags: { '/page1': {}, '/page2': {} },
        extractedTags: { customTag: 'value' },
        sourceS3Folder: 's3://bucket/path/',
        projectedTrafficLost: 1500,
        projectedTrafficValue: 3000,
      });

      expect(result.data).to.have.property('detectedTags');
      expect(result.data).to.have.property('extractedTags');
      expect(result.data).to.have.property('sourceS3Folder');
      expect(result.data).to.have.property('projectedTrafficLost', 1500);
      expect(result.data).to.have.property('projectedTrafficValue', 3000);
    });
  });
});
