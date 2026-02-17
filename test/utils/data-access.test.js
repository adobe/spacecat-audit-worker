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
  syncSuggestionsWithPublishDetection,
  getImsOrgId,
  retrieveAuditById,
  keepSameDataFunction,
  keepLatestMergeDataFunction,
  getDisappearedSuggestions,
  reconcileDisappearedSuggestions,
  publishDeployedFixEntities,
  AUTHOR_ONLY_OPPORTUNITY_TYPES,
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
        getSuggestions: sandbox.stub(),
        addSuggestions: sandbox.stub(),
        getSiteId: () => 'site-id',
      };

      mockLogger = {
        debug: sandbox.spy(),
        error: sandbox.spy(),
        info: sandbox.spy(),
        warn: sandbox.spy(),
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

    afterEach(() => {
      sandbox.restore();
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

    it('should use "unknown" as siteId when getSiteId is undefined', async () => {
      const newData = [{ key: '1' }];
      const suggestionsResult = {
        errorItems: [],
        createdItems: newData,
        length: newData.length,
      };

      // Create opportunity without getSiteId
      const opportunityWithoutSiteId = {
        getSuggestions: sandbox.stub().resolves([]),
        addSuggestions: sandbox.stub().resolves(suggestionsResult),
      };

      await syncSuggestions({
        context,
        opportunity: opportunityWithoutSiteId,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify that "unknown" is used as siteId
      expect(mockLogger.info).to.have.been.calledWith('Adding 1 new suggestions for siteId unknown');
      expect(mockLogger.debug).to.have.been.calledWith(
        sinon.match(/Successfully created.*suggestions for siteId unknown/),
      );
    });

    it('should use suggestions.length when createdItems is undefined', async () => {
      const newData = [{ key: '1' }, { key: '2' }];
      // Return suggestions without createdItems property
      const suggestionsResult = {
        errorItems: [],
        length: newData.length,
      };

      mockOpportunity.getSuggestions.resolves([]);
      mockOpportunity.addSuggestions.resolves(suggestionsResult);

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify that suggestions.length is used when createdItems is undefined
      expect(mockLogger.debug).to.have.been.calledWith(
        `Successfully created ${suggestionsResult.length} suggestions for siteId site-id`,
      );
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

    it('should preserve REJECTED status when same suggestion appears again with no data changes', async () => {
      const suggestionsData = [
        { key: '1', title: 'same title', url: 'https://example.com/page1' },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.REJECTED),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];

      // Exact same data (no changes)
      const newData = [
        { key: '1', title: 'same title', url: 'https://example.com/page1' },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify that REJECTED status is NOT changed (setStatus should not be called)
      expect(existingSuggestions[0].setStatus).to.not.have.been.called;
      // Verify that debug log is called with the correct message
      expect(mockLogger.debug).to.have.been.calledWith('REJECTED suggestion found in audit. Preserving REJECTED status.');
      // Verify that save is called
      expect(existingSuggestions[0].save).to.have.been.called;
      // Verify that setData is called to update the data
      expect(existingSuggestions[0].setData).to.have.been.called;
    });

    it('should preserve REJECTED status when data changes', async () => {
      const suggestionsData = [
        { key: '1', title: 'old title', description: 'old description' },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.REJECTED),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];

      // Data changed (title changed)
      const newData = [
        { key: '1', title: 'new title', description: 'old description' },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify that REJECTED status is NOT changed (setStatus should not be called)
      expect(existingSuggestions[0].setStatus).to.not.have.been.called;
      // Verify that debug log is called with the correct message
      expect(mockLogger.debug).to.have.been.calledWith('REJECTED suggestion found in audit. Preserving REJECTED status.');
      // Verify that save is called
      expect(existingSuggestions[0].save).to.have.been.called;
      // Verify that setData is called to update the data
      expect(existingSuggestions[0].setData).to.have.been.called;
    });

    it('should preserve REJECTED status when data changes even if site requires validation', async () => {
      const suggestionsData = [
        { key: '1', title: 'old title', url: 'https://example.com/page1' },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.REJECTED),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];

      // Data changed (url changed)
      const newData = [
        { key: '1', title: 'old title', url: 'https://example.com/page2' },
      ];

      // Mock site with requiresValidation
      context.site = {
        requiresValidation: true,
      };

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify that REJECTED status is NOT changed (setStatus should not be called)
      expect(existingSuggestions[0].setStatus).to.not.have.been.called;
      // Verify that debug log is called with the correct message
      expect(mockLogger.debug).to.have.been.calledWith('REJECTED suggestion found in audit. Preserving REJECTED status.');
      // Verify that save is called
      expect(existingSuggestions[0].save).to.have.been.called;
      // Verify that setData is called to update the data
      expect(existingSuggestions[0].setData).to.have.been.called;
    });

    it('should preserve REJECTED status when nested objects and arrays change', async () => {
      const suggestionsData = [
        { key: '1', metrics: [{ value: 100 }], issues: [{ type: 'error1' }] },
      ];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.REJECTED),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];

      // Nested object/array changed in data
      const newData = [
        { key: '1', metrics: [{ value: 200 }], issues: [{ type: 'error2' }] },
      ];

      context.site = {
        requiresValidation: false,
      };

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify that REJECTED status is NOT changed (setStatus should not be called)
      expect(existingSuggestions[0].setStatus).to.not.have.been.called;
      expect(mockLogger.debug).to.have.been.calledWith('REJECTED suggestion found in audit. Preserving REJECTED status.');
      expect(existingSuggestions[0].save).to.have.been.called;
      expect(existingSuggestions[0].setData).to.have.been.called;
    });

    it('should not mark REJECTED suggestions as OUTDATED when they do not appear in new audit data', async () => {
      const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

      // Existing REJECTED suggestion that doesn't appear in new audit
      const existingSuggestions = [
        {
          id: '1',
          data: { url: 'https://example.com/page1', key: 'page1' },
          getData: sinon.stub().returns({ url: 'https://example.com/page1', key: 'page1' }),
          getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.REJECTED),
        },
        {
          id: '2',
          data: { url: 'https://example.com/page2', key: 'page2' },
          getData: sinon.stub().returns({ url: 'https://example.com/page2', key: 'page2' }),
          getStatus: sinon.stub().returns('NEW'),
        },
      ];

      // New audit data only has page3 (page1 and page2 are not in new data)
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

      // Verify that bulkUpdateStatus was called only with NEW suggestion (not REJECTED)
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
        [existingSuggestions[1]], // Only the NEW suggestion, not REJECTED
        'OUTDATED',
      );
      expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 1');
    });

    it('should not mark REJECTED suggestions as OUTDATED even when scrapedUrlsSet is null', async () => {
      const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

      // Existing REJECTED and NEW suggestions that don't appear in new audit
      const existingSuggestions = [
        {
          id: '1',
          data: { url: 'https://example.com/page1', key: 'page1' },
          getData: sinon.stub().returns({ key: 'page1' }),
          getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.REJECTED),
        },
        {
          id: '2',
          data: { url: 'https://example.com/page2', key: 'page2' },
          getData: sinon.stub().returns({ key: 'page2' }),
          getStatus: sinon.stub().returns('NEW'),
        },
      ];

      // New audit data only has page3 (page1 and page2 are not in new data)
      const newData = [{ url: 'https://example.com/page3', key: 'page3' }];
      // scrapedUrlsSet is null (no URL filtering)
      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey: buildKeyWithUrl,
        mapNewSuggestion,
        scrapedUrlsSet: null, // Explicitly null
      });

      // Verify that bulkUpdateStatus was called only with NEW suggestion (not REJECTED)
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
        [existingSuggestions[1]], // Only the NEW suggestion, not REJECTED
        'OUTDATED',
      );
      expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 1');
    });

    it('should not mark APPROVED or IN_PROGRESS suggestions as OUTDATED', async () => {
      const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

      const existingSuggestions = [
        {
          id: '1',
          data: { url: 'https://example.com/page1', key: 'page1' },
          getData: sinon.stub().returns({ url: 'https://example.com/page1', key: 'page1' }),
          getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.APPROVED),
        },
        {
          id: '2',
          data: { url: 'https://example.com/page2', key: 'page2' },
          getData: sinon.stub().returns({ url: 'https://example.com/page2', key: 'page2' }),
          getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.IN_PROGRESS),
        },
        {
          id: '3',
          data: { url: 'https://example.com/page3', key: 'page3' },
          getData: sinon.stub().returns({ url: 'https://example.com/page3', key: 'page3' }),
          getStatus: sinon.stub().returns('NEW'),
        },
      ];

      const newData = [{ url: 'https://example.com/page4', key: 'page4' }];
      const scrapedUrlsSet = new Set([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
        'https://example.com/page4',
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

      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
        [existingSuggestions[2]],
        'OUTDATED',
      );
      expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 1');
    });

    it('should not mark deployed suggestions as OUTDATED', async () => {
      const buildKeyWithUrl = (data) => `${data.url}|${data.key}`;

      const existingSuggestions = [
        {
          id: '1',
          data: { url: 'https://example.com/page1', key: 'page1', tokowakaDeployed: 1769607504287 },
          getId: sinon.stub().returns('1'),
          getData: sinon.stub().returns({ url: 'https://example.com/page1', key: 'page1', tokowakaDeployed: 1769607504287 }),
          getStatus: sinon.stub().returns('NEW'),
        },
        {
          id: '2',
          data: { url: 'https://example.com/page2', key: 'page2', edgeDeployed: 1769607504287 },
          getId: sinon.stub().returns('2'),
          getData: sinon.stub().returns({ url: 'https://example.com/page2', key: 'page2', edgeDeployed: 1769607504287 }),
          getStatus: sinon.stub().returns('NEW'),
        },
        {
          id: '3',
          data: { url: 'https://example.com/page3', key: 'page3' },
          getId: sinon.stub().returns('3'),
          getData: sinon.stub().returns({ url: 'https://example.com/page3', key: 'page3' }),
          getStatus: sinon.stub().returns('NEW'),
        },
      ];

      const newData = [{ url: 'https://example.com/page4', key: 'page4' }];
      const scrapedUrlsSet = new Set([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
        'https://example.com/page4',
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

      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
        [existingSuggestions[2]],
        'OUTDATED',
      );
      expect(mockLogger.info).to.have.been.calledWith('[SuggestionSync] Final count of suggestions to mark as OUTDATED: 1');
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
      expect(mockLogger.warn).to.have.been.calledOnceWith('Outdated suggestion found in audit. Possible regression.');
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

    it('should handle unstringifiable non-array data via safeStringify', async () => {
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

    it('should handle undefined createdItems', async () => {
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

    it('should use pre-fetched suggestions when provided to avoid double DB query', async () => {
      const suggestionsData = [{ key: '1', title: 'existing' }];
      const prefetchedSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        getData: sinon.stub().returns(suggestionsData[0]),
        setData: sinon.stub(),
        save: sinon.stub(),
        getStatus: sinon.stub().returns('NEW'),
        setUpdatedBy: sinon.stub().returnsThis(),
      }];
      const newData = [{ key: '1', title: 'updated' }];

      // Pass existingSuggestions directly - getSuggestions should NOT be called
      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
        existingSuggestions: prefetchedSuggestions,
      });

      // Verify getSuggestions was NOT called since we provided pre-fetched suggestions
      expect(mockOpportunity.getSuggestions).to.not.have.been.called;
      // Verify the pre-fetched suggestions were used
      expect(prefetchedSuggestions[0].setData).to.have.been.calledOnceWith(newData[0]);
      expect(prefetchedSuggestions[0].save).to.have.been.calledOnce;
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

  describe('AUTHOR_ONLY_OPPORTUNITY_TYPES', () => {
    it('should contain expected opportunity types', () => {
      expect(AUTHOR_ONLY_OPPORTUNITY_TYPES).to.include('security-permissions-redundant');
      expect(AUTHOR_ONLY_OPPORTUNITY_TYPES).to.include('security-permissions');
    });
  });

  describe('getDisappearedSuggestions', () => {
    it('should return suggestions whose keys are not in newDataKeys', () => {
      const existingSuggestions = [
        { getData: () => ({ key: '1' }) },
        { getData: () => ({ key: '2' }) },
        { getData: () => ({ key: '3' }) },
      ];
      const newDataKeys = new Set(['1', '3']);
      const buildKey = (data) => data.key;

      const result = getDisappearedSuggestions(existingSuggestions, newDataKeys, buildKey);

      expect(result).to.have.lengthOf(1);
      expect(result[0].getData().key).to.equal('2');
    });

    it('should return empty array when all suggestions exist in newDataKeys', () => {
      const existingSuggestions = [
        { getData: () => ({ key: '1' }) },
        { getData: () => ({ key: '2' }) },
      ];
      const newDataKeys = new Set(['1', '2']);
      const buildKey = (data) => data.key;

      const result = getDisappearedSuggestions(existingSuggestions, newDataKeys, buildKey);

      expect(result).to.have.lengthOf(0);
    });
  });

  describe('reconcileDisappearedSuggestions', () => {
    let mockLogger;
    let mockOpportunity;

    beforeEach(() => {
      mockLogger = {
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
        error: sinon.stub(),
      };
      mockOpportunity = {
        getId: sinon.stub().returns('opp-id'),
        addFixEntities: sinon.stub().resolves({ createdItems: [], errorItems: [] }),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should mark NEW suggestions as FIXED when isIssueFixedWithAISuggestion returns true', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-1'),
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        getType: sinon.stub().returns('TEST_TYPE'),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(true),
        buildFixEntityPayload: (s, opp) => ({
          opportunityId: opp.getId(),
          status: 'PUBLISHED',
          suggestions: [s.getId()],
        }),
      });

      expect(suggestion.setStatus).to.have.been.calledWith(SuggestionDataAccess.STATUSES.FIXED);
      expect(suggestion.save).to.have.been.called;
      expect(mockOpportunity.addFixEntities).to.have.been.called;
    });

    it('should skip suggestions not in NEW status', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-1'),
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.APPROVED),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(true),
        buildFixEntityPayload: sinon.stub(),
      });

      expect(suggestion.setStatus).to.not.have.been.called;
      expect(mockOpportunity.addFixEntities).to.not.have.been.called;
    });

    it('should pass isAuthorOnly to buildFixEntityPayload', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-1'),
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        getType: sinon.stub().returns('TEST_TYPE'),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      const buildFixEntityPayloadStub = sinon.stub().returns({
        opportunityId: 'opp-id',
        status: 'DEPLOYED',
        suggestions: ['sugg-1'],
      });

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(true),
        buildFixEntityPayload: buildFixEntityPayloadStub,
        isAuthorOnly: true,
      });

      expect(buildFixEntityPayloadStub).to.have.been.calledWith(
        suggestion,
        mockOpportunity,
        true,
      );
    });

    it('should log warning when suggestion.save() throws', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-1'),
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().rejects(new Error('DB error')),
      };

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(true),
        buildFixEntityPayload: sinon.stub(),
      });

      expect(mockLogger.warn).to.have.been.calledWith(
        'Failed to mark suggestion sugg-1 as FIXED: DB error',
      );
    });

    it('should log warning when buildFixEntityPayload throws', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-2'),
        getData: sinon.stub().returns({ key: '2' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(true),
        buildFixEntityPayload: sinon.stub().throws(new Error('Payload error')),
      });

      expect(mockLogger.warn).to.have.been.calledWith(
        'Failed building fix entity for suggestion sugg-2: Payload error',
      );
    });

    it('should log warning when opportunity.addFixEntities throws', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-3'),
        getData: sinon.stub().returns({ key: '3' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockOpportunity.addFixEntities.rejects(new Error('Add fix entities error'));

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(true),
        buildFixEntityPayload: sinon.stub().returns({ id: 'fix-1' }),
      });

      expect(mockLogger.warn).to.have.been.calledWith(
        'Failed to add fix entities on opportunity opp-id: Add fix entities error',
      );
    });

    it('should log warning on outer catch when unexpected error occurs', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-4'),
        getData: sinon.stub().returns({ key: '4' }),
        getStatus: sinon.stub().throws(new Error('Unexpected error')),
      };

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(true),
        buildFixEntityPayload: sinon.stub(),
      });

      expect(mockLogger.warn).to.have.been.calledWith(
        'Failed reconciliation for disappeared suggestions: Unexpected error',
      );
    });

    it('should skip when isIssueFixedWithAISuggestion returns false', async () => {
      const suggestion = {
        getId: sinon.stub().returns('sugg-5'),
        getData: sinon.stub().returns({ key: '5' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      await reconcileDisappearedSuggestions({
        opportunity: mockOpportunity,
        disappearedSuggestions: [suggestion],
        log: mockLogger,
        isIssueFixedWithAISuggestion: sinon.stub().resolves(false),
        buildFixEntityPayload: sinon.stub(),
      });

      expect(suggestion.setStatus).to.not.have.been.called;
      expect(mockOpportunity.addFixEntities).to.not.have.been.called;
    });
  });

  describe('publishDeployedFixEntities', () => {
    let mockLogger;
    let mockDataAccess;

    beforeEach(() => {
      mockLogger = {
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
        error: sinon.stub(),
      };
      mockDataAccess = {
        FixEntity: {
          allByOpportunityIdAndStatus: sinon.stub().resolves([]),
        },
        Suggestion: {
          getFixEntitiesBySuggestionId: sinon.stub().resolves({ data: [] }),
        },
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should skip when FixEntity APIs not available', async () => {
      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: {}, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(mockLogger.debug).to.have.been.calledWith('FixEntity APIs not available; skipping publish.');
    });

    it('should handle when context is falsy', async () => {
      // This should not throw - just return early
      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: null,
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });
      // No assertions needed - just ensure no error thrown
    });

    it('should handle when dataAccess is undefined in context', async () => {
      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(mockLogger.debug).to.have.been.calledWith('FixEntity APIs not available; skipping publish.');
    });

    it('should handle fix entity with getSuggestionIds returning undefined', async () => {
      const fixEntity = {
        getId: sinon.stub().returns('fix-undefined'),
        getSuggestionIds: sinon.stub().returns(undefined),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([fixEntity]);

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      // Should not publish since suggestionIds is empty after || []
      expect(fixEntity.setStatus).to.not.have.been.called;
    });

    it('should skip when no deployed fix entities found', async () => {
      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([]);

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(mockDataAccess.FixEntity.allByOpportunityIdAndStatus).to.have.been.called;
    });

    it('should skip fix entity with empty suggestionIds', async () => {
      const fixEntity = {
        getId: sinon.stub().returns('fix-1'),
        getSuggestionIds: sinon.stub().returns([]),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([fixEntity]);

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(fixEntity.setStatus).to.not.have.been.called;
    });

    it('should not publish when suggestion not found', async () => {
      const fixEntity = {
        getId: sinon.stub().returns('fix-2'),
        getSuggestionIds: sinon.stub().returns(['sugg-1']),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([fixEntity]);
      mockDataAccess.Suggestion.getFixEntitiesBySuggestionId.resolves({ data: [] });

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(fixEntity.setStatus).to.not.have.been.called;
    });

    it('should not publish when key exists in currentAuditData (fast-path)', async () => {
      const suggestion = {
        getData: sinon.stub().returns({ key: 'existing-key' }),
      };

      const fixEntity = {
        getId: sinon.stub().returns('fix-3'),
        getSuggestionIds: sinon.stub().returns(['sugg-1']),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([fixEntity]);
      mockDataAccess.Suggestion.getFixEntitiesBySuggestionId.resolves({ data: [suggestion] });

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
        currentAuditData: [{ key: 'existing-key' }],
        buildKey: (d) => d?.key,
      });

      expect(fixEntity.setStatus).to.not.have.been.called;
    });

    it('should not publish when isIssueResolvedOnProduction returns false', async () => {
      const suggestion = {
        getData: sinon.stub().returns({ key: 'resolved-key' }),
      };

      const fixEntity = {
        getId: sinon.stub().returns('fix-4'),
        getSuggestionIds: sinon.stub().returns(['sugg-1']),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([fixEntity]);
      mockDataAccess.Suggestion.getFixEntitiesBySuggestionId.resolves({ data: [suggestion] });

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(false),
      });

      expect(fixEntity.setStatus).to.not.have.been.called;
    });

    it('should publish fix entity when all suggestions resolved', async () => {
      const suggestion = {
        getData: sinon.stub().returns({ key: 'resolved-key' }),
      };

      const fixEntity = {
        getId: sinon.stub().returns('fix-5'),
        getSuggestionIds: sinon.stub().returns(['sugg-1']),
        setStatus: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([fixEntity]);
      mockDataAccess.Suggestion.getFixEntitiesBySuggestionId.resolves({ data: [suggestion] });

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(fixEntity.setStatus).to.have.been.called;
      expect(fixEntity.save).to.have.been.called;
      expect(mockLogger.info).to.have.been.calledWith('Published fix entity fix-5');
    });

    it('should log debug when fixEntity.save() throws', async () => {
      const suggestion = {
        getData: sinon.stub().returns({ key: 'resolved-key' }),
      };

      const fixEntity = {
        getId: sinon.stub().returns('fix-6'),
        getSuggestionIds: sinon.stub().returns(['sugg-1']),
        setStatus: sinon.stub(),
        save: sinon.stub().rejects(new Error('Save error')),
      };

      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.resolves([fixEntity]);
      mockDataAccess.Suggestion.getFixEntitiesBySuggestionId.resolves({ data: [suggestion] });

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(mockLogger.debug).to.have.been.calledWith('Failed to save fix entity: Save error');
    });

    it('should log warning on outer catch when unexpected error occurs', async () => {
      mockDataAccess.FixEntity.allByOpportunityIdAndStatus.rejects(new Error('DB error'));

      await publishDeployedFixEntities({
        opportunityId: 'opp-id',
        context: { dataAccess: mockDataAccess, log: mockLogger },
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(mockLogger.warn).to.have.been.calledWith(
        'Failed to publish deployed fix entities: DB error',
      );
    });
  });

  describe('syncSuggestionsWithPublishDetection', () => {
    let mockLogger;
    let mockOpportunity;
    let context;
    const buildKey = (d) => d?.key;
    const mapNewSuggestion = (d) => ({ type: 'TEST', data: d });

    beforeEach(() => {
      mockLogger = {
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
        error: sinon.stub(),
      };
      mockOpportunity = {
        getId: sinon.stub().returns('opp-id'),
        getSiteId: sinon.stub().returns('site-id'),
        getSuggestions: sinon.stub().resolves([]),
        addSuggestions: sinon.stub().resolves({ createdItems: [], errorItems: [] }),
        addFixEntities: sinon.stub().resolves({ createdItems: [], errorItems: [] }),
        getType: sinon.stub().returns('broken-backlinks'),
      };
      context = {
        dataAccess: {
          Suggestion: {
            bulkUpdateStatus: sinon.stub().resolves(),
            getFixEntitiesBySuggestionId: sinon.stub().resolves({ data: [] }),
          },
          FixEntity: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([]),
          },
        },
        log: mockLogger,
        site: {
          getDeliveryType: sinon.stub().returns('aem_edge'),
          requiresValidation: false,
        },
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should call reconcile when callbacks provided', async () => {
      const newData = [];
      const disappearedSuggestion = {
        getId: sinon.stub().returns('sugg-1'),
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        getType: sinon.stub().returns('TEST'),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      mockOpportunity.getSuggestions.resolves([disappearedSuggestion]);

      const isIssueFixedStub = sinon.stub().resolves(true);
      const buildFixEntityStub = sinon.stub().returns({
        opportunityId: 'opp-id',
        status: 'PUBLISHED',
        suggestions: ['sugg-1'],
      });

      await syncSuggestionsWithPublishDetection({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
        isIssueFixedWithAISuggestion: isIssueFixedStub,
        buildFixEntityPayload: buildFixEntityStub,
      });

      expect(isIssueFixedStub).to.have.been.called;
      expect(disappearedSuggestion.setStatus).to.have.been.calledWith(
        SuggestionDataAccess.STATUSES.FIXED,
      );
    });

    it('should skip publish step for author-only opportunity types', async () => {
      mockOpportunity.getType.returns('security-permissions-redundant');

      await syncSuggestionsWithPublishDetection({
        context,
        opportunity: mockOpportunity,
        newData: [{ key: '1' }],
        buildKey,
        mapNewSuggestion,
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      expect(mockLogger.debug).to.have.been.calledWith(
        '[syncSuggestionsWithPublishDetection] Skipping publish for author-only type',
      );
    });

    it('should call publish step for non-author-only types', async () => {
      mockOpportunity.getType.returns('broken-backlinks');

      await syncSuggestionsWithPublishDetection({
        context,
        opportunity: mockOpportunity,
        newData: [{ key: '1' }],
        buildKey,
        mapNewSuggestion,
        isIssueResolvedOnProduction: sinon.stub().resolves(true),
      });

      // Should have called allByOpportunityIdAndStatus for publish step
      expect(context.dataAccess.FixEntity.allByOpportunityIdAndStatus).to.have.been.called;
    });

    it('should return early when context is falsy', async () => {
      await syncSuggestionsWithPublishDetection({
        context: null,
        opportunity: mockOpportunity,
        newData: [{ key: '1' }],
        buildKey,
        mapNewSuggestion,
      });

      // Should not have called any methods on opportunity
      expect(mockOpportunity.getSuggestions).to.not.have.been.called;
    });

    it('should return early when context is undefined', async () => {
      await syncSuggestionsWithPublishDetection({
        context: undefined,
        opportunity: mockOpportunity,
        newData: [{ key: '1' }],
        buildKey,
        mapNewSuggestion,
      });

      // Should not have called any methods on opportunity
      expect(mockOpportunity.getSuggestions).to.not.have.been.called;
    });

    it('should only call getSuggestions once to avoid duplicate DB queries', async () => {
      const existingSuggestion = {
        id: '1',
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns('NEW'),
        setData: sinon.stub(),
        save: sinon.stub(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      mockOpportunity.getSuggestions.resolves([existingSuggestion]);
      mockOpportunity.getType.returns('broken-backlinks');

      await syncSuggestionsWithPublishDetection({
        context,
        opportunity: mockOpportunity,
        newData: [{ key: '1', title: 'updated' }],
        buildKey,
        mapNewSuggestion,
      });

      // Verify getSuggestions is only called ONCE, not twice
      // (once in wrapper, passed to syncSuggestions to avoid double query)
      expect(mockOpportunity.getSuggestions).to.have.been.calledOnce;
    });
  });
});
