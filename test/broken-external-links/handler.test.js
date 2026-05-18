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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

const AUDIT_URL = 'https://example.com';

const HTML_WITH_BROKEN_LINKS = `
  <html><body>
    <a href="https://broken.com/404">broken 404</a>
    <a href="https://also-broken.com/500">broken 500</a>
    <a href="https://working.com/ok">working</a>
  </body></html>
`;

const HTML_WITH_ALL_OK_EXTERNAL_LINKS = `
  <html><body>
    <a href="https://working.com/ok">working</a>
    <a href="https://working2.com/ok2">working2</a>
  </body></html>
`;

const HTML_WITH_NO_EXTERNAL_LINKS = `
  <html><body>
    <a href="/internal">internal</a>
    <a href="https://example.com/page">same domain</a>
  </body></html>
`;

describe('broken-external-links handler', () => {
  let sandbox;
  let context;
  let site;
  let convertToOpportunityStub;
  let syncSuggestionsStub;
  let handlerModule;
  let mockOpportunity;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockOpportunity = {
      getId: sandbox.stub().returns('opp-123'),
      getType: sandbox.stub().returns('broken-external-links'),
    };

    convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
    syncSuggestionsStub = sandbox.stub().resolves();

    handlerModule = await esmock('../../src/broken-external-links/handler.js', {
      '../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
      '../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              { getURL: () => 'https://example.com/page1' },
            ]),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves(mockOpportunity),
          },
          Suggestion: {
            saveMany: sandbox.stub().resolves(),
            bulkUpdateStatus: sandbox.stub().resolves(),
            allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
          },
        },
      })
      .build();

    site = context.site;
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  describe('brokenExternalLinksRunner', () => {
    it('happy path: finds broken links, creates opportunity and suggestions', async () => {
      nock('https://example.com').get('/page1').reply(200, HTML_WITH_BROKEN_LINKS);
      nock('https://broken.com').get('/404').reply(404);
      nock('https://also-broken.com').get('/500').reply(500);
      nock('https://working.com').get('/ok').reply(200);

      const result = await handlerModule.brokenExternalLinksRunner(AUDIT_URL, context, site);

      expect(result.fullAuditRef).to.equal(AUDIT_URL);
      expect(result.auditData.totalBrokenLinks).to.equal(2);
      expect(result.auditData.brokenLinksBySrcPage).to.have.length(1);
      expect(result.auditData.brokenLinksBySrcPage[0].pageUrl).to.equal('https://example.com/page1');
      expect(result.auditData.brokenLinksBySrcPage[0].brokenLinks).to.have.length(2);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      // Verify inline functions passed to syncSuggestions are correct
      const callArgs = syncSuggestionsStub.firstCall.args[0];
      expect(callArgs.opportunity).to.equal(mockOpportunity);
      expect(callArgs.newData).to.be.an('array').with.length(2);

      // Test buildKey inline function
      const buildKey = callArgs.buildKey;
      expect(buildKey({ url: 'https://broken.com/404' })).to.equal('https://broken.com/404');

      // Test mapNewSuggestion inline function
      const mapNewSuggestion = callArgs.mapNewSuggestion;
      const mapped = mapNewSuggestion({
        url: 'https://broken.com/404',
        status: 404,
        urlFrom: ['https://example.com/page1'],
      });
      expect(mapped.opportunityId).to.equal('opp-123');
      expect(mapped.type).to.equal('REDIRECT_UPDATE');
      expect(mapped.rank).to.equal(404);
      expect(mapped.data.url).to.equal('https://broken.com/404');
      expect(mapped.data.status).to.equal(404);
      expect(mapped.data.urlFrom).to.deep.equal(['https://example.com/page1']);
    });

    it('external links present but all ok: does not create opportunity', async () => {
      nock('https://example.com').get('/page1').reply(200, HTML_WITH_ALL_OK_EXTERNAL_LINKS);
      nock('https://working.com').get('/ok').reply(200);
      nock('https://working2.com').get('/ok2').reply(200);

      const result = await handlerModule.brokenExternalLinksRunner(AUDIT_URL, context, site);

      expect(result.auditData.totalBrokenLinks).to.equal(0);
      expect(convertToOpportunityStub).to.not.have.been.called;
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('page with only internal links: skips external check, no opportunity', async () => {
      nock('https://example.com').get('/page1').reply(200, HTML_WITH_NO_EXTERNAL_LINKS);

      const result = await handlerModule.brokenExternalLinksRunner(AUDIT_URL, context, site);

      expect(result.auditData.totalBrokenLinks).to.equal(0);
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('empty top-pages: returns zero broken links and does not create opportunity', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await handlerModule.brokenExternalLinksRunner(AUDIT_URL, context, site);

      expect(result.auditData.totalBrokenLinks).to.equal(0);
      expect(result.auditData.brokenLinksBySrcPage).to.deep.equal([]);
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('fetch error on page: warns and skips to next page without throwing', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getURL: () => 'https://example.com/bad-page' },
        { getURL: () => 'https://example.com/good-page' },
      ]);
      nock('https://example.com').get('/bad-page').replyWithError('connection refused');
      nock('https://example.com').get('/good-page').reply(200, HTML_WITH_NO_EXTERNAL_LINKS);

      const result = await handlerModule.brokenExternalLinksRunner(AUDIT_URL, context, site);

      expect(result.auditData.totalBrokenLinks).to.equal(0);
      expect(context.log.warn).to.have.been.calledOnce;
      expect(convertToOpportunityStub).to.not.have.been.called;
    });

    it('non-200 page response: skips page and does not create opportunity', async () => {
      nock('https://example.com').get('/page1').reply(404, 'Not Found');

      const result = await handlerModule.brokenExternalLinksRunner(AUDIT_URL, context, site);

      expect(result.auditData.totalBrokenLinks).to.equal(0);
      expect(convertToOpportunityStub).to.not.have.been.called;
    });
  });

  describe('buildSuggestions', () => {
    it('aggregates broken links by unique broken URL, collecting all source pages', () => {
      const brokenLinksBySrcPage = [
        {
          pageUrl: 'https://example.com/p1',
          brokenLinks: [
            { url: 'https://broken.com/a', status: 404 },
            { url: 'https://broken.com/b', status: 500 },
          ],
        },
        {
          pageUrl: 'https://example.com/p2',
          brokenLinks: [
            { url: 'https://broken.com/a', status: 404 },
          ],
        },
      ];

      const result = handlerModule.buildSuggestions(brokenLinksBySrcPage);

      expect(result).to.have.length(2);

      const urlA = result.find((r) => r.url === 'https://broken.com/a');
      expect(urlA).to.exist;
      expect(urlA.status).to.equal(404);
      expect(urlA.urlFrom).to.deep.equal([
        'https://example.com/p1',
        'https://example.com/p2',
      ]);

      const urlB = result.find((r) => r.url === 'https://broken.com/b');
      expect(urlB).to.exist;
      expect(urlB.status).to.equal(500);
      expect(urlB.urlFrom).to.deep.equal(['https://example.com/p1']);
    });

    it('returns empty array when input is empty', () => {
      expect(handlerModule.buildSuggestions([])).to.deep.equal([]);
    });

    it('handles single page with single broken link', () => {
      const input = [{
        pageUrl: 'https://example.com/page',
        brokenLinks: [{ url: 'https://broken.com/x', status: 404 }],
      }];
      const result = handlerModule.buildSuggestions(input);
      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://broken.com/x');
      expect(result[0].urlFrom).to.deep.equal(['https://example.com/page']);
    });
  });
});
