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
import { retrieveSiteBySiteId, syncSuggestions, deepMergeDataFunction } from '../../src/utils/data-access.js';
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
        })
        .build();

      mockLogger = {
        error: sinon.spy(),
        info: sinon.spy(),
        warn: sinon.spy(),
      };
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
        log: mockLogger,
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
        log: mockLogger,
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
        log: mockLogger,
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
        log: mockLogger,
      })).to.be.rejectedWith('Failed to create suggestions for siteId');
    });
  });

  describe('deepMergeDataFunction', () => {
    describe('null and undefined handling', () => {
      it('should return target when source is null', () => {
        const target = { a: 1, b: 2 };
        const source = null;
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal(target);
      });

      it('should return target when source is undefined', () => {
        const target = { a: 1, b: 2 };
        const source = undefined;
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal(target);
      });

      it('should return source when target is null', () => {
        const target = null;
        const source = { a: 1, b: 2 };
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal(source);
      });

      it('should return source when target is undefined', () => {
        const target = undefined;
        const source = { a: 1, b: 2 };
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal(source);
      });

      it('should return source when both target and source are null', () => {
        const target = null;
        const source = null;
        const result = deepMergeDataFunction(target, source);
        expect(result).to.be.null;
      });
    });

    describe('primitive values', () => {
      it('should return source for string values', () => {
        const target = 'old value';
        const source = 'new value';
        const result = deepMergeDataFunction(target, source);
        expect(result).to.equal(source);
      });

      it('should return source for number values', () => {
        const target = 42;
        const source = 100;
        const result = deepMergeDataFunction(target, source);
        expect(result).to.equal(source);
      });

      it('should return source for boolean values', () => {
        const target = false;
        const source = true;
        const result = deepMergeDataFunction(target, source);
        expect(result).to.equal(source);
      });
    });

    describe('array handling', () => {
      it('should replace target array with source array', () => {
        const target = [1, 2, 3];
        const source = [4, 5, 6];
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal(source);
        expect(result).to.not.equal(target); // Should be a new array
      });

      it('should handle empty arrays', () => {
        const target = [1, 2, 3];
        const source = [];
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal(source);
      });

      it('should handle nested arrays', () => {
        const target = [[1, 2], [3, 4]];
        const source = [[5, 6], [7, 8]];
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal(source);
      });
    });

    describe('object handling', () => {
      it('should merge simple objects', () => {
        const target = { a: 1, b: 2 };
        const source = { b: 3, c: 4 };
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal({ a: 1, b: 3, c: 4 });
      });

      it('should handle empty objects', () => {
        const target = {};
        const source = { a: 1, b: 2 };
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal({ a: 1, b: 2 });
      });

      it('should handle source as empty object', () => {
        const target = { a: 1, b: 2 };
        const source = {};
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal({ a: 1, b: 2 });
      });
    });

    describe('nested object handling', () => {
      it('should handle deeply nested objects, including arrays', () => {
        const target = {
          data: {
            items: [
              { id: 1, name: 'Item 1' },
              { id: 2, name: 'Item 2' },
            ],
            metadata: {
              count: 2,
              lastUpdated: '2023-01-01',
            },
          },
        };
        const source = {
          data: {
            items: [
              { id: 3, name: 'Item 3' },
            ],
            metadata: {
              count: 1,
              version: '2.0',
            },
          },
        };
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal({
          data: {
            items: [
              { id: 3, name: 'Item 3' },
            ],
            metadata: {
              count: 1,
              lastUpdated: '2023-01-01',
              version: '2.0',
            },
          },
        });
      });

      it('should handle multiple levels of nesting', () => {
        const target = {
          level1: {
            level2: {
              level3: {
                value: 'deep',
              },
            },
          },
        };
        const source = {
          level1: {
            level2: {
              level3: {
                newValue: 'deeper',
              },
            },
          },
        };
        const result = deepMergeDataFunction(target, source);
        expect(result).to.deep.equal({
          level1: {
            level2: {
              level3: {
                value: 'deep',
                newValue: 'deeper',
              },
            },
          },
        });
      });
    });

    describe('edge cases', () => {
      it('should handle objects with prototype properties', () => {
        const target = { a: 1 };
        const source = { b: 2 };
        // eslint-disable-next-line no-extend-native
        Object.prototype.testProperty = 'prototype';

        const result = deepMergeDataFunction(target, source);

        expect(result).to.deep.equal({ a: 1, b: 2 });
        // The current implementation doesn't filter out prototype properties
        // so we expect it to have the prototype property
        expect(result).to.have.property('testProperty', 'prototype');

        // Clean up
        delete Object.prototype.testProperty;
      });

      it('should handle functions as values', () => {
        const target = { fn: () => 'old' };
        const source = { fn: () => 'new' };

        const result = deepMergeDataFunction(target, source);
        expect(result.fn).to.equal(source.fn);
        expect(result.fn()).to.equal('new');
      });
    });

    describe('immutability', () => {
      it('should not modify the original target or source object and return a nre object reference', () => {
        const target = { a: 1, b: { c: 2 } };
        const source = { b: { d: 3 } };
        const targetCopy = JSON.parse(JSON.stringify(target));
        const sourceCopy = JSON.parse(JSON.stringify(source));

        const result = deepMergeDataFunction(target, source);

        expect(source).to.deep.equal(sourceCopy);
        expect(target).to.deep.equal(targetCopy);
        expect(result).to.not.equal(target);
        expect(result).to.not.equal(source);
      });
    });
  });
});
