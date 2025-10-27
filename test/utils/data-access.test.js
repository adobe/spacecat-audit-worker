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
        addFixEntities: sinon.stub().resolves({ createdItems: [1], errorItems: [] }),
        getId: () => 'oppty-1',
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

      expect(mockLogger.error).to.have.been.calledTwice;
      expect(mockLogger.error.firstCall.args[0]).to.include('contains 1 items with errors');
      expect(mockLogger.error.secondCall.args[0]).to.include('failed with error: some error');
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

    it('creates FixEntity items when marking suggestions as FIXED', async () => {
      const suggestionsData = [{ key: '1' }];
      const existingSuggestions = [
        {
          id: '1',
          getId: () => 's-1',
          data: suggestionsData[0],
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
          getType: sinon.stub().returns('TYPE'),
        },
      ];

      const newData = []; // nothing detected now, so existing becomes outdated -> FIXED

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      // Provide FixEntity model enums on context
      context.dataAccess.FixEntity = {
        STATUSES: { PUBLISHED: 'PUBLISHED' },
        ORIGINS: { SPACECAT: 'SPACECAT' },
      };

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
        statusToSetForOutdated: 'FIXED',
      });

      expect(mockOpportunity.addFixEntities).to.have.been.calledOnce;
      const payload = mockOpportunity.addFixEntities.firstCall.args[0];
      expect(payload).to.be.an('array').with.lengthOf(1);
      expect(payload[0]).to.include({
        opportunityId: 'oppty-1',
        status: 'PUBLISHED',
        type: 'TYPE',
        origin: 'SPACECAT',
      });
      expect(payload[0].changeDetails).to.have.property('system');
      expect(payload[0].changeDetails).to.have.property('data');
      expect(payload[0].changeDetails.data).to.deep.equal({ key: '1' });
    });

    it('logs a warning when FixEntity creation fails', async () => {
      const suggestionsData = [{ key: '9' }];
      const existingSuggestions = [
        {
          id: '9',
          getId: () => 's-9',
          data: suggestionsData[0],
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
          getType: sinon.stub().returns('TYPE'),
        },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addFixEntities.rejects(new Error('db fail'));

      context.dataAccess.FixEntity = {
        STATUSES: { PUBLISHED: 'PUBLISHED' },
        ORIGINS: { SPACECAT: 'SPACECAT' },
      };

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData: [],
        context,
        buildKey,
        mapNewSuggestion,
        statusToSetForOutdated: 'FIXED',
      });

      expect(context.log.info).to.have.been.called;
      const warnMsg = context.log.info.secondCall.args[0];
      expect(warnMsg).to.include('Failed to add FixEntity for suggestion s-9');
      expect(warnMsg).to.include('db fail');
    });

    it('creates FixEntity with undefined status/origin when FixEntity model is missing', async () => {
      const suggestionsData = [{ key: '10' }];
      const existingSuggestions = [
        {
          id: '10',
          getId: () => 's-10',
          data: suggestionsData[0],
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
          getType: sinon.stub().returns('TYPE'),
        },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      // Remove FixEntity model so optional chaining yields undefined
      context.dataAccess.FixEntity = undefined;

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData: [],
        context,
        buildKey,
        mapNewSuggestion,
        statusToSetForOutdated: 'FIXED',
      });

      expect(mockOpportunity.addFixEntities).to.have.been.calledOnce;
      const payload = mockOpportunity.addFixEntities.firstCall.args[0];
      expect(payload[0]).to.have.property('status', undefined);
      expect(payload[0]).to.have.property('origin', undefined);
    });

    it('creates FixEntity with undefined changeDetails.system when site is missing', async () => {
      const suggestionsData = [{ key: '11' }];
      const existingSuggestions = [
        {
          id: '11',
          getId: () => 's-11',
          data: suggestionsData[0],
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
          getType: sinon.stub().returns('TYPE'),
        },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      context.site = undefined; // triggers optional chaining to undefined
      context.dataAccess.FixEntity = {
        STATUSES: { PUBLISHED: 'PUBLISHED' },
        ORIGINS: { SPACECAT: 'SPACECAT' },
      };

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData: [],
        context,
        buildKey,
        mapNewSuggestion,
        statusToSetForOutdated: 'FIXED',
      });

      expect(mockOpportunity.addFixEntities).to.have.been.calledOnce;
      const payload = mockOpportunity.addFixEntities.firstCall.args[0];
      expect(payload[0]).to.have.property('status', 'PUBLISHED');
      expect(payload[0]).to.have.nested.property('changeDetails.system', undefined);
    });

    it('creates FixEntity with changeDetails.system when site is present', async () => {
      const suggestionsData = [{ key: '12' }];
      const existingSuggestions = [
        {
          id: '12',
          getId: () => 's-12',
          data: suggestionsData[0],
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
          getType: sinon.stub().returns('TYPE'),
        },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      context.site = { getDeliveryType: () => 'aem_cs' };
      context.dataAccess.FixEntity = {
        STATUSES: { PUBLISHED: 'PUBLISHED' },
        ORIGINS: { SPACECAT: 'SPACECAT' },
      };

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData: [],
        context,
        buildKey,
        mapNewSuggestion,
        statusToSetForOutdated: 'FIXED',
      });

      expect(mockOpportunity.addFixEntities).to.have.been.calledOnce;
      const payload = mockOpportunity.addFixEntities.firstCall.args[0];
      expect(payload[0]).to.have.nested.property('changeDetails.system', 'aem_cs');
      expect(payload[0]).to.have.nested.property('changeDetails.data');
    });

    it('does not create FixEntity items when statusToSetForOutdated is not FIXED', async () => {
      const suggestionsData = [{ key: '13' }];
      const existingSuggestions = [
        {
          id: '13',
          getId: () => 's-13',
          data: suggestionsData[0],
          getData: sinon.stub().returns(suggestionsData[0]),
          getStatus: sinon.stub().returns('NEW'),
          getType: sinon.stub().returns('TYPE'),
        },
      ];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      context.site = { getDeliveryType: () => 'aem_cs' };
      context.dataAccess.FixEntity = {
        STATUSES: { PUBLISHED: 'PUBLISHED' },
        ORIGINS: { SPACECAT: 'SPACECAT' },
      };

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData: [],
        context,
        buildKey,
        mapNewSuggestion,
        statusToSetForOutdated: 'OUTDATED',
      });

      expect(mockOpportunity.addFixEntities).to.not.have.been.called;
    });

    it('does not create FixEntity when FIXED but no suggestions are outdated', async () => {
      const existingSuggestions = [
        {
          id: '21',
          getId: () => 's-21',
          getData: sinon.stub().returns({ key: 'same' }),
          getStatus: sinon.stub().returns('NEW'),
          getType: sinon.stub().returns('TYPE'),
          setData: sinon.stub(),
          save: sinon.stub(),
          setUpdatedBy: sinon.stub().returnsThis(),
        },
      ];
      const newData = [{ key: 'same' }]; // nothing becomes outdated

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      context.site = { getDeliveryType: () => 'aem_cs' };
      context.dataAccess.FixEntity = {
        STATUSES: { PUBLISHED: 'PUBLISHED' },
        ORIGINS: { SPACECAT: 'SPACECAT' },
      };

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        context,
        buildKey,
        mapNewSuggestion,
        statusToSetForOutdated: 'FIXED',
      });

      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
      expect(mockOpportunity.addFixEntities).to.not.have.been.called;
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
