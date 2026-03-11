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
import { createOpportunityData } from '../../../src/cwv-trends-audit/opportunity-data-mapper.js';

describe('CWV Trends Opportunity Data Mapper', () => {
  it('creates mobile opportunity with correct title', () => {
    const result = createOpportunityData({ deviceType: 'mobile' });
    expect(result.title).to.equal('Mobile Web Performance Trends Report');
    expect(result.data.deviceType).to.equal('mobile');
  });

  it('creates desktop opportunity with correct title', () => {
    const result = createOpportunityData({ deviceType: 'desktop' });
    expect(result.title).to.equal('Desktop Web Performance Trends Report');
  });

  it('falls back to mobile title for unknown device type', () => {
    const result = createOpportunityData({ deviceType: 'unknown' });
    expect(result.title).to.equal('Mobile Web Performance Trends Report');
  });

  it('includes guidance, tags, origin, and data sources', () => {
    const result = createOpportunityData({ deviceType: 'mobile' });
    expect(result.origin).to.equal('AUTOMATION');
    expect(result.guidance.steps).to.be.an('array').that.is.not.empty;
    expect(result.tags).to.include('CWV');
    expect(result.data.dataSources).to.be.an('array').with.lengthOf(2);
    expect(result.description).to.be.a('string').that.is.not.empty;
  });
});
