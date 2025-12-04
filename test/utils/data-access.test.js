/*
 * Copyright 2024 Adobe. All rights reserved.
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
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import {
  retrieveSiteBySiteId,
  syncSuggestions,
  getImsOrgId,
  retrieveAuditById,
  keepSameDataFunction,
  keepLatestMergeDataFunction,
} from '../../src/utils/data-access.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('data-access', () => {
  describe('retrieveSiteBySiteId', () => {
    let mockDataAccess;
    let mockLog;

    beforeEach(() => {
      mockDataAccess = {
        Site: {
          findById: sinon.stub(),
        },
        Suggestion: {
          bulkUpdateStatus: sinon.stub(),
        },
      };

      mockLog = {
        warn: sinon.spy(),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('returns site when Site.findById returns a valid object', async () => {
      const site = { id: 'site1' };
      mockDataAccess.Site.findById.resolves(site);

      const result = await retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog);

      expect(result).to.equal(site);
      expect(mockDataAccess.Site.findById).to.have.been.calledOnceWith('site1');
      expect(mockLog.warn).to.not.have.been.called;
    });

    it('returns null and logs a warning when Site.findById returns a non-object', async () => {
      mockDataAccess.Site.findById.resolves('not an object');

      const result = await retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog);

      expect(result).to.be.null;
      expect(mockDataAccess.Site.findById).to.have.been.calledOnceWith('site1');
      expect(mockLog.warn).to.have.been.calledOnceWith('Site not found for site: site1');
    });

    it('throws an error when Site.findById throws an error', async () => {
      mockDataAccess.Site.findById.rejects(new Error('database error'));

      await expect(retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog)).to.be.rejectedWith('Error getting site site1: database error');
      expect(mockDataAccess.Site.findById).to.have.been.calledOnceWith('site1');
      expect(mockLog.warn).to.not.have.been.called;
    });
  });

  describe('syncSuggestions', () => {
    let mockOpportunity;
    let mockLogger;
    let context;

    const sandbox = sinon.createSandbox();

    const buildKey = (data) => `${data.key}`;
    const mapNewSuggestion = (data) => ({
      opportunityId: '123',
      type: 'TYPE',
      rank: 123,
      data: {
        key: data.key,
      },
    });

    beforeEach(() => {
      mockOpportunity = {
        getSuggestions: sinon.stub(),
        addSuggestions: sinon.stub(),
        getSiteId: () => 'site-id',
      };

      mockLogger = {
        debug: sinon.spy(),
        error: sinon.spy(),
        info: sinon.spy(),
        warn: sinon.spy(),
      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AHREFS_API_BASE_URL: 'https://ahrefs.com',
            AHREFS_API_KEY: 'ahrefs-api',
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          },
          s3Client: {
            send: sandbox.stub(),
          },
          log: mockLogger,
        })
        .build();
    });

    it('should return early if context is null', async () => {
      await syncSuggestions({
        context: null,
        opportunity: mockOpportunity,
        newData: [],
        buildKey,
        mapNewSuggestion,
      });

      expect(mockOpportunity.getSuggestions).to.not.have.been.called;
      expect(mockOpportunity.addSuggestions).to.not.have.been.called;
    });

    it('should handle outdated suggestions and add new ones', async () => {
      const suggestionsData = [{ key: '1' }, { key: '2' }];
      const existingSuggestions = [
        {
          id: '1',
          data: suggestionsData[0],
          remove: sinon.stub(),
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
        },
        {
          id: '2',
          data: suggestionsData[1],
          remove: sinon.stub(),
          getData: sinon.stub().returns(suggestionsData[1]),
          getStatus: sinon.stub().returns('NEW'),
        },
      ];
      const newData = [{ key: '3' }, { key: '4' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });
      // mark site as requiring validation
      context.site = { requiresValidation: true };

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      });

      expect(mockOpportunity.getSuggestions).to.have.been.calledOnce;
      const addSuggestionsCall = mockOpportunity.addSuggestions.getCall(0);
      expect(addSuggestionsCall).to.exist;

      const actualArgs = addSuggestionsCall.args[0];
      expect(actualArgs.length).to.equal(2);

      // Check first suggestion
      expect(actualArgs[0].opportunityId).to.equal('123');
      expect(actualArgs[0].type).to.equal('TYPE');
      expect(actualArgs[0].rank).to.equal(123);
      expect(actualArgs[0].status).to.equal('PENDING_VALIDATION');
      expect(actualArgs[0].data).to.deep.equal({ key: '3' });

      // Check second suggestion
      expect(actualArgs[1].opportunityId).to.equal('123');
      expect(actualArgs[1].type).to.equal('TYPE');
      expect(actualArgs[1].rank).to.equal(123);
      expect(actualArgs[1].status).to.equal('PENDING_VALIDATION');
      expect(actualArgs[1].data).to.deep.equal({ key: '4' });
      expect(mockLogger.error).to.not.have.been.called;
    });

    it('should not handle outdated suggestions if context is not provided', async () => {
      const suggestionsData = [{ key: '1' }, { key: '2' }];
      const existingSuggestions = [
        {
          id: '1',
          data: suggestionsData[0],
          remove: sinon.stub(),
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
        },
        {
          id: '2',
          data: suggestionsData[1],
          remove: sinon.stub(),
          getData: sinon.stub().returns(suggestionsData[1]),
          getStatus: sinon.stub().returns('NEW'),
        },
      ];
      const newData = [{ key: '3' }, { key: '4' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

      await syncSuggestions({
        context: {
          log: { debug: () => {}, info: () => {} },
          dataAccess: { Suggestion: { bulkUpdateStatus: () => {} } },
        },
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
    });

    it('should update OUTDATED suggestions to PENDING_VALIDATION when site requires validation', async () => {
      const suggestionsData = [
        { key: '1', title: 'old title' },
        { key: '2', title: 'same title' },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.OUTDATED),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];

      const newData = [
        { key: '1', title: 'updated title' },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      context.site = { requiresValidation: true };

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      expect(existingSuggestions[0].setStatus).to.have.been
        .calledWith(SuggestionDataAccess.STATUSES.PENDING_VALIDATION);
      expect(existingSuggestions[0].save).to.have.been.called;
    });

    it('should update OUTDATED suggestions to NEW when site does not require validation', async () => {
      const suggestionsData = [
        { key: '1', title: 'old title' },
        { key: '2', title: 'same title' },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.OUTDATED),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];

      const newData = [
        { key: '1', title: 'updated title' },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      context.site = { requiresValidation: false };

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      expect(existingSuggestions[0].setStatus).to.have
        .been.calledWith(SuggestionDataAccess.STATUSES.NEW);
      expect(existingSuggestions[0].save).to.have.been.called;
    });

    it('should update suggestions when they are detected again', async () => {
      const suggestionsData = [
        { key: '1', title: 'old title' },
        { key: '2', title: 'same title' },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub(),
        getStatus: sinon.stub().returns('NEW'),
        setUpdatedBy: sinon.stub().returnsThis(),
      }, {
        id: '2',
        data: suggestionsData[1],
        getData: sinon.stub().returns(suggestionsData[1]),
        remove: sinon.stub(),
        getStatus: sinon.stub().returns('NEW'),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];
      const newData = [{ key: '1', title: 'new title' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      });

      expect(mockOpportunity.getSuggestions).to.have.been.calledOnce;
      expect(existingSuggestions[0].setData).to.have.been.calledOnceWith(newData[0]);
      expect(existingSuggestions[0].save).to.have.been.calledOnce;
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been
        .calledOnceWith([existingSuggestions[1]], 'OUTDATED');
    });

    it('should reopen fixed suggestions', async () => {
      const suggestionsData = [
        { key: '1', title: 'old title' },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub(),
        getStatus: sinon.stub().returns('OUTDATED'),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];
      const newData = [{ key: '1', title: 'new title' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      });

      expect(mockOpportunity.getSuggestions).to.have.been.calledOnce;
      expect(mockOpportunity.addSuggestions).to.not.have.been.called;
      expect(existingSuggestions[0].setData).to.have.been.calledOnceWith(newData[0]);
      expect(existingSuggestions[0].setStatus).to.have.been
        .calledOnceWith(SuggestionDataAccess.STATUSES.NEW);
      expect(mockLogger.warn).to.have.been.calledOnceWith('Resolved suggestion found in audit. Possible regression.');
      expect(existingSuggestions[0].save).to.have.been.calledOnce;
    });

    it('should log errors if there are items with errors', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];
      const newData = [{ id: '2' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({
        errorItems: [{ item: { id: '2' }, error: 'some error' }],
        createdItems: [],
      });

      try {
        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });
      } catch (e) {
        expect(e.message).to.match(/Failed to create suggestions for siteId (site-id|unknown)/);
        expect(e.message).to.include('Sample error: some error');
      }

      // Now logs summary + detailed error + failed item data + error items array = 4 calls
      expect(mockLogger.error).to.have.callCount(4);
      expect(mockLogger.error.firstCall.args[0]).to.match(/contains 1 items with errors/);
      expect(mockLogger.error.secondCall.args[0]).to.include('Error 1/1: some error');
      expect(mockLogger.error.thirdCall.args[0]).to.include('Failed item data');
      expect(mockLogger.error.getCall(3).args[0]).to.equal('[suggestions.errorItems]');
    });

    it('should throw an error if all items fail to be created', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];
      const newData = [{ id: '2' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({
        errorItems: [{ item: { id: '2' }, error: 'some error' }],
        createdItems: [],
      });

      await expect(syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      })).to.be.rejectedWith('Failed to create suggestions for siteId');
    });

    it('should log partial success when some items are created and some fail', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];
      const newData = [{ key: '2' }, { key: '3' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({
        errorItems: [{ item: { key: '2' }, error: 'some error' }],
        createdItems: [{ key: '3' }],
      });

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      });

      expect(mockLogger.warn).to.have.been.calledWith('Partial success: Created 1 suggestions, 1 failed');
    });

    it('should log "... and more errors" when there are more than 5 errors', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];
      const newData = Array.from({ length: 7 }, (_, i) => ({ key: `new-${i + 2}` }));

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({
        errorItems: Array.from({ length: 7 }, (_, i) => ({
          item: { key: `new-${i + 2}` },
          error: `error ${i + 1}`,
        })),
        createdItems: [],
      });

      try {
        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });
      } catch (e) {
        // Expected to throw
      }

      // Should log first 5 errors individually, then "... and 2 more errors"
      expect(mockLogger.error).to.have.been.calledWith('... and 2 more errors');
    });

    describe('scrapedUrlsSet filtering', () => {
      it('should preserve suggestions when their URLs were not scraped', async () => {
        const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

        // Existing suggestions for URLs that weren't in this audit run
        const existingSuggestions = [
          {
            id: '1',
            data: { url: 'https://example.com/page1', key: 'page1' },
            getData: sinon.stub().returns({ url: 'https://example.com/page1', key: 'page1' }),
            getStatus: sinon.stub().returns('NEW'),
          },
          {
            id: '2',
            data: { url: 'https://example.com/page2', key: 'page2' },
            getData: sinon.stub().returns({ url: 'https://example.com/page2', key: 'page2' }),
            getStatus: sinon.stub().returns('NEW'),
          },
        ];

        // New audit data only has page3 (page1 and page2 were not scraped)
        const newData = [{ url: 'https://example.com/page3', key: 'page3' }];
        const scrapedUrlsSet = new Set(['https://example.com/page3']);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey: buildKeyWithUrl,
          mapNewSuggestion,
          scrapedUrlsSet,
        });

        // Verify that bulkUpdateStatus was NOT called (suggestions preserved)
        expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
        expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 0');
      });

      it('should mark suggestions as outdated when their URLs were scraped but issues are gone', async () => {
        const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

        // Existing suggestions for URLs that were scraped
        const existingSuggestions = [
          {
            id: '1',
            data: { url: 'https://example.com/page1', key: 'page1' },
            getData: sinon.stub().returns({ url: 'https://example.com/page1', key: 'page1' }),
            getStatus: sinon.stub().returns('NEW'),
          },
          {
            id: '2',
            data: { url: 'https://example.com/page2', key: 'page2' },
            getData: sinon.stub().returns({ url: 'https://example.com/page2', key: 'page2' }),
            getStatus: sinon.stub().returns('NEW'),
          },
        ];

        // New audit data has page3, but not page1 or page2 (they were scraped but issues are gone)
        const newData = [{ url: 'https://example.com/page3', key: 'page3' }];
        const scrapedUrlsSet = new Set([
          'https://example.com/page1',
          'https://example.com/page2',
          'https://example.com/page3',
        ]);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey: buildKeyWithUrl,
          mapNewSuggestion,
          scrapedUrlsSet,
        });

        // Verify that bulkUpdateStatus WAS called to mark them as outdated
        expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
          existingSuggestions,
          'OUTDATED',
        );
        expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 2');
      });

      it('should handle mixed scenario: some URLs scraped, some not', async () => {
        const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

        const existingSuggestions = [
          {
            id: '1',
            data: { url: 'https://example.com/page1', key: 'page1' },
            getData: sinon.stub().returns({ url: 'https://example.com/page1', key: 'page1' }),
            getStatus: sinon.stub().returns('NEW'),
          },
          {
            id: '2',
            data: { url: 'https://example.com/page2', key: 'page2' },
            getData: sinon.stub().returns({ url: 'https://example.com/page2', key: 'page2' }),
            getStatus: sinon.stub().returns('NEW'),
          },
          {
            id: '3',
            data: { url: 'https://example.com/page3', key: 'page3' },
            getData: sinon.stub().returns({ url: 'https://example.com/page3', key: 'page3' }),
            getStatus: sinon.stub().returns('NEW'),
          },
        ];

        // New audit: page4 has issues, page2 was scraped but no issues, page1 and page3 not scraped
        const newData = [{ url: 'https://example.com/page4', key: 'page4' }];
        const scrapedUrlsSet = new Set([
          'https://example.com/page2', // scraped, no issues (should be marked OUTDATED)
          'https://example.com/page4', // scraped, has issues (new suggestion)
        ]);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey: buildKeyWithUrl,
          mapNewSuggestion,
          scrapedUrlsSet,
        });

        // Only page2 should be marked as outdated (it was scraped but issue is gone)
        // page1 and page3 should be preserved (not scraped)
        expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnce;
        const markedOutdated = context.dataAccess.Suggestion.bulkUpdateStatus.firstCall.args[0];
        expect(markedOutdated).to.have.length(1);
        expect(markedOutdated[0].id).to.equal('2');
        expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 1');
      });

      it('should work without scrapedUrlsSet (backward compatibility)', async () => {
        // When scrapedUrlsSet is not provided, all non-matching suggestions
        // should be marked outdated
        const existingSuggestions = [
          {
            id: '1',
            data: { key: '1' },
            getData: sinon.stub().returns({ key: '1' }),
            getStatus: sinon.stub().returns('NEW'),
          },
          {
            id: '2',
            data: { key: '2' },
            getData: sinon.stub().returns({ key: '2' }),
            getStatus: sinon.stub().returns('NEW'),
          },
        ];

        const newData = [{ key: '3' }];

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
          // scrapedUrlsSet not provided
        });

        // Without scrapedUrlsSet, all non-matching suggestions should be marked outdated
        expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
          existingSuggestions,
          'OUTDATED',
        );
        expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 2');
      });

      it('should use FIXED status when statusToSetForOutdated is specified', async () => {
        const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

        const existingSuggestions = [
          {
            id: '1',
            data: { url: 'https://example.com/page1', key: 'page1' },
            getData: sinon.stub().returns({ url: 'https://example.com/page1', key: 'page1' }),
            getStatus: sinon.stub().returns('NEW'),
          },
        ];

        const newData = [{ url: 'https://example.com/page2', key: 'page2' }];
        const scrapedUrlsSet = new Set(['https://example.com/page1', 'https://example.com/page2']);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey: buildKeyWithUrl,
          mapNewSuggestion,
          scrapedUrlsSet,
          statusToSetForOutdated: SuggestionDataAccess.STATUSES.FIXED,
        });

        // Verify FIXED status is used instead of OUTDATED
        expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
          existingSuggestions,
          SuggestionDataAccess.STATUSES.FIXED,
        );
      });
    });

    describe('debug logging for large datasets', () => {
      it('should log count only when there are 0 outdated suggestions', async () => {
        const newData = [{ key: '1' }];
        mockOpportunity.getSuggestions.resolves([]);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that outdated count is logged
        expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 0');
        // Verify no sample logs for empty array
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        expect(debugCalls.some((msg) => msg.includes('Outdated suggestions sample'))).to.be.false;
      });

      it('should log full data when there are 1-10 outdated suggestions', async () => {
        const existingSuggestions = Array.from({ length: 5 }, (_, i) => ({
          id: `${i + 1}`,
          data: { key: `${i + 1}` },
          getData: sinon.stub().returns({ key: `${i + 1}` }),
          getStatus: sinon.stub().returns('NEW'),
        }));
        const newData = [{ key: '99' }];

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that outdated count is logged
        expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 5');
        // Check that full sample is logged (all 5 items)
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => msg.includes('Outdated suggestions sample:'));
        expect(sampleLog).to.exist;
        expect(sampleLog).to.not.include('first 10');
      });

      it('should log only first 10 items when there are more than 10 outdated suggestions', async () => {
        const existingSuggestions = Array.from({ length: 15 }, (_, i) => ({
          id: `${i + 1}`,
          data: { key: `${i + 1}` },
          getData: sinon.stub().returns({ key: `${i + 1}` }),
          getStatus: sinon.stub().returns('NEW'),
        }));
        const newData = [{ key: '99' }];

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that outdated count is logged
        expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 15');
        // Check that only first 10 are logged
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => msg.includes('Outdated suggestions sample (first 10):'));
        expect(sampleLog).to.exist;
      });

      it('should log count only when there are 0 existing suggestions', async () => {
        const newData = [{ key: '1' }];
        mockOpportunity.getSuggestions.resolves([]);
        mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that existing count is logged
        expect(mockLogger.debug).to.have.been.calledWithMatch(/Existing suggestions\s*=\s*0/);
        // Verify no sample logs for empty array
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        expect(debugCalls.some((msg) => msg.includes('Existing suggestions sample'))).to.be.false;
      });

      it('should log full data when there are 1-10 existing suggestions', async () => {
        const existingSuggestions = Array.from({ length: 8 }, (_, i) => ({
          id: `${i + 1}`,
          data: { key: `${i + 1}` },
          getData: sinon.stub().returns({ key: `${i + 1}` }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
          save: sinon.stub(),
          setUpdatedBy: sinon.stub().returnsThis(),
        }));
        const newData = existingSuggestions.map((s) => s.data);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that existing count is logged
        expect(mockLogger.debug).to.have.been.calledWithMatch(/Existing suggestions\s*=\s*8/);
        // Check that full sample is logged
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => /Existing suggestions\s*=\s*8:/.test(msg));
        expect(sampleLog).to.exist;
      });

      it('should log only first 10 items when there are more than 10 existing suggestions', async () => {
        const existingSuggestions = Array.from({ length: 20 }, (_, i) => ({
          id: `${i + 1}`,
          data: { key: `${i + 1}` },
          getData: sinon.stub().returns({ key: `${i + 1}` }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
          save: sinon.stub(),
          setUpdatedBy: sinon.stub().returnsThis(),
        }));
        const newData = existingSuggestions.map((s) => s.data);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that existing count is logged
        expect(mockLogger.debug).to.have.been.calledWithMatch(/Existing suggestions\s*=\s*20/);
        // Check that only first 10 are logged
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => /Existing suggestions\s*=\s*20:/.test(msg));
        expect(sampleLog).to.exist;
      });

      it('should log full data when there are 1-10 updated suggestions', async () => {
        const existingSuggestions = Array.from({ length: 7 }, (_, i) => ({
          id: `${i + 1}`,
          data: { key: `${i + 1}`, title: 'old' },
          getData: sinon.stub().returns({ key: `${i + 1}`, title: 'old' }),
          setData: sinon.stub(),
          save: sinon.stub(),
          getStatus: sinon.stub().returns('NEW'),
          setUpdatedBy: sinon.stub().returnsThis(),
        }));
        const newData = existingSuggestions.map((s) => ({ key: s.data.key, title: 'new' }));

        mockOpportunity.getSuggestions.resolves(existingSuggestions);

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that updated count is logged
        expect(mockLogger.debug).to.have.been.calledWithMatch(/Updated existing suggestions\s*=\s*7/);
        // Check that full sample is logged
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => /Updated existing suggestions\s*=\s*7:/.test(msg));
        expect(sampleLog).to.exist;
      });

      it('should log only first 10 items when there are more than 10 updated suggestions', async () => {
        const existingSuggestions = Array.from({ length: 12 }, (_, i) => ({
          id: `${i + 1}`,
          data: { key: `${i + 1}`, title: 'old' },
          getData: sinon.stub().returns({ key: `${i + 1}`, title: 'old' }),
          setData: sinon.stub(),
          save: sinon.stub(),
          getStatus: sinon.stub().returns('NEW'),
          setUpdatedBy: sinon.stub().returnsThis(),
        }));
        const newData = existingSuggestions.map((s) => ({ key: s.data.key, title: 'new' }));

        mockOpportunity.getSuggestions.resolves(existingSuggestions);

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that updated count is logged
        expect(mockLogger.debug).to.have.been.calledWithMatch(/Updated existing suggestions\s*=\s*12/);
        // Check that only first 10 are logged
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => /Updated existing suggestions\s*=\s*12:/.test(msg));
        expect(sampleLog).to.exist;
      });

      it('should log full data when there are 1-10 new suggestions', async () => {
        const existingSuggestions = [
          {
            id: '1',
            data: { key: '1' },
            getData: sinon.stub().returns({ key: '1' }),
            getStatus: sinon.stub().returns('NEW'),
            setData: sinon.stub(),
            save: sinon.stub(),
            setUpdatedBy: sinon.stub().returnsThis(),
          },
        ];
        const newData = [
          { key: '1' },
          ...Array.from({ length: 9 }, (_, i) => ({ key: `new-${i + 2}` })),
        ];

        // Create an array-like object with errorItems/createdItems properties
        const mockSuggestions = Array.from({ length: 9 }, (_, i) => ({ id: `new-${i + 1}` }));
        mockSuggestions.errorItems = [];
        mockSuggestions.createdItems = newData.slice(1);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves(mockSuggestions);

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that new suggestions count is logged
        expect(mockLogger.debug).to.have.been.calledWithMatch(/New suggestions\s*=\s*9/);
        // Check that full sample is logged
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => /New suggestions\s*=\s*9:/.test(msg));
        expect(sampleLog).to.exist;
      });

      it('should log only first 10 items when there are more than 10 new suggestions', async () => {
        const existingSuggestions = [
          {
            id: '1',
            data: { key: '1' },
            getData: sinon.stub().returns({ key: '1' }),
            getStatus: sinon.stub().returns('NEW'),
            setData: sinon.stub(),
            save: sinon.stub(),
            setUpdatedBy: sinon.stub().returnsThis(),
          },
        ];
        const newData = [
          { key: '1' },
          ...Array.from({ length: 15 }, (_, i) => ({ key: `new-${i + 2}` })),
        ];

        // Create an array-like object with errorItems/createdItems properties
        const mockSuggestions = Array.from({ length: 15 }, (_, i) => ({ id: `new-${i + 1}` }));
        mockSuggestions.errorItems = [];
        mockSuggestions.createdItems = newData.slice(1);

        mockOpportunity.getSuggestions.resolves(existingSuggestions);
        mockOpportunity.addSuggestions.resolves(mockSuggestions);

        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });

        // Check that new suggestions count is logged
        expect(mockLogger.debug).to.have.been.calledWithMatch(/New suggestions\s*=\s*15/);
        // Check that only first 10 are logged
        const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
        const sampleLog = debugCalls.find((msg) => /New suggestions\s*=\s*15:/.test(msg));
        expect(sampleLog).to.exist;
      });
    });

    it('should handle large arrays without JSON.stringify errors', async () => {
      // Create a very large array of suggestions (simulate the theplayers.com case)
      const largeNewData = Array.from({ length: 1000 }, (_, i) => ({
        key: `new${i}`,
        textContent: 'x'.repeat(5000), // Large text content
      }));

      mockOpportunity.getSuggestions.resolves([]);
      mockOpportunity.addSuggestions.resolves({
        createdItems: largeNewData.map((data) => ({ id: `suggestion-${data.key}` })),
        errorItems: [],
        length: largeNewData.length,
      });

      // This should not throw "Invalid string length" error
      await expect(syncSuggestions({
        opportunity: mockOpportunity,
        newData: largeNewData,
        context,
        buildKey,
        mapNewSuggestion,
      })).to.not.be.rejected;

      // Verify that debug was called (safeStringify should have prevented the error)
      expect(mockLogger.debug).to.have.been.called;
    });

    it('should handle unstringifiable data gracefully via safeStringify', async () => {
      // Create existing suggestions with BigInt to trigger safeStringify catch block
      // (JSON.stringify cannot serialize BigInt values)
      const unstringifiableData = { key: '1', bigValue: BigInt(9007199254740991) };

      const existingSuggestions = [{
        id: '1',
        data: unstringifiableData,
        getData: sinon.stub().returns(unstringifiableData),
        getStatus: sinon.stub().returns('NEW'),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];

      const newData = [{ key: '1', title: 'updated' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      // This should not throw - safeStringify catches JSON.stringify errors
      await expect(syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      })).to.not.be.rejected;

      // Verify debug was called and contains the error message from safeStringify
      const debugCalls = mockLogger.debug.getCalls().map((call) => call.args[0]);
      const hasUnavailableStringify = debugCalls.some((msg) => msg.includes('[Unable to stringify:'));
      expect(hasUnavailableStringify).to.be.true;
    });

    it('should handle unstringifiable non-array data via safeStringify (line 36 N/A branch)', async () => {
      // Test safeStringify catch block with non-array data to cover the 'N/A' branch
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];
      const newData = [{ key: '2' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      // errorItem.item contains BigInt, which is a non-array object
      mockOpportunity.addSuggestions.resolves({
        errorItems: [{ item: { key: '2', bigValue: BigInt(123) }, error: 'some error' }],
        createdItems: [],
      });

      try {
        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });
      } catch (e) {
        // Expected to throw
      }

      // Verify the N/A branch was hit (errorItem.item is not an array)
      const errorCalls = mockLogger.error.getCalls().map((call) => call.args[0]);
      const hasNAStringify = errorCalls.some((msg) => msg.includes('N/A'));
      expect(hasNAStringify).to.be.true;
    });

    it('should handle undefined createdItems (line 312 optional chaining branch)', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];
      const newData = [{ key: '2' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      // Return array-like object with errorItems and empty createdItems
      // When createdItems.length is 0, the condition `createdItems?.length <= 0` is true
      const mockSuggestions = [];
      mockSuggestions.errorItems = [{ item: { key: '2' }, error: 'some error' }];
      mockSuggestions.createdItems = [];
      mockOpportunity.addSuggestions.resolves(mockSuggestions);

      // Should throw because no items were created
      await expect(syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      })).to.be.rejectedWith(/Failed to create suggestions for siteId/);
    });

    it('should use "Unknown error" fallback when errorItems[0].error is falsy', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];
      const newData = [{ key: '2' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      // errorItems[0].error is undefined/falsy to trigger 'Unknown error' fallback
      // Return array-like object with errorItems and empty createdItems
      const mockSuggestions = [];
      mockSuggestions.errorItems = [{ item: { key: '2' }, error: undefined }];
      mockSuggestions.createdItems = [];
      mockOpportunity.addSuggestions.resolves(mockSuggestions);

      try {
        await syncSuggestions({
          opportunity: mockOpportunity,
          newData,
          context,
          buildKey,
          mapNewSuggestion,
        });
      } catch (e) {
        expect(e.message).to.include('Sample error: Unknown error');
      }
    });
  });

  describe('getImsOrgId', () => {
    let mockSite;
    let mockDataAccess;
    let mockLog;

    beforeEach(() => {
      mockSite = {
        getOrganizationId: () => 'test-org-id',
        getBaseURL: () => 'https://example.com',
      };
      mockDataAccess = {
        Organization: {
          findById: sinon.stub().resolves({ getImsOrgId: () => 'test-ims-org-id' }),
        },
      };
      mockLog = {
        warn: sinon.spy(),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('returns the IMS org ID', async () => {
      const result = await getImsOrgId(mockSite, mockDataAccess, mockLog);
      expect(result).to.equal('test-ims-org-id');
    });

    it('returns null when the IMS org ID is not found', async () => {
      mockDataAccess.Organization.findById.resolves({ getImsOrgId: () => null });
      const result = await getImsOrgId(mockSite, mockDataAccess, mockLog);
      expect(result).to.be.null;
    });

    it('returns null when the organization ID is not found', async () => {
      mockSite.getOrganizationId = () => null;
      const result = await getImsOrgId(mockSite, mockDataAccess, mockLog);
      expect(result).to.be.null;
    });

    it('returns null and logs warning when Organization.findById throws an error', async () => {
      mockDataAccess.Organization.findById.rejects(new Error('Database connection failed'));
      const result = await getImsOrgId(mockSite, mockDataAccess, mockLog);
      expect(result).to.be.null;
      expect(mockLog.warn).to.have.been.calledWith('Failed to get IMS org ID for site https://example.com: Database connection failed');
    });
  });

  describe('retrieveAuditById', () => {
    let mockDataAccess;
    let mockLog;

    beforeEach(() => {
      mockDataAccess = {
        Audit: {
          findById: sinon.stub(),
        },
      };
      mockLog = {
        warn: sinon.spy(),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('returns audit when Audit.findById returns a valid object', async () => {
      const audit = { id: 'audit1' };
      mockDataAccess.Audit.findById.resolves(audit);

      const result = await retrieveAuditById(mockDataAccess, 'audit1', mockLog);

      expect(result).to.equal(audit);
      expect(mockDataAccess.Audit.findById).to.have.been.calledOnceWith('audit1');
      expect(mockLog.warn).to.not.have.been.called;
    });

    it('returns null and logs a warning when Audit.findById returns a non-object', async () => {
      mockDataAccess.Audit.findById.resolves('not an object');

      const result = await retrieveAuditById(mockDataAccess, 'audit1', mockLog);

      expect(result).to.be.null;
      expect(mockDataAccess.Audit.findById).to.have.been.calledOnceWith('audit1');
      expect(mockLog.warn).to.have.been.calledOnceWith('Audit not found for auditId: audit1');
    });

    it('throws an error when Audit.findById throws an error', async () => {
      mockDataAccess.Audit.findById.rejects(new Error('database error'));

      await expect(retrieveAuditById(mockDataAccess, 'audit1', mockLog)).to.be.rejectedWith('Error getting audit audit1: database error');
      expect(mockDataAccess.Audit.findById).to.have.been.calledOnceWith('audit1');
      expect(mockLog.warn).to.not.have.been.called;
    });
  });

  describe('keepSameDataFunction', () => {
    it('returns a shallow copy of the input data', () => {
      const inputData = { key: 'value', nested: { prop: 'test' } };
      const result = keepSameDataFunction(inputData);

      expect(result).to.deep.equal(inputData);
      expect(result).to.not.equal(inputData);
      expect(result.nested).to.equal(inputData.nested);
    });
  });

  describe('keepLatestMergeDataFunction', () => {
    it('completely replaces existing data structure with new one', () => {
      const existingData = {
        type: 'OLD_TYPE',
        url: 'https://old.com',
        oldProperty: 'oldValue',
        sharedProperty: 'oldValue',
      };
      const newData = {
        type: 'NEW_TYPE',
        url: 'https://new.com',
        newProperty: 'newValue',
        sharedProperty: 'newValue',
      };
      const result = keepLatestMergeDataFunction(existingData, newData);

      expect(result).to.deep.equal(newData);
      expect(result).to.not.have.property('oldProperty');
      expect(result).to.have.property('newProperty', 'newValue');
      expect(result).to.have.property('sharedProperty', 'newValue');
    });
  });
});
