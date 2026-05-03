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

import { expect } from 'chai';
import { createOpportunityData } from '../../../src/llm-error-pages/opportunity-data-mapper.js';

describe('LLM Error Pages — createOpportunityData', () => {
  it('returns 404 bucket data', () => {
    const result = createOpportunityData({ statusCode: 404, totalErrors: 12 });
    expect(result.origin).to.equal('AUTOMATION');
    expect(result.title).to.equal('LLM Agents Hitting Missing Pages (404)');
    expect(result.description).to.include('404');
    expect(result.guidance.steps).to.be.an('array').that.is.not.empty;
    expect(result.tags).to.deep.equal(['isElmo', 'llm', 'Availability']);
    expect(result.data).to.deep.equal({ statusCode: 404, totalErrors: 12 });
  });

  it('returns 403 bucket data', () => {
    const result = createOpportunityData({ statusCode: 403, totalErrors: 7 });
    expect(result.title).to.equal('LLM Agents Blocked by Access Restrictions (403)');
    expect(result.description).to.include('403');
    expect(result.guidance.steps).to.be.an('array').that.is.not.empty;
    expect(result.data).to.deep.equal({ statusCode: 403, totalErrors: 7 });
  });

  it('returns 5xx bucket data', () => {
    const result = createOpportunityData({ statusCode: '5xx', totalErrors: 3 });
    expect(result.title).to.equal('LLM Agents Encountering Server Errors (5xx)');
    expect(result.description).to.include('server-side errors');
    expect(result.guidance.steps).to.be.an('array').that.is.not.empty;
    expect(result.data).to.deep.equal({ statusCode: '5xx', totalErrors: 3 });
  });

  it('shares common fields across all buckets', () => {
    for (const statusCode of [404, 403, '5xx']) {
      const result = createOpportunityData({ statusCode, totalErrors: 1 });
      expect(result.origin, `origin for ${statusCode}`).to.equal('AUTOMATION');
      expect(result.tags, `tags for ${statusCode}`).to.deep.equal(['isElmo', 'llm', 'Availability']);
      expect(result.guidance, `guidance for ${statusCode}`).to.be.an('object');
      expect(result.guidance.steps, `guidance.steps for ${statusCode}`).to.be.an('array');
    }
  });
});
