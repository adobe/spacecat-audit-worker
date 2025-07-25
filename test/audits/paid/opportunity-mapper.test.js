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
import { describe } from 'mocha';
import { mapToPaidSuggestion, mapToPaidOpportunity } from '../../../src/paid/guidance-opportunity-mapper.js';

const TEST_SITE_ID = 'some-id';
const TEST_SITE = 'https://sample-page';

describe('Paid opportunity mapper', () => {
  it('handles plain markdown string', () => {
    const body = 'Simple markdown';
    const result = mapToPaidSuggestion({}, 'oppId', TEST_SITE_ID, TEST_SITE, { body: { markdown: body } });
    expect(result.data.suggestionValue).to.include('Simple markdown');
  });

  it('handles plain markdown string with double-escaped newlines', () => {
    const body = 'Line1\\nLine2\\nLine3';
    const result = mapToPaidSuggestion({}, 'oppId', TEST_SITE_ID, TEST_SITE, { body: { markdown: body } });
    expect(result.data.suggestionValue).to.include(`Line1
Line2
Line3`);
  });

  it('handles serialized JSON body with markdown', () => {
    const markdown = 'Markup with\nnewlines';
    const guidance = { body: { markdown } };
    const result = mapToPaidSuggestion({}, 'oppId', TEST_SITE_ID, TEST_SITE, guidance);
    expect(result.data.suggestionValue).to.include('Markup with\nnewlines');
  });

  it('handles serialized JSON body with double-escaped newlines in markdown', () => {
    const markdown = 'Markup with\\nnewlines';
    const guidance = { body: { markdown } };
    const result = mapToPaidSuggestion({}, 'oppId', TEST_SITE_ID, TEST_SITE, guidance);
    expect(result.data.suggestionValue).to.include(`Markup with
newlines`);
  });

  // Additional tests for mapToPaidOpportunity edge cases
  describe('Paid Opportunity Mapper edge cases', () => {
    const siteId = 'site';
    const url = 'https://example.com/page';
    const guidance = [{ insight: 'insight', rationale: 'rationale', recommendation: 'rec' }];

    it('returns default stats if url segment is missing', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          // No 'url' segment
          { key: 'pageType', value: [{ topURLs: [url], type: 'landing' }] },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(0);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0);
      expect(result.data.pageType).to.equal('landing');
    });

    it('returns default stats if url is not found in url segment', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'url',
            value: [{
              url: 'https://other.com/page', pageViews: 99, ctr: 0.9, bounceRate: 0.1,
            }],
          },
          { key: 'pageType', value: [{ topURLs: [url], type: 'landing' }] },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(0);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0);
      expect(result.data.pageType).to.equal('landing');
    });

    it('returns default pageType if pageType segment is missing', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'url',
            value: [{
              url, pageViews: 5, ctr: 0.2, bounceRate: 0.3,
            }],
          },
          // No 'pageType' segment
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(5);
      expect(result.data.ctr).to.equal(0.2);
      expect(result.data.bounceRate).to.equal(0.3);
      expect(result.data.pageType).to.equal('unknown');
    });

    it('returns default pageType if url is not found in pageType segment', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'url',
            value: [{
              url, pageViews: 5, ctr: 0.2, bounceRate: 0.3,
            }],
          },
          { key: 'pageType', value: [{ topURLs: ['https://other.com/page'], type: 'landing' }] },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(5);
      expect(result.data.ctr).to.equal(0.2);
      expect(result.data.bounceRate).to.equal(0.3);
      expect(result.data.pageType).to.equal('unknown');
    });
  });
});
