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
import { createFinalizeCrawlDetection } from '../../../src/internal-links/finalization.js';
import { filterByItemTypes, filterByStatusIfNeeded } from '../../../src/internal-links/result-utils.js';

describe('internal-links finalization', () => {
  it('filters final links by configured status buckets and item types', async () => {
    const updateAuditResult = sinon.stub();
    updateAuditResult.onFirstCall().resolves({
      brokenInternalLinks: [
        { urlFrom: '/source', urlTo: '/404', itemType: 'link', statusBucket: 'not_found_404' },
        { urlFrom: '/source', urlTo: '/lc', itemType: 'link', statusBucket: 'masked_by_linkchecker' },
      ],
    });
    updateAuditResult.onSecondCall().resolves({});

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
    expect(updateAuditResult.firstCall.args[2]).to.deep.equal([
      { urlFrom: '/source', urlTo: '/404', itemType: 'link', statusBucket: 'not_found_404', priority: 'high' },
      {
        urlFrom: '/source',
        urlTo: '/lc',
        anchorText: '[no text]',
        itemType: 'link',
        detectionSource: 'linkchecker',
        trafficDomain: 0,
        httpStatus: 404,
        statusBucket: 'masked_by_linkchecker',
        priority: 'high',
      },
    ]);
  });
});
