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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { createFinalizeCrawlDetection } from '../../../src/internal-links/finalization.js';
import { filterByItemTypes, filterByStatusIfNeeded } from '../../../src/internal-links/result-utils.js';

use(chaiAsPromised);
use(sinonChai);

describe('internal-links finalization', () => {
  it('filters final links by configured status buckets and item types', async () => {
    const updateAuditResult = sinon.stub();
    updateAuditResult.resolves({});

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404', 'masked_by_linkchecker'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([
        { urlFrom: '/source', urlTo: '/500', itemType: 'link', statusBucket: 'server_error_5xx' },
        { urlFrom: '/source', urlTo: '/asset', itemType: 'image', statusBucket: 'not_found_404' },
      ]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().resolves({ status: 'complete' }),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    const audit = {
      getId: () => 'audit-1',
      getAuditResult: () => ({
        brokenInternalLinks: [
          { urlFrom: '/source', urlTo: '/404', itemType: 'link', statusBucket: 'not_found_404' },
        ],
      }),
    };

    const result = await finalize({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: { getId: () => 'site-1' },
      env: {},
      audit,
      dataAccess: {},
      linkCheckerResults: [
        { urlFrom: '/source', urlTo: '/lc', itemType: 'link', httpStatus: 404 },
      ],
    }, { skipCrawlDetection: false });

    expect(result).to.deep.equal({ status: 'complete' });
    expect(updateAuditResult).to.have.been.calledOnce;
    expect(updateAuditResult.firstCall.args[2]).to.deep.equal([
      { urlFrom: '/source', urlTo: '/404', itemType: 'link', statusBucket: 'not_found_404', priority: 'high' },
      {
        urlFrom: '/source',
        urlTo: '/lc',
        anchorText: '[no text]',
        itemType: 'link',
        detectionSource: 'linkchecker',
        trafficDomain: 1,
        httpStatus: 404,
        statusBucket: 'not_found_404',
        validity: 'UNKNOWN',
        priority: 'high',
      },
    ]);
    expect(updateAuditResult.firstCall.args[6]).to.have.property('internalLinksWorkflowCompletedAt');
  });

  it('preserves batch state when finalization fails before completion', async () => {
    const cleanupBatchState = sinon.stub().resolves();
    const updateAuditResult = sinon.stub().resolves({});
    const opportunityAndSuggestionsStep = sinon.stub().rejects(new Error('Opportunity sync failed'));

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState,
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      updateAuditResult,
      opportunityAndSuggestionsStep,
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    const log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    const audit = {
      getId: () => 'audit-1',
      getAuditResult: () => ({
        brokenInternalLinks: [
          { urlFrom: '/source', urlTo: '/404', itemType: 'link', statusBucket: 'not_found_404' },
        ],
      }),
    };

    await expect(finalize({
      log,
      site: { getId: () => 'site-1' },
      env: {},
      audit,
      dataAccess: {},
      linkCheckerResults: [],
    }, { skipCrawlDetection: false })).to.be.rejectedWith('Opportunity sync failed');

    expect(updateAuditResult).to.not.have.been.called;
    expect(cleanupBatchState).to.not.have.been.called;
    expect(log.warn).to.have.been.calledWith(
      sinon.match('Preserving batch state because finalization failed before successful completion'),
    );
  });

  it('disables event-loop wait and releases a held finalization lock when finalization later fails', async () => {
    const updateAuditResult = sinon.stub().resolves({});
    const tryAcquireFinalizationLock = sinon.stub().resolves('"finalization-lock-etag"');
    const releaseFinalizationLock = sinon.stub().resolves();

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      tryAcquireFinalizationLock,
      releaseFinalizationLock,
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().rejects(new Error('Opportunity sync failed')),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    const context = {
      callbackWaitsForEmptyEventLoop: true,
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: { getId: () => 'site-1' },
      env: {},
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
      },
      dataAccess: {},
      linkCheckerResults: [],
    };

    await expect(finalize(context, { skipCrawlDetection: true })).to.be.rejectedWith('Opportunity sync failed');

    expect(context.callbackWaitsForEmptyEventLoop).to.equal(false);
    expect(releaseFinalizationLock).to.have.been.calledWith(
      'audit-1',
      '"finalization-lock-etag"',
      sinon.match.object,
    );
  });

  it('filters LinkChecker results that do not belong to the audited host and scope', async () => {
    const updateAuditResult = sinon.stub().resolves({});

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().resolves({ status: 'complete' }),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    await finalize({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com/uk',
      },
      env: {},
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
      },
      dataAccess: {},
      linkCheckerResults: [
        { urlFrom: 'https://example.com/uk/source', urlTo: 'https://example.com/uk/missing', itemType: 'link', httpStatus: 404 },
        { urlFrom: 'https://other.example.com/uk/source', urlTo: 'https://other.example.com/uk/missing', itemType: 'link', httpStatus: 404 },
        { urlFrom: 'https://example.com/fr/source', urlTo: 'https://example.com/fr/missing', itemType: 'link', httpStatus: 404 },
      ],
    }, { skipCrawlDetection: false });

    expect(updateAuditResult.firstCall.args[2]).to.deep.equal([
      {
        urlFrom: 'https://example.com/uk/source',
        urlTo: 'https://example.com/uk/missing',
        anchorText: '[no text]',
        itemType: 'link',
        detectionSource: 'linkchecker',
        trafficDomain: 1,
        httpStatus: 404,
        statusBucket: 'not_found_404',
        validity: 'UNKNOWN',
        priority: 'high',
      },
    ]);
  });

  it('keeps shared same-host LinkChecker assets outside the locale subpath', async () => {
    const updateAuditResult = sinon.stub().resolves({});

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404'],
        getIncludedItemTypes: () => ['js'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().resolves({ status: 'complete' }),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    await finalize({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com/uk',
      },
      env: {},
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
      },
      dataAccess: {},
      linkCheckerResults: [
        {
          urlFrom: 'https://example.com/uk/source',
          urlTo: 'https://example.com/etc.clientlibs/app.js',
          itemType: 'js',
          httpStatus: 404,
          validity: 'INVALID',
        },
      ],
    }, { skipCrawlDetection: false });

    expect(updateAuditResult.firstCall.args[2]).to.deep.equal([
      {
        urlFrom: 'https://example.com/uk/source',
        urlTo: 'https://example.com/etc.clientlibs/app.js',
        anchorText: '[no text]',
        itemType: 'js',
        detectionSource: 'linkchecker',
        trafficDomain: 1,
        httpStatus: 404,
        statusBucket: 'not_found_404',
        validity: 'INVALID',
        priority: 'high',
      },
    ]);
  });

  it('drops LinkChecker rows without broken validity or broken status', async () => {
    const updateAuditResult = sinon.stub().resolves({});

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['masked_by_linkchecker', 'not_found_404'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().resolves({ status: 'complete' }),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    await finalize({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
      },
      env: {},
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
      },
      dataAccess: {},
      linkCheckerResults: [
        {
          urlFrom: 'https://example.com/source',
          urlTo: 'https://example.com/missing-unknown',
          itemType: 'link',
          validity: 'UNKNOWN',
          httpStatus: 'unknown',
        },
        {
          urlFrom: 'https://example.com/source',
          urlTo: 'https://example.com/missing-expired',
          itemType: 'link',
          validity: 'EXPIRED',
          httpStatus: '',
        },
        {
          urlFrom: 'https://example.com/source',
          urlTo: 'https://example.com/missing-invalid',
          itemType: 'link',
          validity: 'INVALID',
          httpStatus: '',
        },
      ],
    }, { skipCrawlDetection: false });

    expect(updateAuditResult.firstCall.args[2]).to.deep.equal([
      {
        urlFrom: 'https://example.com/source',
        urlTo: 'https://example.com/missing-invalid',
        anchorText: '[no text]',
        itemType: 'link',
        detectionSource: 'linkchecker',
        trafficDomain: 1,
        httpStatus: '',
        statusBucket: 'masked_by_linkchecker',
        validity: 'INVALID',
        priority: 'high',
      },
    ]);
  });

  it('acquires and releases the finalization lock even when crawl merge is skipped', async () => {
    const updateAuditResult = sinon.stub().resolves({});
    const tryAcquireFinalizationLock = sinon.stub().resolves('"finalization-lock-etag"');
    const releaseFinalizationLock = sinon.stub().resolves();

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      tryAcquireFinalizationLock,
      releaseFinalizationLock,
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().resolves({
        status: 'complete',
        reportedBrokenLinks: [],
      }),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    const context = {
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: { getId: () => 'site-1' },
      env: {},
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
      },
      dataAccess: {},
      linkCheckerResults: [],
    };

    const result = await finalize(context, { skipCrawlDetection: true });

    expect(result).to.deep.equal({
      status: 'complete',
      reportedBrokenLinks: [],
    });
    expect(tryAcquireFinalizationLock).to.have.been.calledOnce;
    expect(releaseFinalizationLock).to.have.been.calledWith(
      'audit-1',
      '"finalization-lock-etag"',
      sinon.match.object,
    );
  });

  it('persists LinkChecker completion metadata when provided by orchestration', async () => {
    const updateAuditResult = sinon.stub().resolves({});

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().resolves({ status: 'complete' }),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    await finalize({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
      env: {},
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
      },
      dataAccess: {},
      linkCheckerStatus: 'failed',
      linkCheckerError: 'Splunk auth failed',
      linkCheckerResults: [],
    }, { skipCrawlDetection: false });

    expect(updateAuditResult.firstCall.args[6]).to.include({
      internalLinksLinkCheckerStatus: 'failed',
      internalLinksLinkCheckerError: 'Splunk auth failed',
    });
  });

  it('filters out LinkChecker results with malformed URLs', async () => {
    const updateAuditResult = sinon.stub().resolves({});

    const finalize = createFinalizeCrawlDetection({
      auditType: 'broken-internal-links',
      createContextLogger: (log) => log,
      createConfigResolver: () => ({
        getIncludedStatusBuckets: () => ['not_found_404'],
        getIncludedItemTypes: () => ['link'],
      }),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      mergeAndDeduplicate: (firstLinks, secondLinks) => [...secondLinks, ...firstLinks],
      loadFinalResults: sinon.stub().resolves([]),
      cleanupBatchState: sinon.stub().resolves(),
      getTimeoutStatus: sinon.stub().returns({
        percentUsed: 1,
        safeTimeRemaining: 100000,
        isApproachingTimeout: false,
      }),
      updateAuditResult,
      opportunityAndSuggestionsStep: sinon.stub().resolves({ status: 'complete' }),
      filterByStatusIfNeeded,
      filterByItemTypes,
    });

    await finalize({
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
      },
      env: {},
      audit: {
        getId: () => 'audit-1',
        getAuditResult: () => ({ brokenInternalLinks: [] }),
      },
      dataAccess: {},
      linkCheckerResults: [
        { urlFrom: ':::invalid', urlTo: 'https://example.com/missing', itemType: 'link', httpStatus: 404 },
      ],
    }, { skipCrawlDetection: false });

    expect(updateAuditResult.firstCall.args[2]).to.deep.equal([]);
  });

  describe('LinkChecker re-validation', () => {
    let mockIsLinkInaccessible;
    let createFinalizeMocked;

    beforeEach(async () => {
      mockIsLinkInaccessible = sinon.stub();
      const mockedModule = await esmock(
        '../../../src/internal-links/finalization.js',
        {
          '../../../src/internal-links/helpers.js': {
            classifyStatusBucket: (status) => {
              if (status === 404) return 'not_found_404';
              return null;
            },
            isLinkInaccessible: mockIsLinkInaccessible,
          },
        },
      );
      createFinalizeMocked = mockedModule.createFinalizeCrawlDetection;
    });

    function buildFinalize(overrides = {}) {
      return createFinalizeMocked({
        auditType: 'broken-internal-links',
        createContextLogger: (log) => log,
        createConfigResolver: () => ({
          getIncludedStatusBuckets: () => ['not_found_404', 'masked_by_linkchecker'],
          getIncludedItemTypes: () => ['link'],
        }),
        calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
        mergeAndDeduplicate: (first, second) => [...second, ...first],
        loadFinalResults: sinon.stub().resolves([]),
        cleanupBatchState: sinon.stub().resolves(),
        getTimeoutStatus: sinon.stub().returns({
          percentUsed: 10,
          safeTimeRemaining: 600000,
          isApproachingTimeout: false,
        }),
        updateAuditResult: sinon.stub().resolves({}),
        opportunityAndSuggestionsStep: sinon.stub().resolves({ status: 'complete' }),
        filterByStatusIfNeeded,
        filterByItemTypes,
        ...overrides,
      });
    }

    function buildContext(linkCheckerResults = []) {
      return {
        log: {
          info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
        },
        site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
        env: {},
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({ brokenInternalLinks: [] }),
        },
        dataAccess: {},
        linkCheckerResults,
      };
    }

    it('should filter out LinkChecker links that are no longer broken', async () => {
      mockIsLinkInaccessible.withArgs('https://example.com/still-broken').resolves({
        isBroken: true, httpStatus: 404, statusBucket: 'not_found_404',
      });
      mockIsLinkInaccessible.withArgs('https://example.com/now-fixed').resolves({
        isBroken: false, httpStatus: 200, statusBucket: null,
      });

      const updateAuditResult = sinon.stub().resolves({});
      const finalize = buildFinalize({ updateAuditResult });

      await finalize(buildContext([
        {
          urlFrom: 'https://example.com/page', urlTo: 'https://example.com/still-broken', itemType: 'link', httpStatus: '404',
        },
        {
          urlFrom: 'https://example.com/page', urlTo: 'https://example.com/now-fixed', itemType: 'link', httpStatus: '404',
        },
      ]), { skipCrawlDetection: false });

      const reportedLinks = updateAuditResult.firstCall.args[2];
      const linkCheckerLinks = reportedLinks.filter((l) => l.detectionSource === 'linkchecker');
      expect(linkCheckerLinks).to.have.lengthOf(1);
      expect(linkCheckerLinks[0].urlTo).to.equal('https://example.com/still-broken');
    });

    it('should keep LinkChecker links when re-validation rejects (network error)', async () => {
      mockIsLinkInaccessible.rejects(new Error('Network error'));

      const updateAuditResult = sinon.stub().resolves({});
      const finalize = buildFinalize({ updateAuditResult });

      await finalize(buildContext([
        {
          urlFrom: 'https://example.com/page', urlTo: 'https://example.com/link', itemType: 'link', httpStatus: '404',
        },
      ]), { skipCrawlDetection: false });

      const reportedLinks = updateAuditResult.firstCall.args[2];
      const linkCheckerLinks = reportedLinks.filter((l) => l.detectionSource === 'linkchecker');
      expect(linkCheckerLinks).to.have.lengthOf(1);
    });

    it('should keep LinkChecker links when re-validation is inconclusive', async () => {
      mockIsLinkInaccessible.resolves({
        isBroken: false,
        inconclusive: true,
        httpStatus: null,
        statusBucket: null,
      });

      const updateAuditResult = sinon.stub().resolves({});
      const finalize = buildFinalize({ updateAuditResult });

      await finalize(buildContext([
        {
          urlFrom: 'https://example.com/page',
          urlTo: 'https://example.com/link',
          itemType: 'link',
          httpStatus: 404,
          statusBucket: 'not_found_404',
        },
      ]), { skipCrawlDetection: false });

      const reportedLinks = updateAuditResult.firstCall.args[2];
      const linkCheckerLinks = reportedLinks.filter((l) => l.detectionSource === 'linkchecker');
      expect(linkCheckerLinks).to.have.lengthOf(1);
      expect(linkCheckerLinks[0].httpStatus).to.equal(404);
      expect(linkCheckerLinks[0].statusBucket).to.equal('not_found_404');
    });

    it('should skip re-validation when insufficient time remains', async () => {
      const updateAuditResult = sinon.stub().resolves({});
      const getTimeoutStatus = sinon.stub().returns({
        percentUsed: 95,
        safeTimeRemaining: 30000,
        isApproachingTimeout: true,
      });
      const finalize = buildFinalize({ updateAuditResult, getTimeoutStatus });
      const ctx = buildContext([
        {
          urlFrom: 'https://example.com/page', urlTo: 'https://example.com/link', itemType: 'link', httpStatus: '404',
        },
      ]);

      await finalize(ctx, { skipCrawlDetection: false });

      expect(mockIsLinkInaccessible).to.not.have.been.called;
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match('Insufficient time for LinkChecker re-validation'),
      );
    });

    it('should fall back to original httpStatus/statusBucket when validation returns null', async () => {
      mockIsLinkInaccessible.resolves({
        isBroken: true, httpStatus: null, statusBucket: null,
      });

      const updateAuditResult = sinon.stub().resolves({});
      const finalize = buildFinalize({ updateAuditResult });

      await finalize(buildContext([
        {
          urlFrom: 'https://example.com/page', urlTo: 'https://example.com/broken', itemType: 'link', httpStatus: 404, statusBucket: 'not_found_404',
        },
      ]), { skipCrawlDetection: false });

      const reportedLinks = updateAuditResult.firstCall.args[2];
      const linkCheckerLinks = reportedLinks.filter((l) => l.detectionSource === 'linkchecker');
      expect(linkCheckerLinks).to.have.lengthOf(1);
      expect(linkCheckerLinks[0].httpStatus).to.equal(404);
      expect(linkCheckerLinks[0].statusBucket).to.equal('not_found_404');
    });

    it('should stop re-validation early when timeout approaches mid-loop', async () => {
      const getTimeoutStatus = sinon.stub();
      getTimeoutStatus.onFirstCall().returns({
        percentUsed: 10, safeTimeRemaining: 600000, isApproachingTimeout: false,
      });
      getTimeoutStatus.onSecondCall().returns({
        percentUsed: 10, safeTimeRemaining: 600000, isApproachingTimeout: false,
      });
      getTimeoutStatus.onThirdCall().returns({
        percentUsed: 98, safeTimeRemaining: 10000, isApproachingTimeout: true,
      });

      mockIsLinkInaccessible.resolves({ isBroken: true, httpStatus: 404, statusBucket: 'not_found_404' });

      const updateAuditResult = sinon.stub().resolves({});
      const finalize = buildFinalize({ updateAuditResult, getTimeoutStatus });

      const links = Array.from({ length: 10 }, (_, i) => ({
        urlFrom: `https://example.com/page${i}`,
        urlTo: `https://example.com/broken${i}`,
        itemType: 'link',
        httpStatus: '404',
      }));

      const ctx = buildContext(links);
      await finalize(ctx, { skipCrawlDetection: false });

      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match('LinkChecker re-validation stopping'),
      );
    });
  });
});
