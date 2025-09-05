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
import sinon from 'sinon';
import { describe } from 'mocha';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { mapToPaidSuggestion, mapToPaidOpportunity } from '../../../src/paid-cookie-consent/guidance-opportunity-mapper.js';

const TEST_SITE_ID = 'some-id';
const TEST_SITE = 'https://sample-page';

describe('Paid Cookie Consent opportunity mapper', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Mock ScrapeClient
    const mockScrapeClient = {
      getScrapeJobUrlResults: sandbox.stub().resolves([{
        path: 'path/to/scrape.json',
      }]),
    };
    sandbox.stub(ScrapeClient, 'createFrom').returns(mockScrapeClient);
  });

  afterEach(() => {
    sandbox.restore();
  });
  it('handles plain markdown string', async () => {
    const body = 'Simple markdown';
    const context = { env: {}, dataAccess: {} };
    const guidance = { body: { markdown: body }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.suggestionValue).to.include('Simple markdown');
  });

  it('handles plain markdown string with double-escaped newlines', async () => {
    const body = 'Line1\\nLine2\\nLine3';
    const context = { env: {}, dataAccess: {} };
    const guidance = { body: { markdown: body }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.suggestionValue).to.include(`Line1
Line2
Line3`);
  });

  it('handles serialized JSON body with markdown', async () => {
    const markdown = 'Markup with\nnewlines';
    const context = { env: {}, dataAccess: {} };
    const guidance = { body: { markdown }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.suggestionValue).to.include('Markup with\nnewlines');
  });

  it('handles serialized JSON body with double-escaped newlines in markdown', async () => {
    const markdown = 'Markup with\\nnewlines';
    const context = { env: {}, dataAccess: {} };
    const guidance = { body: { markdown }, metadata: { scrape_job_id: 'test-job' } };
    const result = await mapToPaidSuggestion(context, TEST_SITE_ID, 'oppId', TEST_SITE, guidance);
    expect(result.data.suggestionValue).to.include(`Markup with
newlines`);
  });

  // Additional tests for mapToPaidOpportunity edge cases
  describe('Paid Opportunity Mapper edge cases', () => {
    const siteId = 'site';
    const url = 'https://example.com/page';
    const guidance = [{ insight: 'insight', rationale: 'rationale', recommendation: 'rec' }];

    it('returns default stats if urlConsent segment is missing', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          // No 'urlConsent' segment
          { key: 'url', value: [{ url, pageViews: 100, bounceRate: 0.5 }] },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(0);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0);
      expect(result.data.projectedTrafficLost).to.equal(0);
    });

    it('returns default stats if url is not found in urlConsent segment', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'urlConsent',
            value: [{
              url: 'https://other.com/page', pageViews: 99, bounceRate: 0.1, projectedTrafficLost: 9.9, consent: 'show',
            }],
          },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(0);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0);
      expect(result.data.projectedTrafficLost).to.equal(0);
    });

    it('formats large numbers with K suffix in description', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'urlConsent',
            value: [{
              url, pageViews: 10000, bounceRate: 0.8, projectedTrafficLost: 8000, consent: 'show',
            }],
          },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      // projectedTrafficLost 8000 should be formatted as 8.0K
      expect(result.description).to.include('8.0K');
      expect(result.description).to.include('80.0% of paid traffic bounces');
    });

    it('keeps small numbers unformatted in description', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'urlConsent',
            value: [{
              url, pageViews: 500, bounceRate: 0.6, projectedTrafficLost: 300, consent: 'show',
            }],
          },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      // projectedTrafficLost 300 should stay as 300
      expect(result.description).to.include('300)');
      expect(result.description).to.include('60.0% of paid traffic bounces');
    });

    it('uses data from urlConsent segment correctly', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'urlConsent',
            value: [{
              url, pageViews: 5, bounceRate: 0.3, projectedTrafficLost: 1.5, consent: 'show',
            }],
          },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(5);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0.3);
      expect(result.data.projectedTrafficLost).to.equal(1.5);
    });

    it('calculates projectedTrafficLost as fallback when missing', () => {
      const audit = {
        getAuditId: () => 'aid',
        getAuditResult: () => [
          {
            key: 'urlConsent',
            value: [{
              url, pageViews: 100, bounceRate: 0.4, consent: 'show',
              // projectedTrafficLost missing - should calculate as bounceRate * pageViews
            }],
          },
        ],
      };
      const result = mapToPaidOpportunity(siteId, url, audit, guidance);
      expect(result.data.pageViews).to.equal(100);
      expect(result.data.ctr).to.equal(0);
      expect(result.data.bounceRate).to.equal(0.4);
      expect(result.data.projectedTrafficLost).to.equal(40); // 0.4 * 100
    });
  });
});
