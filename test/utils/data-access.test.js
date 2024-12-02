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
import { retrieveSiteBySiteId, syncSuggestions } from '../../src/utils/data-access.js';

use(sinonChai);
use(chaiAsPromised);

describe('data-access', () => {
  describe('retrieveSiteBySiteId', () => {
    let mockDataAccess;
    let mockLog;

    beforeEach(() => {
      mockDataAccess = {
        getSiteByID: sinon.stub(),
      };

      mockLog = {
        warn: sinon.spy(),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    it('returns site when getSiteByID returns a valid object', async () => {
      const site = { id: 'site1' };
      mockDataAccess.getSiteByID.resolves(site);

      const result = await retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog);

      expect(result).to.equal(site);
      expect(mockDataAccess.getSiteByID).to.have.been.calledOnceWith('site1');
      expect(mockLog.warn).to.not.have.been.called;
    });

    it('returns null and logs a warning when getSiteByID returns a non-object', async () => {
      mockDataAccess.getSiteByID.resolves('not an object');

      const result = await retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog);

      expect(result).to.be.null;
      expect(mockDataAccess.getSiteByID).to.have.been.calledOnceWith('site1');
      expect(mockLog.warn).to.have.been.calledOnceWith('Site not found for site: site1');
    });

    it('throws an error when getSiteByID throws an error', async () => {
      mockDataAccess.getSiteByID.rejects(new Error('database error'));

      await expect(retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog)).to.be.rejectedWith('Error getting site site1: database error');
      expect(mockDataAccess.getSiteByID).to.have.been.calledOnceWith('site1');
      expect(mockLog.warn).to.not.have.been.called;
    });
  });

  describe('syncSuggestions', () => {
    let mockOpportunity;
    let mockLogger;

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
        error: sinon.spy(),
        info: sinon.spy(),
      };
    });

    it('should remove outdated suggestions and add new ones', async () => {
      const existingSuggestions = [{ id: '1', data: { key: '1' }, remove: sinon.stub() }, { id: '2', data: { key: '2' }, remove: sinon.stub() }];
      const newData = [{ key: '3' }, { key: '4' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
        log: mockLogger,
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

    it('should update suggestions when they are detected again', async () => {
      const existingSuggestions = [{
        id: '1', data: { key: '1', title: 'old title' }, setData: sinon.stub(), save: sinon.stub(),
      }, { id: '2', data: { key: '2', title: 'same title' }, remove: sinon.stub() }];
      const newData = [{ key: '1', title: 'new title' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: newData });

      await syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
        log: mockLogger,
      });

      expect(mockOpportunity.getSuggestions).to.have.been.calledOnce;
      expect(existingSuggestions[0].setData).to.have.been.calledOnceWith(newData[0]);
      expect(existingSuggestions[0].save).to.have.been.calledOnce;
      expect(existingSuggestions[1].remove).to.have.been.calledOnce;
    });

    it('should log errors if there are items with errors', async () => {
      const existingSuggestions = [{ id: '1', data: { key: '1' }, remove: sinon.stub() }];
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
          buildKey,
          mapNewSuggestion,
          log: mockLogger,
        });
      } catch (e) {
        expect(e.message).to.equal('Failed to create suggestions for siteId site-id');
      }

      expect(mockLogger.error).to.have.been.calledTwice;
      expect(mockLogger.error.firstCall.args[0]).to.include('contains 1 items with errors');
      expect(mockLogger.error.secondCall.args[0]).to.include('failed with error: some error');
    });

    it('should throw an error if all items fail to be created', async () => {
      const existingSuggestions = [{ id: '1', data: { key: '1' }, remove: sinon.stub() }];
      const newData = [{ id: '2' }];

      mockOpportunity.getSuggestions.resolves(existingSuggestions);
      mockOpportunity.addSuggestions.resolves({
        errorItems: [{ item: { id: '2' }, error: 'some error' }],
        createdItems: [],
      });

      await expect(syncSuggestions({
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
        log: mockLogger,
      })).to.be.rejectedWith('Failed to create suggestions for siteId');
    });
  });
});
