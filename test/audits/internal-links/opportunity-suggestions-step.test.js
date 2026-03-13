/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { createOpportunityAndSuggestionsStep } from '../../../src/internal-links/opportunity-suggestions.js';

describe('internal-links opportunity suggestions step', () => {
  it('filters Mystique dispatch by configured item types', async () => {
    const sqs = { sendMessage: sinon.stub().resolves() };
    const opportunity = {
      getId: () => 'oppty-1',
    };

    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub().resolves(opportunity),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub().resolves(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves([]),
      BrightDataClient: { createFrom: sinon.stub() },
      buildLocaleSearchUrl: sinon.stub(),
      extractLocaleFromUrl: sinon.stub(),
      localesMatch: sinon.stub(),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const context = {
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({
          getHandlers: () => ({
            'broken-internal-links': {
              config: {
                mystiqueItemTypes: ['link'],
              },
            },
          }),
          getIncludedURLs: () => [],
        }),
      },
      finalUrl: 'https://example.com',
      sqs,
      env: {},
      dataAccess: {
        Suggestion: {
          allByOpportunityIdAndStatus: sinon.stub().resolves([
            {
              getData: () => ({
                urlFrom: 'https://example.com/source',
                urlTo: 'https://example.com/broken-link',
                itemType: 'link',
              }),
              getId: () => 'suggestion-1',
            },
            {
              getData: () => ({
                urlFrom: 'https://example.com/source',
                urlTo: 'https://example.com/broken-image.png',
                itemType: 'image',
              }),
              getId: () => 'suggestion-2',
            },
          ]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => 'https://example.com/alt-1' },
          ]),
        },
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().resolves([]),
        },
      },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          brokenInternalLinks: [
            { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-link', itemType: 'link' },
            { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-image.png', itemType: 'image' },
          ],
          success: true,
        }),
      },
      updatedAuditResult: {
        brokenInternalLinks: [
          { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-link', itemType: 'link' },
          { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-image.png', itemType: 'image' },
        ],
        success: true,
      },
    };

    const result = await step(context);

    expect(result).to.deep.equal({ status: 'complete' });
    expect(sqs.sendMessage.calledOnce).to.equal(true);
    const payload = sqs.sendMessage.firstCall.args[1];
    expect(payload.data.brokenLinks).to.have.lengthOf(1);
    expect(payload.data.brokenLinks[0].urlTo).to.equal('https://example.com/broken-link');
  });

  it('treats missing itemType as link for Mystique filtering', async () => {
    const sqs = { sendMessage: sinon.stub().resolves() };
    const opportunity = {
      getId: () => 'oppty-1',
    };

    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub().resolves(opportunity),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub().resolves(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves([]),
      BrightDataClient: { createFrom: sinon.stub() },
      buildLocaleSearchUrl: sinon.stub(),
      extractLocaleFromUrl: sinon.stub(),
      localesMatch: sinon.stub(),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const context = {
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({
          getHandlers: () => ({
            'broken-internal-links': {
              config: {
                mystiqueItemTypes: ['link'],
              },
            },
          }),
          getIncludedURLs: () => [],
        }),
      },
      finalUrl: 'https://example.com',
      sqs,
      env: {},
      dataAccess: {
        Suggestion: {
          allByOpportunityIdAndStatus: sinon.stub().resolves([
            {
              getData: () => ({
                urlFrom: 'https://example.com/source',
                urlTo: 'https://example.com/broken-link',
              }),
              getId: () => 'suggestion-1',
            },
          ]),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => 'https://example.com/alt-1' },
          ]),
        },
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().resolves([]),
        },
      },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          brokenInternalLinks: [
            { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-link' },
          ],
          success: true,
        }),
      },
      updatedAuditResult: {
        brokenInternalLinks: [
          { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-link' },
        ],
        success: true,
      },
    };

    await step(context);

    expect(sqs.sendMessage.calledOnce).to.equal(true);
    const payload = sqs.sendMessage.firstCall.args[1];
    expect(payload.data.brokenLinks).to.have.lengthOf(1);
    expect(payload.data.brokenLinks[0].urlTo).to.equal('https://example.com/broken-link');
  });
});
