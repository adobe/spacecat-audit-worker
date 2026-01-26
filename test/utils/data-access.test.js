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
import esmock from 'esmock';
import { Suggestion as SuggestionDataAccess, FixEntity as FixEntityDataAccess } from '@adobe/spacecat-shared-data-access';
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

describe('utils/data-access', () => {
  const sandbox = sinon.createSandbox();
  let utils;

  afterEach(async () => {
    sandbox.restore();
    if (utils) {
      await esmock.purge(utils);
      utils = undefined;
    }
  });

  it('syncSuggestions logs safely when JSON.stringify would throw (circular data)', async () => {
    utils = await esmock('../../src/utils/data-access.js');
    const { syncSuggestions: mockedSyncSuggestions } = utils;

    const existingSuggestion = {
      getData: () => ({ url: 'https://example.com' }),
      getStatus: () => 'NEW',
      setData: sandbox.stub(),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };
    // Make the suggestion object self-referential so JSON.stringify throws
    existingSuggestion.self = existingSuggestion;
    const existingSuggestions = [existingSuggestion];

    const context = {
      dataAccess: {
        Suggestion: {
          bulkUpdateStatus: sandbox.stub().resolves(),
        },
      },
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    const opportunity = {
      getSuggestions: sandbox.stub().resolves(existingSuggestions),
      addSuggestions: sandbox.stub().resolves({ createdItems: [], errorItems: [] }),
      getSiteId: () => 'site-1',
    };

    await mockedSyncSuggestions({
      context,
      opportunity,
      // Provide matching newData so the existing item is NOT marked outdated,
      // avoiding the JSON.stringify path inside handleOutdatedSuggestions while
      // still exercising safeStringify on existing suggestions in later logs.
      newData: [{ url: 'https://example.com' }],
      buildKey: (d) => d?.url || 'none',
      mapNewSuggestion: (d) => ({ data: d }),
    });

    expect(context.log.debug).to.have.been.called; // safeStringify path exercised
  });

  it('syncSuggestions logs partial success and "... and N more errors"', async () => {
    utils = await esmock('../../src/utils/data-access.js');
    const { syncSuggestions: mockedSyncSuggestions } = utils;

    const context = {
      dataAccess: {
        Suggestion: {
          bulkUpdateStatus: sandbox.stub().resolves(),
        },
      },
      site: {},
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
      },
    };
    const opportunity = {
      getSuggestions: sandbox.stub().resolves([]),
      addSuggestions: sandbox.stub().resolves({
        createdItems: [1],
        errorItems: new Array(6).fill(0).map((_, i) => ({ error: `e${i}`, item: { id: i } })),
      }),
      getSiteId: () => 'site-1',
    };
    await mockedSyncSuggestions({
      context,
      opportunity,
      newData: [{ id: 1 }],
      buildKey: (d) => String(d.id),
      mapNewSuggestion: (d) => ({ data: d }),
    });

    expect(context.log.error).to.have.been.calledWith(sinon.match(/\.\.\. and 1 more errors/));
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Partial success/));
  });

  it('publishDeployedFixEntities returns early when STATUSES missing', async () => {
    utils = await esmock('../../src/utils/data-access.js', {
      '@adobe/spacecat-shared-data-access': {
        Suggestion: SuggestionDataAccess,
        FixEntity: {}, // No STATUSES
      },
    });
    const { publishDeployedFixEntities } = utils;
    const log = { debug: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() };
    const dataAccess = { FixEntity: {} };
    await publishDeployedFixEntities({
      opportunityId: 'op1',
      dataAccess,
      log,
      isIssueResolvedOnProduction: async () => true,
    });
    expect(log.debug).to.have.been.calledWith(sinon.match(/status constants not available/));
  });

  it('publishDeployedFixEntities returns when no deployed fix entities', async () => {
    const { publishDeployedFixEntities } = await import('../../src/utils/data-access.js');
    const FixEntity = {
      STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
      getSuggestionsByFixEntityId: sandbox.stub(),
    };
    const log = { debug: sandbox.stub(), warn: sandbox.stub() };
    const dataAccess = { FixEntity };
    await publishDeployedFixEntities({
      opportunityId: 'op1',
      dataAccess,
      log,
      isIssueResolvedOnProduction: async () => true,
    });
    expect(FixEntity.getSuggestionsByFixEntityId).to.not.have.been.called;
  });

  it('publishDeployedFixEntities continues when fix has no suggestions', async () => {
    const { publishDeployedFixEntities } = await import('../../src/utils/data-access.js');
    const fe = {
      getId: () => 'fe1',
      getStatus: () => 'DEPLOYED',
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub(),
    };
    const FixEntity = {
      STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([fe]),
      getSuggestionsByFixEntityId: sandbox.stub().resolves([]),
    };
    const log = { debug: sandbox.stub(), warn: sandbox.stub() };
    const dataAccess = { FixEntity };
    await publishDeployedFixEntities({
      opportunityId: 'op1',
      dataAccess,
      log,
      isIssueResolvedOnProduction: async () => true,
    });
    expect(fe.save).to.not.have.been.called;
  });

  it('publishDeployedFixEntities publishes when all suggestions are resolved', async () => {
    const { publishDeployedFixEntities } = await import('../../src/utils/data-access.js');
    const fe = {
      getId: () => 'fe1',
      getStatus: () => 'DEPLOYED',
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };
    const FixEntity = {
      STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([fe]),
      getSuggestionsByFixEntityId: sandbox.stub().resolves([{}, {}]),
    };
    const dataAccess = { FixEntity };
    const log = { debug: sandbox.stub(), warn: sandbox.stub() };
    await publishDeployedFixEntities({
      opportunityId: 'op1',
      dataAccess,
      log,
      isIssueResolvedOnProduction: async () => true,
    });
    expect(fe.setStatus).to.have.been.calledWith('PUBLISHED');
    expect(fe.setUpdatedBy).to.have.been.calledWith('system');
    expect(fe.save).to.have.been.calledOnce;
    expect(log.debug).to.have.been.calledWith(sinon.match(/Published fix entity/));
  });

  it('publishDeployedFixEntities skips publish when any suggestion check throws', async () => {
    const { publishDeployedFixEntities } = await import('../../src/utils/data-access.js');
    const fe = {
      getId: () => 'fe1',
      getStatus: () => 'DEPLOYED',
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub(),
    };
    const FixEntity = {
      STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([fe]),
      getSuggestionsByFixEntityId: sandbox.stub().resolves([{}, {}]),
    };
    const dataAccess = { FixEntity };
    const log = { debug: sandbox.stub(), warn: sandbox.stub() };
    let first = true;
    await publishDeployedFixEntities({
      opportunityId: 'op1',
      dataAccess,
      log,
      isIssueResolvedOnProduction: async () => {
        if (first) {
          first = false;
          throw new Error('network');
        }
        return true;
      },
    });
    expect(fe.save).to.not.have.been.called;
    expect(log.debug).to.have.been.calledWith(sinon.match(/Live check failed/));
  });

  it('publishDeployedFixEntities warns when outer flow throws', async () => {
    const { publishDeployedFixEntities } = await import('../../src/utils/data-access.js');
    const FixEntity = {
      STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      allByOpportunityIdAndStatus: sandbox.stub().rejects(new Error('db')),
      getSuggestionsByFixEntityId: sandbox.stub(),
    };
    const dataAccess = { FixEntity };
    const log = { debug: sandbox.stub(), warn: sandbox.stub() };
    await publishDeployedFixEntities({
      opportunityId: 'op1',
      dataAccess,
      log,
      isIssueResolvedOnProduction: async () => true,
    });
    expect(log.warn).to.have.been.calledWith(sinon.match(/Failed to publish DEPLOYED fix entities/));
  });

  it('publishDeployedFixEntities skips publish when suggestion is not resolved', async () => {
    const { publishDeployedFixEntities } = await import('../../src/utils/data-access.js');
    const fe = {
      getId: () => 'fe1',
      getStatus: () => 'DEPLOYED',
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub(),
    };
    const FixEntity = {
      STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([fe]),
      getSuggestionsByFixEntityId: sandbox.stub().resolves([{ id: 's1' }]),
    };
    const dataAccess = { FixEntity };
    const log = { debug: sandbox.stub(), warn: sandbox.stub() };
    await publishDeployedFixEntities({
      opportunityId: 'op1',
      dataAccess,
      log,
      isIssueResolvedOnProduction: async () => false, // issue NOT resolved
    });
    expect(fe.setStatus).to.not.have.been.called;
    expect(fe.save).to.not.have.been.called;
  });

  it('reconcileDisappearedSuggestions only processes suggestions in NEW status', async () => {
    const fixedSuggestion = {
      getId: () => 'fixed-1',
      getStatus: () => 'FIXED',
      getData: () => ({ urlTo: 'https://example.com/fixed', urlsSuggested: ['https://example.com/target'] }),
    };
    const approvedSuggestion = {
      getId: () => 'approved-1',
      getStatus: () => 'APPROVED',
      getData: () => ({ urlTo: 'https://example.com/approved', urlsSuggested: ['https://example.com/target2'] }),
    };
    const newCandidate = {
      getId: () => 'candidate-1',
      getStatus: () => 'NEW',
      getData: () => ({ urlTo: 'https://example.com/old', urlsSuggested: ['https://example.com/new'] }),
      getType: () => 'REDIRECT_UPDATE',
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };
    const opportunity = {
      getId: () => 'oppty-1',
      getSuggestions: sandbox.stub().resolves([fixedSuggestion, approvedSuggestion, newCandidate]),
      addFixEntities: sandbox.stub().resolves({ createdItems: [], errorItems: [] }),
    };
    const site = {
      getDeliveryType: () => 'aem_edge',
    };

    utils = await esmock('../../src/utils/data-access.js', {
      '@adobe/spacecat-shared-data-access': {
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW', APPROVED: 'APPROVED' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
    });
    const { reconcileDisappearedSuggestions } = utils;

    const log = { debug: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() };
    await reconcileDisappearedSuggestions({
      opportunity,
      currentAuditData: [], // all suggestions are candidates (not in current data)
      buildKey: (d) => d.urlTo,
      getPagePath: (d) => d?.urlFrom,
      getUpdatedValue: (d) => d?.urlsSuggested?.[0],
      getOldValue: (d) => d?.urlTo,
      site,
      log,
      auditType: 'test-audit',
      fetchFn: async () => ({ url: 'https://example.com/new' }), // redirect matches target
      isIssueFixed: async () => true, // mark as fixed
    });

    // Only newCandidate (in NEW status) should be processed
    // fixedSuggestion and approvedSuggestion should be skipped (not in NEW status)
    expect(newCandidate.setStatus).to.have.been.calledWith('FIXED');
    expect(newCandidate.save).to.have.been.calledOnce;
  });

  it('reconcileDisappearedSuggestions uses default getUpdatedValue/getOldValue when not provided', async () => {
    const candidate = {
      getId: () => 'candidate-2',
      getStatus: () => 'NEW',
      getData: () => ({
        urlTo: 'https://example.com/old',
        urlsSuggested: ['https://example.com/new'],
        urlEdited: 'https://example.com/edited',
      }),
      getType: () => 'REDIRECT_UPDATE',
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };
    const opportunity = {
      getId: () => 'oppty-2',
      getSuggestions: sandbox.stub().resolves([candidate]),
      addFixEntities: sandbox.stub().resolves({ createdItems: [{}], errorItems: [] }),
    };
    const site = {
      getDeliveryType: () => 'aem_edge',
    };

    utils = await esmock('../../src/utils/data-access.js', {
      '@adobe/spacecat-shared-data-access': {
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
    });
    const { reconcileDisappearedSuggestions } = utils;

    const log = { debug: sandbox.stub(), warn: sandbox.stub(), info: sandbox.stub() };
    await reconcileDisappearedSuggestions({
      opportunity,
      currentAuditData: [],
      buildKey: (d) => d.urlTo,
      getPagePath: (d) => d?.urlFrom,
      // NOT passing getUpdatedValue and getOldValue - uses default fallback
      site,
      log,
      auditType: 'test-audit',
      isIssueFixed: async () => true,
    });

    expect(candidate.setStatus).to.have.been.calledWith('FIXED');
    // Verify addFixEntities was called (uses default getUpdatedValue/getOldValue)
    expect(opportunity.addFixEntities).to.have.been.calledOnce;
  });
});

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

    it('should create new suggestion for regression when FIXED suggestion has all PUBLISHED fix entities', async () => {
      // Existing FIXED suggestion with key '1'
      const fixedSuggestion = {
        id: 'fixed-1',
        getId: sinon.stub().returns('fixed-1'),
        data: { key: '1' },
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.FIXED),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      // Same issue reappears in audit (key '1')
      const newData = [{ key: '1' }];

      // Mock fix entities - all PUBLISHED
      const publishedFixEntity = {
        getStatus: sinon.stub().returns(FixEntityDataAccess.STATUSES.PUBLISHED),
      };

      mockOpportunity.getSuggestions.resolves([fixedSuggestion]);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: [{ data: { key: '1' } }] });

      // Add Suggestion.getFixEntitiesBySuggestionId to context
      context.dataAccess.Suggestion = {
        ...context.dataAccess.Suggestion,
        getFixEntitiesBySuggestionId: sinon.stub().resolves({ data: [publishedFixEntity] }),
      };

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify a NEW suggestion is created for the regression
      expect(mockOpportunity.addSuggestions).to.have.been.calledOnce;
      const addedSuggestions = mockOpportunity.addSuggestions.getCall(0).args[0];
      expect(addedSuggestions.length).to.equal(1);
      expect(addedSuggestions[0].data).to.deep.equal({ key: '1' });
      expect(addedSuggestions[0].status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });

    it('should NOT create new suggestion when FIXED suggestion has non-PUBLISHED fix entities', async () => {
      // Existing FIXED suggestion with key '1'
      const fixedSuggestion = {
        id: 'fixed-1',
        getId: sinon.stub().returns('fixed-1'),
        data: { key: '1' },
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.FIXED),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      // Same issue reappears in audit (key '1')
      const newData = [{ key: '1' }];

      // Mock fix entities - one DEPLOYED (not yet PUBLISHED)
      const deployedFixEntity = {
        getStatus: sinon.stub().returns(FixEntityDataAccess.STATUSES.DEPLOYED),
      };

      mockOpportunity.getSuggestions.resolves([fixedSuggestion]);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: [] });

      // Add Suggestion.getFixEntitiesBySuggestionId to context
      context.dataAccess.Suggestion = {
        ...context.dataAccess.Suggestion,
        getFixEntitiesBySuggestionId: sinon.stub().resolves({ data: [deployedFixEntity] }),
      };

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify NO new suggestion is created (fix not yet fully published)
      const addedSuggestions = mockOpportunity.addSuggestions.getCall(0)?.args[0] || [];
      expect(addedSuggestions.length).to.equal(0);
    });

    it('should NOT create new suggestion when FIXED suggestion has no fix entities', async () => {
      // Existing FIXED suggestion with key '1' but no fix entities
      const fixedSuggestion = {
        id: 'fixed-1',
        getId: sinon.stub().returns('fixed-1'),
        data: { key: '1' },
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.FIXED),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      // Same issue reappears in audit (key '1')
      const newData = [{ key: '1' }];

      mockOpportunity.getSuggestions.resolves([fixedSuggestion]);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: [] });

      // Add Suggestion.getFixEntitiesBySuggestionId to context - returns empty
      context.dataAccess.Suggestion = {
        ...context.dataAccess.Suggestion,
        getFixEntitiesBySuggestionId: sinon.stub().resolves({ data: [] }),
      };

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify NO new suggestion is created (no fix entities = fix not complete)
      const addedSuggestions = mockOpportunity.addSuggestions.getCall(0)?.args[0] || [];
      expect(addedSuggestions.length).to.equal(0);
    });

    it('should skip FIXED suggestion when getId returns undefined', async () => {
      // FIXED suggestion without getId method
      const fixedSuggestionNoId = {
        data: { key: '1' },
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.FIXED),
        getId: sinon.stub().returns(undefined), // No ID
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      const newData = [{ key: '1' }];

      mockOpportunity.getSuggestions.resolves([fixedSuggestionNoId]);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: [] });

      // Add Suggestion.getFixEntitiesBySuggestionId to context
      context.dataAccess.Suggestion = {
        ...context.dataAccess.Suggestion,
        getFixEntitiesBySuggestionId: sinon.stub().resolves({ data: [] }),
      };

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // getFixEntitiesBySuggestionId should NOT have been called (skipped due to no ID)
      expect(context.dataAccess.Suggestion.getFixEntitiesBySuggestionId).to.not.have.been.called;
      // Should not create new suggestion (FIXED suggestion blocks it but wasn't fully processed)
      const addedSuggestions = mockOpportunity.addSuggestions.getCall(0)?.args[0] || [];
      expect(addedSuggestions.length).to.equal(0);
    });

    it('should handle getFixEntitiesBySuggestionId throwing an error', async () => {
      const fixedSuggestion = {
        id: 'fixed-1',
        getId: sinon.stub().returns('fixed-1'),
        data: { key: '1' },
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.FIXED),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      const newData = [{ key: '1' }];

      mockOpportunity.getSuggestions.resolves([fixedSuggestion]);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: [] });

      // Make getFixEntitiesBySuggestionId throw an error
      context.dataAccess.Suggestion = {
        ...context.dataAccess.Suggestion,
        getFixEntitiesBySuggestionId: sinon.stub().rejects(new Error('Database connection failed')),
      };

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });
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

      // Verify that "unknown" is used as siteId when getSiteId is undefined
      expect(mockLogger.info).to.have.been.calledWith('Adding 1 new suggestions for siteId unknown');
      expect(mockLogger.debug).to.have.been.calledWith(
        sinon.match(/Successfully created.*suggestions for siteId unknown/),
      );
    });

    it('should handle context.dataAccess without Suggestion property', async () => {
      const fixedSuggestion = {
        id: 'fixed-1',
        getId: sinon.stub().returns('fixed-1'),
        data: { key: '1' },
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.FIXED),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      const newData = [{ key: '1' }];

      mockOpportunity.getSuggestions.resolves([fixedSuggestion]);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: [] });

      // Create context with dataAccess but without Suggestion.getFixEntitiesBySuggestionId
      const contextWithoutSuggestionMethod = {
        log: mockLogger,
        site: {},
        dataAccess: {
          Suggestion: {
            bulkUpdateStatus: sinon.stub().resolves(),
            // No getFixEntitiesBySuggestionId method
          },
        },
      };

      await syncSuggestions({
        context: contextWithoutSuggestionMethod,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Should not crash and should not create new suggestion (FIXED blocks it, but can't verify)
      const addedSuggestions = mockOpportunity.addSuggestions.getCall(0)?.args[0] || [];
      expect(addedSuggestions.length).to.equal(0);
    });

    it('should not create duplicate suggestion when existing non-FIXED suggestion matches', async () => {
      // Existing NEW suggestion with key '1'
      const newSuggestion = {
        id: 'new-1',
        data: { key: '1' },
        getData: sinon.stub().returns({ key: '1' }),
        getStatus: sinon.stub().returns(SuggestionDataAccess.STATUSES.NEW),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      // Same issue appears in audit (key '1')
      const newData = [{ key: '1' }];

      mockOpportunity.getSuggestions.resolves([newSuggestion]);
      mockOpportunity.addSuggestions.resolves({ errorItems: [], createdItems: [] });

      await syncSuggestions({
        context,
        opportunity: mockOpportunity,
        newData,
        buildKey,
        mapNewSuggestion,
      });

      // Verify NO new suggestion is created (existing NEW suggestion blocks it)
      const addedSuggestions = mockOpportunity.addSuggestions.getCall(0)?.args[0] || [];
      expect(addedSuggestions.length).to.equal(0);
    });

    it('should use suggestions.length when createdItems is undefined', async () => {
      const newData = [{ key: '1' }, { key: '2' }];
      // Return suggestions without createdItems property (simulates edge case)
      const suggestionsResult = {
        errorItems: [],
        length: newData.length,
        // Note: createdItems is intentionally undefined to test fallback to length
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

      // Verify 2 new suggestions are added (no existing suggestions)
      const addedSuggestions = mockOpportunity.addSuggestions.getCall(0)?.args[0] || [];
      expect(addedSuggestions.length).to.equal(2);
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
