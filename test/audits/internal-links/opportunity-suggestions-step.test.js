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

import { expect } from 'chai';
import sinon from 'sinon';
import { createOpportunityAndSuggestionsStep } from '../../../src/internal-links/opportunity-suggestions.js';

describe('internal-links opportunity suggestions step', () => {
  it('filters Mystique dispatch by configured item types', async () => {
    const sqs = { sendMessage: sinon.stub().resolves() };
    const opportunity = {
      getId: () => 'oppty-1',
      getType: () => 'broken-internal-links',
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

    expect(result.status).to.equal('complete');
    expect(result.reportedBrokenLinks).to.have.lengthOf(2);
    expect(sqs.sendMessage.calledOnce).to.equal(true);
    const payload = sqs.sendMessage.firstCall.args[1];
    expect(payload.data.brokenLinks).to.have.lengthOf(1);
    expect(payload.data.brokenLinks[0].urlTo).to.equal('https://example.com/broken-link');
  });

  it('treats missing itemType as link for Mystique filtering', async () => {
    const sqs = { sendMessage: sinon.stub().resolves() };
    const opportunity = {
      getId: () => 'oppty-1',
      getType: () => 'broken-internal-links',
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

    const result = await step(context);

    expect(result.status).to.equal('complete');
    expect(result.reportedBrokenLinks).to.have.lengthOf(1);
    expect(sqs.sendMessage.calledOnce).to.equal(true);
    const payload = sqs.sendMessage.firstCall.args[1];
    expect(payload.data.brokenLinks).to.have.lengthOf(1);
    expect(payload.data.brokenLinks[0].urlTo).to.equal('https://example.com/broken-link');
  });

  it('returns reportedBrokenLinks when the audit result is unsuccessful', async () => {
    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub(),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves([]),
      BrightDataClient: { createFrom: sinon.stub() },
      buildLocaleSearchUrl: sinon.stub(),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const result = await step({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getConfig: () => ({ getHandlers: () => ({}) }),
      },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          success: false,
          brokenInternalLinks: [
            { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-link', itemType: 'link' },
          ],
        }),
      },
      dataAccess: {},
      env: {},
    });

    expect(result).to.deep.equal({
      status: 'complete',
      reportedBrokenLinks: [
        { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-link', itemType: 'link' },
      ],
    });
  });

  it('returns reportedBrokenLinks when there are no broken internal links to process', async () => {
    const Opportunity = {
      allBySiteIdAndStatus: sinon.stub().resolves([]),
    };

    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub(),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves([]),
      BrightDataClient: { createFrom: sinon.stub() },
      buildLocaleSearchUrl: sinon.stub(),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const result = await step({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getConfig: () => ({ getHandlers: () => ({}) }),
      },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          success: true,
          brokenInternalLinks: [],
        }),
      },
      dataAccess: {
        Opportunity,
        Suggestion: { bulkUpdateStatus: sinon.stub().resolves() },
      },
      env: {},
    });

    expect(result).to.deep.equal({
      status: 'complete',
      reportedBrokenLinks: [],
    });
  });

  it('uses validated URLs when Bright Data URL validation is enabled and passes', async () => {
    const suggestionMock = {
      getData: sinon.stub().returns({
        urlFrom: 'https://example.com/source',
        urlTo: 'https://example.com/blog/seo-guide',
      }),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    const brightDataClient = {
      googleSearchWithFallback: sinon.stub().resolves({
        results: [{ link: 'https://example.com/blog/seo-tips' }],
        keywords: 'blog seo',
      }),
    };

    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub().resolves({ getId: () => 'oppty-1', getType: () => 'broken-internal-links' }),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub().resolves(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves(['https://example.com/blog/seo-tips']),
      BrightDataClient: { createFrom: sinon.stub().returns(brightDataClient) },
      buildLocaleSearchUrl: sinon.stub().returns('https://example.com'),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const context = {
      log: {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({
          getHandlers: () => ({
            'broken-internal-links': {
              config: { mystiqueItemTypes: ['link'], validateBrightDataUrls: true },
            },
          }),
          getIncludedURLs: () => [],
        }),
      },
      finalUrl: 'https://example.com',
      sqs: { sendMessage: sinon.stub().resolves() },
      env: { BRIGHT_DATA_API_KEY: 'key', BRIGHT_DATA_ZONE: 'zone' },
      dataAccess: {
        Suggestion: {
          allByOpportunityIdAndStatus: sinon.stub().resolves([{
            getData: () => ({
              urlFrom: 'https://example.com/source',
              urlTo: 'https://example.com/blog/seo-guide',
              itemType: 'link',
            }),
            getId: () => 'suggestion-1',
          }]),
          findById: sinon.stub().resolves(suggestionMock),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => 'https://example.com/alt-1' },
          ]),
        },
        Configuration: {
          findLatest: sinon.stub().returns({
            isHandlerEnabledForSite: sinon.stub().returns(true),
          }),
        },
      },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          brokenInternalLinks: [
            { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/blog/seo-guide', itemType: 'link' },
          ],
          success: true,
        }),
      },
      updatedAuditResult: {
        brokenInternalLinks: [
          { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/blog/seo-guide', itemType: 'link' },
        ],
        success: true,
      },
    };

    const result = await step(context);

    expect(result.status).to.equal('complete');
    expect(suggestionMock.setData.calledOnce).to.equal(true);
    const savedData = suggestionMock.setData.firstCall.args[0];
    expect(savedData.urlsSuggested).to.deep.equal(['https://example.com/blog/seo-tips']);
    expect(suggestionMock.save.calledOnce).to.equal(true);
  });

  it('drops out-of-subpath Bright Data suggestions before saving (SITES-49911)', async () => {
    const findById = sinon.stub();
    // Broken link lives under /uk; the SERP result is under /us (out of audit scope).
    const brightDataClient = {
      googleSearchWithFallback: sinon.stub().resolves({
        // Same slug as the broken link (scores > 0 so it survives SERP ranking) but a
        // different locale (/us) that is outside the /uk audit scope.
        results: [{ link: 'https://example.com/us/blog/seo-guide' }],
        keywords: 'blog seo',
      }),
    };

    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub().resolves({ getId: () => 'oppty-1', getType: () => 'broken-internal-links' }),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub().resolves(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves([]),
      BrightDataClient: { createFrom: sinon.stub().returns(brightDataClient) },
      buildLocaleSearchUrl: sinon.stub().returns('https://example.com/uk'),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const context = {
      log: {
        info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com/uk',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({
          getHandlers: () => ({
            'broken-internal-links': {
              config: { mystiqueItemTypes: ['link'], validateBrightDataUrls: true },
            },
          }),
          getIncludedURLs: () => [],
        }),
      },
      finalUrl: 'https://example.com/uk',
      sqs: { sendMessage: sinon.stub().resolves() },
      env: { BRIGHT_DATA_API_KEY: 'key', BRIGHT_DATA_ZONE: 'zone' },
      dataAccess: {
        Suggestion: {
          allByOpportunityIdAndStatus: sinon.stub().resolves([{
            getData: () => ({
              urlFrom: 'https://example.com/uk/source',
              urlTo: 'https://example.com/uk/blog/seo-guide',
              itemType: 'link',
            }),
            getId: () => 'suggestion-1',
          }]),
          findById,
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
        },
        Configuration: {
          findLatest: sinon.stub().returns({
            isHandlerEnabledForSite: sinon.stub().returns(true),
          }),
        },
      },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          brokenInternalLinks: [
            { urlFrom: 'https://example.com/uk/source', urlTo: 'https://example.com/uk/blog/seo-guide', itemType: 'link' },
          ],
          success: true,
        }),
      },
      updatedAuditResult: {
        brokenInternalLinks: [
          { urlFrom: 'https://example.com/uk/source', urlTo: 'https://example.com/uk/blog/seo-guide', itemType: 'link' },
        ],
        success: true,
      },
    };

    const result = await step(context);

    expect(result.status).to.equal('complete');
    // Out-of-subpath SERP result is dropped before we ever look up the suggestion.
    expect(findById).to.not.have.been.called;
  });

  it('logs warning and skips when Suggestion.findById returns null after Bright Data resolve', async () => {
    const brightDataClient = {
      googleSearchWithFallback: sinon.stub().resolves({
        results: [{ link: 'https://example.com/blog/seo-tips' }],
        keywords: 'blog seo',
      }),
    };

    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub().resolves({ getId: () => 'oppty-1' }),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub().resolves(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves([]),
      BrightDataClient: { createFrom: sinon.stub().returns(brightDataClient) },
      buildLocaleSearchUrl: sinon.stub().returns('https://example.com'),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const logStub = {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    };

    const context = {
      log: logStub,
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({
          getHandlers: () => ({
            'broken-internal-links': {
              config: { mystiqueItemTypes: ['link'] },
            },
          }),
          getIncludedURLs: () => [],
        }),
      },
      finalUrl: 'https://example.com',
      sqs: { sendMessage: sinon.stub().resolves() },
      env: { BRIGHT_DATA_API_KEY: 'key', BRIGHT_DATA_ZONE: 'zone' },
      dataAccess: {
        Suggestion: {
          allByOpportunityIdAndStatus: sinon.stub().resolves([{
            getData: () => ({
              urlFrom: 'https://example.com/source',
              urlTo: 'https://example.com/blog/seo-guide',
              itemType: 'link',
            }),
            getId: () => 'suggestion-1',
          }]),
          findById: sinon.stub().resolves(null),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => 'https://example.com/alt-1' },
          ]),
        },
        Configuration: {
          findLatest: sinon.stub().returns({
            isHandlerEnabledForSite: sinon.stub().returns(true),
          }),
        },
      },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          brokenInternalLinks: [
            { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/blog/seo-guide', itemType: 'link' },
          ],
          success: true,
        }),
      },
      updatedAuditResult: {
        brokenInternalLinks: [
          { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/blog/seo-guide', itemType: 'link' },
        ],
        success: true,
      },
    };

    const result = await step(context);

    expect(result.status).to.equal('complete');
    const warnCalls = logStub.warn.getCalls().map((c) => c.args[0]);
    expect(warnCalls.some((msg) => msg.includes('suggestion not found'))).to.equal(true);
  });

  it('loads both NEW and PENDING_VALIDATION suggestions when the site requires validation', async () => {
    const suggestionLookup = sinon.stub();
    suggestionLookup.onFirstCall().resolves([]);
    suggestionLookup.onSecondCall().resolves([]);

    const step = createOpportunityAndSuggestionsStep({
      auditType: 'broken-internal-links',
      opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
      suggestionStatuses: { NEW: 'NEW', OUTDATED: 'OUTDATED', PENDING_VALIDATION: 'PENDING_VALIDATION' },
      isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
      createContextLogger: (log) => log,
      calculateKpiDeltasForAudit: sinon.stub().returns({}),
      convertToOpportunity: sinon.stub().resolves({ getId: () => 'oppty-1' }),
      createOpportunityData: sinon.stub(),
      syncBrokenInternalLinksSuggestions: sinon.stub().resolves(),
      filterByAuditScope: (pages) => pages,
      extractPathPrefix: () => null,
      isUnscrapeable: () => false,
      filterBrokenSuggestedUrls: sinon.stub().resolves([]),
      BrightDataClient: { createFrom: sinon.stub() },
      buildLocaleSearchUrl: sinon.stub(),
      sleep: sinon.stub().resolves(),
      updateAuditResult: sinon.stub().resolves(),
      isCanonicalOrHreflangLink: () => false,
    });

    const result = await step({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        requiresValidation: true,
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getHandlers: () => ({}),
          getIncludedURLs: () => [],
        }),
      },
      finalUrl: 'https://example.com',
      sqs: { sendMessage: sinon.stub().resolves() },
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({
          success: true,
          brokenInternalLinks: [
            { urlFrom: 'https://example.com/source', urlTo: 'https://example.com/broken-link', itemType: 'link' },
          ],
        }),
      },
      dataAccess: {
        Suggestion: {
          allByOpportunityIdAndStatus: suggestionLookup,
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
        },
      },
      env: {},
    });

    expect(result.status).to.equal('complete');
    expect(suggestionLookup).to.have.been.calledTwice;
    expect(suggestionLookup.firstCall.args[1]).to.equal('NEW');
    expect(suggestionLookup.secondCall.args[1]).to.equal('PENDING_VALIDATION');
  });

  describe('resolves opportunity when no broken links are found', () => {
    const suggestionStatuses = {
      NEW: 'NEW',
      OUTDATED: 'OUTDATED',
      FIXED: 'FIXED',
      ERROR: 'ERROR',
      SKIPPED: 'SKIPPED',
      REJECTED: 'REJECTED',
      APPROVED: 'APPROVED',
      IN_PROGRESS: 'IN_PROGRESS',
      PENDING_VALIDATION: 'PENDING_VALIDATION',
    };

    // Runs the step with an existing RESOLVED-triggering opportunity carrying
    // the provided suggestions, and returns the bulkUpdateStatus stub.
    async function runResolveFlow(existingSuggestions) {
      const opportunity = {
        getId: () => 'oppty-existing',
        getType: () => 'broken-internal-links',
        setStatus: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves(existingSuggestions),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const Opportunity = {
        allBySiteIdAndStatus: sinon.stub().resolves([opportunity]),
      };
      const bulkUpdateStatus = sinon.stub().resolves();

      const step = createOpportunityAndSuggestionsStep({
        auditType: 'broken-internal-links',
        opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
        suggestionStatuses,
        isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
        createContextLogger: (log) => log,
        calculateKpiDeltasForAudit: sinon.stub().returns({}),
        convertToOpportunity: sinon.stub(),
        createOpportunityData: sinon.stub(),
        syncBrokenInternalLinksSuggestions: sinon.stub(),
        filterByAuditScope: (pages) => pages,
        extractPathPrefix: () => null,
        isUnscrapeable: () => false,
        filterBrokenSuggestedUrls: sinon.stub().resolves([]),
        BrightDataClient: { createFrom: sinon.stub() },
        buildLocaleSearchUrl: sinon.stub(),
        sleep: sinon.stub().resolves(),
        updateAuditResult: sinon.stub().resolves(),
        isCanonicalOrHreflangLink: () => false,
      });

      const result = await step({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.stub(),
        },
        site: {
          getId: () => 'site-1',
          getConfig: () => ({ getHandlers: () => ({}) }),
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({ success: true, brokenInternalLinks: [] }),
        },
        dataAccess: { Opportunity, Suggestion: { bulkUpdateStatus } },
        env: {},
      });

      return {
        result, opportunity, bulkUpdateStatus,
      };
    }

    it('outdates everything except SKIPPED and REJECTED on the RESOLVED path (SITES-44646)', async () => {
      const suggestions = [
        { getStatus: () => suggestionStatuses.NEW, id: 'new-1' },
        { getStatus: () => suggestionStatuses.PENDING_VALIDATION, id: 'pending-1' },
        { getStatus: () => suggestionStatuses.SKIPPED, id: 'skipped-1' },
        { getStatus: () => suggestionStatuses.REJECTED, id: 'rejected-1' },
        { getStatus: () => suggestionStatuses.FIXED, id: 'fixed-1' },
        { getStatus: () => suggestionStatuses.APPROVED, id: 'approved-1' },
        { getStatus: () => suggestionStatuses.IN_PROGRESS, id: 'in-progress-1' },
        { getStatus: () => suggestionStatuses.ERROR, id: 'error-1' },
      ];

      const { result, opportunity, bulkUpdateStatus } = await runResolveFlow(suggestions);

      expect(result).to.deep.equal({ status: 'complete', reportedBrokenLinks: [] });
      expect(opportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(bulkUpdateStatus).to.have.been.calledOnce;

      const [passedSuggestions, targetStatus] = bulkUpdateStatus.firstCall.args;
      expect(targetStatus).to.equal(suggestionStatuses.OUTDATED);
      const passedIds = passedSuggestions.map((s) => s.id);
      // Only SKIPPED and REJECTED are protected — pre-existing behavior for
      // everything else (NEW / PENDING_VALIDATION / FIXED / APPROVED /
      // IN_PROGRESS / ERROR) is preserved from before this PR.
      expect(passedIds).to.not.include.members(['skipped-1', 'rejected-1']);
      expect(passedIds).to.have.members([
        'new-1', 'pending-1', 'fixed-1', 'approved-1', 'in-progress-1', 'error-1',
      ]);
    });

    it('skips bulkUpdateStatus entirely when every existing suggestion is SKIPPED or REJECTED', async () => {
      const suggestions = [
        { getStatus: () => suggestionStatuses.SKIPPED, id: 'skipped-1' },
        { getStatus: () => suggestionStatuses.REJECTED, id: 'rejected-1' },
      ];

      const { opportunity, bulkUpdateStatus } = await runResolveFlow(suggestions);

      expect(opportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(bulkUpdateStatus).to.not.have.been.called;
    });

    it('handles getSuggestions returning null without throwing', async () => {
      const { opportunity, bulkUpdateStatus } = await runResolveFlow(null);

      expect(opportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(bulkUpdateStatus).to.not.have.been.called;
    });

    // Same RESOLVED flow but with a crawl-coverage manifest present (crawl run).
    // The manifest is reconstructed by loadScrapeResultPaths from an S3 read, so we
    // stub s3Client.send to return the URL->key entries for the crawled pages.
    async function runResolveFlowWithCoverage(existingSuggestions, crawledUrls, s3ClientOverride) {
      const opportunity = {
        getId: () => 'oppty-existing',
        getType: () => 'broken-internal-links',
        setStatus: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves(existingSuggestions),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const Opportunity = {
        allBySiteIdAndStatus: sinon.stub().resolves([opportunity]),
      };
      const bulkUpdateStatus = sinon.stub().resolves();
      const manifestBody = JSON.stringify(crawledUrls.map((u) => [u, 'scrapes/x.json']));
      const s3Client = s3ClientOverride || {
        send: sinon.stub().resolves({
          Body: { transformToString: async () => manifestBody },
        }),
      };

      const step = createOpportunityAndSuggestionsStep({
        auditType: 'broken-internal-links',
        opptyStatuses: { NEW: 'NEW', RESOLVED: 'RESOLVED' },
        suggestionStatuses,
        isNonEmptyArray: (value) => Array.isArray(value) && value.length > 0,
        createContextLogger: (log) => log,
        calculateKpiDeltasForAudit: sinon.stub().returns({}),
        convertToOpportunity: sinon.stub(),
        createOpportunityData: sinon.stub(),
        syncBrokenInternalLinksSuggestions: sinon.stub(),
        filterByAuditScope: (pages) => pages,
        extractPathPrefix: () => null,
        isUnscrapeable: () => false,
        filterBrokenSuggestedUrls: sinon.stub().resolves([]),
        BrightDataClient: { createFrom: sinon.stub() },
        buildLocaleSearchUrl: sinon.stub(),
        sleep: sinon.stub().resolves(),
        updateAuditResult: sinon.stub().resolves(),
        isCanonicalOrHreflangLink: () => false,
      });

      const result = await step({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.stub(),
        },
        site: {
          getId: () => 'site-1',
          getConfig: () => ({ getHandlers: () => ({}) }),
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({ success: true, brokenInternalLinks: [] }),
        },
        dataAccess: { Opportunity, Suggestion: { bulkUpdateStatus } },
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
        s3Client,
      });

      return { result, opportunity, bulkUpdateStatus };
    }

    const covSug = (status, urlFrom, id) => ({
      getStatus: () => status,
      getData: () => ({ urlFrom }),
      id,
    });

    it('coverage-gates the RESOLVED path: outdates only crawled suggestions and holds the opportunity open when some pages were not crawled (SITES-49911)', async () => {
      const suggestions = [
        covSug(suggestionStatuses.NEW, 'https://example.com/crawled', 'covered-1'),
        covSug(suggestionStatuses.NEW, 'https://example.com/not-crawled', 'uncovered-1'),
      ];

      const { opportunity, bulkUpdateStatus } = await runResolveFlowWithCoverage(
        suggestions,
        ['https://example.com/crawled'],
      );

      // Only the crawled suggestion is outdated.
      expect(bulkUpdateStatus).to.have.been.calledOnce;
      const [passed, target] = bulkUpdateStatus.firstCall.args;
      expect(target).to.equal(suggestionStatuses.OUTDATED);
      expect(passed.map((s) => s.id)).to.deep.equal(['covered-1']);
      // An unconfirmed (uncrawled) suggestion remains -> opportunity is NOT resolved.
      expect(opportunity.setStatus).to.not.have.been.called;
      expect(opportunity.save).to.not.have.been.called;
    });

    it('resolves and outdates all suggestions when every page was crawled this run (SITES-49911)', async () => {
      const suggestions = [
        covSug(suggestionStatuses.NEW, 'https://example.com/a', 'a'),
        covSug(suggestionStatuses.NEW, 'https://example.com/b', 'b'),
      ];

      const { opportunity, bulkUpdateStatus } = await runResolveFlowWithCoverage(
        suggestions,
        ['https://example.com/a', 'https://example.com/b'],
      );

      expect(bulkUpdateStatus).to.have.been.calledOnce;
      expect(bulkUpdateStatus.firstCall.args[0].map((s) => s.id)).to.have.members(['a', 'b']);
      expect(bulkUpdateStatus.firstCall.args[1]).to.equal(suggestionStatuses.OUTDATED);
      expect(opportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(opportunity.save).to.have.been.called;
    });

    it('treats an empty crawl manifest as no coverage and preserves prior RESOLVED behavior (SITES-49911)', async () => {
      const suggestions = [
        covSug(suggestionStatuses.NEW, 'https://example.com/a', 'a'),
        covSug(suggestionStatuses.SKIPPED, 'https://example.com/b', 'b'),
      ];

      const { opportunity, bulkUpdateStatus } = await runResolveFlowWithCoverage(
        suggestions,
        [],
      );

      // Empty manifest => no crawl coverage => prior behavior: resolve and outdate
      // every non-frozen suggestion.
      expect(bulkUpdateStatus).to.have.been.calledOnce;
      expect(bulkUpdateStatus.firstCall.args[0].map((s) => s.id)).to.deep.equal(['a']);
      expect(opportunity.setStatus).to.have.been.calledWith('RESOLVED');
    });

    it('holds the opportunity open and outdates nothing when no suggestion page was crawled (SITES-49911)', async () => {
      const suggestions = [
        covSug(suggestionStatuses.NEW, 'https://example.com/x', 'x'),
        covSug(suggestionStatuses.NEW, 'https://example.com/y', 'y'),
      ];

      const { opportunity, bulkUpdateStatus } = await runResolveFlowWithCoverage(
        suggestions,
        ['https://example.com/unrelated'],
      );

      // Crawl run, but none of the suggestions' source pages were covered ->
      // nothing is outdated and the opportunity is NOT resolved.
      expect(bulkUpdateStatus).to.not.have.been.called;
      expect(opportunity.setStatus).to.not.have.been.called;
      expect(opportunity.save).to.not.have.been.called;
    });

    it('falls back to prior RESOLVED behavior when the crawl manifest read throws (SITES-49911)', async () => {
      const suggestions = [covSug(suggestionStatuses.NEW, 'https://example.com/a', 'a')];
      const throwingS3 = { send: sinon.stub().rejects(new Error('s3 down')) };

      const { opportunity, bulkUpdateStatus } = await runResolveFlowWithCoverage(
        suggestions,
        [],
        throwingS3,
      );

      // Manifest read error => treat as no coverage => prior resolve + outdate-all.
      expect(opportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(bulkUpdateStatus).to.have.been.calledOnce;
      expect(bulkUpdateStatus.firstCall.args[0].map((s) => s.id)).to.deep.equal(['a']);
    });
  });
});
