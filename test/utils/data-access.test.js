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
import {
  retrieveSiteBySiteId, syncSuggestions, getImsOrgId, retrieveAuditById, keepSameDataFunction,
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

    it('should return early if context is empty', async () => {
      await syncSuggestions({
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

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      });

      expect(mockOpportunity.getSuggestions).to.have.been.calledOnce;
      expect(mockOpportunity.addSuggestions).to.have.been.calledOnceWith([{
        opportunityId: '123',
        type: 'TYPE',
        rank: 123,
        data: {
          key: '3',
        },
      }, {
        opportunityId: '123',
        type: 'TYPE',
        rank: 123,
        data: {
          key: '4',
        },
      }]);
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
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
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
      expect(existingSuggestions[0].setStatus).to.have.been.calledOnceWith('NEW');
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
        expect(e.message).to.equal('Failed to create suggestions for siteId site-id');
      }

      expect(mockLogger.error).to.have.been.calledThrice;
      expect(mockLogger.error.firstCall.args[0]).to.include('contains 1 items with errors');
      expect(mockLogger.error.secondCall.args[0]).to.include('Error 1/1: some error');
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

    it('should handle JSON.stringify errors when logging error items', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [{
        id: '1',
        data: suggestionsData[0],
        remove: sinon.stub(),
        getData: sinon.stub().returns(suggestionsData[0]),
        getStatus: sinon.stub().returns('NEW'),
      }];

      // Create an object with a getter that creates a circular reference
      const problematicData = {};
      Object.defineProperty(problematicData, 'url', {
        get() {
          return this; // Returns itself, creating circular reference
        },
        enumerable: true,
      });

      const newData = [{ id: '2' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({
        errorItems: [{
          item: {
            id: '2',
            data: problematicData,
            rank: 1,
            type: 'test-type',
          },
          error: 'some error',
        }],
        createdItems: [{ id: '3' }], // At least one created to avoid throwing
      });

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
      });

      // Should log the fallback error messages
      const errorCalls = mockLogger.error.getCalls();
      const hasFallbackLog = errorCalls.some((call) => call.args[0].includes('Failed to log error item'));
      expect(hasFallbackLog).to.be.true;
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
});
