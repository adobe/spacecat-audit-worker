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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };
import { brokenBacklinksSuggestions } from '../fixtures/broken-backlinks/suggestion.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

/**
 * Focused tests for the PLG suggestion alert in generateSuggestionData.
 * Kept separate from backlinks.test.js because that file's outer `before` block
 * mocks @adobe/mysticat-shared-seo-client which is not installed locally,
 * causing the entire describe to fail.
 */
// eslint-disable-next-line func-names
describe('generateSuggestionData - PLG suggestion alert', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  let generateSuggestionData;
  let sendLowSuggestionCountAlertStub;
  let context;
  let brokenBacklinksOpportunity;

  const auditUrl = 'https://audit.url';
  const topPages = [
    { getUrl: () => 'https://example.com/blog/page1' },
    { getUrl: () => 'https://example.com/blog/page2' },
  ];
  const contextSite = {
    getId: () => 'site-id',
    getDeliveryType: () => 'aem_cs',
    getBaseURL: () => 'https://example.com',
    getConfig: () => ({ getExcludedURLs: () => [] }),
    requiresValidation: false,
  };
  const audit = {
    getId: () => auditDataMock.id,
    getAuditType: () => 'broken-backlinks',
    getFullAuditRef: () => auditUrl,
    getAuditResult: sinon.stub().returns({
      success: true,
      brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
    }),
  };

  beforeEach(async () => {
    sendLowSuggestionCountAlertStub = sandbox.stub().resolves();

    const mockedHandler = await esmock('../../src/backlinks/handler.js', {
      '../../src/support/plg-suggestion-alert.js': {
        sendLowSuggestionCountAlert: sendLowSuggestionCountAlertStub,
      },
    }, {
      '@adobe/mysticat-shared-seo-client': {
        default: { createFrom: sandbox.stub().returns({ getBrokenBacklinks: sandbox.stub() }) },
      },
    });
    ({ generateSuggestionData } = mockedHandler);

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          SEO_API_BASE_URL: 'https://seo-api.example.com',
          SEO_API_KEY: 'test-seo-key',
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          S3_IMPORTER_BUCKET_NAME: 'test-import-bucket',
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        },
        audit,
        site: contextSite,
        finalUrl: auditUrl,
      })
      .build({ type: 'broken-backlinks', siteId: 'site-id' });

    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
    };

    brokenBacklinksOpportunity = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      save: sinon.stub(),
      getSuggestions: sinon.stub().returns([]),
      addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: brokenBacklinksSuggestions }),
      getType: () => 'broken-backlinks',
      setData: () => {},
      getData: () => {},
      setUpdatedBy: sinon.stub().returnsThis(),
      setLastAuditedAt: sinon.stub(),
    };

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([brokenBacklinksOpportunity]);
    context.dataAccess.Configuration.findLatest.resolves({
      isHandlerEnabledForSite: sandbox.stub().returns(true),
      getHandlers: sandbox.stub().returns({}),
    });
  });

  afterEach(() => sandbox.restore());

  it('passes only the NEW count to the alert when PENDING_VALIDATION suggestions are also present', async () => {
    const newSuggestions = [
      {
        getId: () => 'new-1',
        getStatus: () => 'NEW',
        getData: () => ({ url_from: 'https://from.com/1', url_to: 'https://example.com/page1' }),
      },
      {
        getId: () => 'new-2',
        getStatus: () => 'NEW',
        getData: () => ({ url_from: 'https://from.com/2', url_to: 'https://example.com/page2' }),
      },
    ];
    const pendingSuggestions = [
      {
        getId: () => 'pending-1',
        getStatus: () => 'PENDING_VALIDATION',
        getData: () => ({ url_from: 'https://from.com/p1', url_to: 'https://example.com/pending' }),
      },
    ];

    context.site = { ...contextSite, requiresValidation: true };
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .callsFake((_id, status) => (status === 'PENDING_VALIDATION'
        ? Promise.resolve(pendingSuggestions)
        : Promise.resolve(newSuggestions)));

    await generateSuggestionData(context);

    expect(sendLowSuggestionCountAlertStub).to.have.been.calledOnce;
    const [, , countArg] = sendLowSuggestionCountAlertStub.firstCall.args;
    expect(countArg).to.equal(2);
  });

  it('passes the full NEW count to the alert for PLG sites (no PENDING_VALIDATION)', async () => {
    const newSuggestions = [
      {
        getId: () => 'new-1',
        getStatus: () => 'NEW',
        getData: () => ({ url_from: 'https://from.com/1', url_to: 'https://example.com/page1' }),
      },
    ];

    context.site = { ...contextSite };
    context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
      .resolves(newSuggestions);

    await generateSuggestionData(context);

    expect(sendLowSuggestionCountAlertStub).to.have.been.calledOnce;
    const [, , countArg] = sendLowSuggestionCountAlertStub.firstCall.args;
    expect(countArg).to.equal(1);
  });
});
