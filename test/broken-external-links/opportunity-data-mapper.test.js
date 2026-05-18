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
import { createOpportunityData } from '../../src/broken-external-links/opportunity-data-mapper.js';

describe('broken-external-links opportunity-data-mapper', () => {
  it('returns an object with the expected shape', () => {
    const result = createOpportunityData();

    expect(result).to.be.an('object');
    expect(result.origin).to.equal('AUTOMATION');
    expect(result.title).to.be.a('string').and.not.be.empty;
    expect(result.description).to.be.a('string').and.not.be.empty;
    expect(result.runbook).to.be.a('string').and.not.be.empty;
    expect(result.guidance).to.be.an('object');
    expect(result.guidance.steps).to.be.an('array').with.length.greaterThan(0);
    expect(result.tags).to.be.an('array').that.includes('Engagement');
    expect(result.data).to.be.an('object');
    expect(result.data.dataSources).to.be.an('array').that.includes('SITE');
  });

  it('returns a new object on each call', () => {
    const first = createOpportunityData();
    const second = createOpportunityData();
    expect(first).to.not.equal(second);
  });
});
