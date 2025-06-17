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
import { Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { MockContextBuilder } from '../../shared.js';
import { opportunityAndSuggestionsStep } from '../../../src/external-links/handler.js';

use(sinonChai);

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS;

// Define mockLogger for use in tests
const mockLogger = {
  info: sinon.stub(),
  error: sinon.stub(),
  warn: sinon.stub(),
  debug: sinon.stub(),
};

before(() => {
  sinon.stub(Oppty, 'STATUSES').value({ RESOLVED: 'RESOLVED', NEW: 'NEW' });
  sinon.stub(SuggestionDataAccess, 'STATUSES').value({ OUTDATED: 'OUTDATED', NEW: 'NEW' });
});

describe('External Links Handler', () => {
  let context;
  let handler;
  let sandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Reset mockLogger stubs
    Object.values(mockLogger).forEach((stub) => stub.reset());

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://example.com',
          getConfig: sandbox.stub().returns({
            get: () => 'https://example.com',
            getFetchConfig: () => ({
              headers: {},
              timeout: 5000,
            }),
          }),
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves({
              addSuggestions: sandbox.stub().resolves({ createdItems: [], errorItems: [] }),
              getSuggestions: sandbox.stub().resolves([]),
              setAuditId: sandbox.stub(),
              save: sandbox.stub().resolves(),
              setData: () => {},
              getData: () => {},
              setUpdatedBy: sandbox.stub().returnsThis(),
              getType: () => Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS,
              getId: () => 'oppty-id-1',
              getSiteId: () => 'test-site-id',
            }),
          },
          Suggestion: {
            bulkUpdateStatus: sandbox.stub().resolves(),
          },
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: () => true,
            }),
          },
        },
        env: {
          FIREFALL_MODEL: 'test-model',
        },
      })
      .build();
    context.log = {
      warn: sandbox.stub(),
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    handler = await esmock('../../../src/external-links/handler.js', {
      '@adobe/spacecat-shared-rum-api-client': {
        default: {
          createFrom: () => ({
            query: async () => ([{
              url_from: 'https://example.com/page1',
              url_to: 'https://external.com/broken',
              traffic_domain: 'example.com',
            }]),
          }),
        },
      },
      '../../../src/external-links/helpers.js': {
        isLinkInaccessible: async () => true,
        calculatePriority: (links) => links,
        calculateKpiDeltasForAudit: () => ({}),
      },
      '../../../src/external-links/suggestions-generator.js': {
        generateSuggestionData: () => [{
          urlFrom: 'https://example.com',
          urlTo: 'https://example.com/broken',
          trafficDomain: 100,
          urlsSuggested: ['https://example.com/suggested'],
          aiRationale: 'Test rationale',
        }],
      },
    });
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  describe('externalLinksAuditRunner', () => {
    it('should return audit result with broken external links', async () => {
      const result = await handler.externalLinksAuditRunner('https://example.com', context);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('brokenExternalLinks');
      expect(result.auditResult.brokenExternalLinks).to.be.an('array');
      expect(result.auditResult.brokenExternalLinks).to.have.lengthOf(1);
      expect(result.auditResult.brokenExternalLinks[0]).to.deep.include({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://external.com/broken',
        trafficDomain: 'example.com',
      });
    });

    it('should handle errors gracefully', async () => {
      handler = await esmock('../../../src/external-links/handler.js', {
        '@adobe/spacecat-shared-rum-api-client': {
          default: {
            createFrom: () => ({
              query: async () => { throw new Error('RUM API error'); },
            }),
          },
        },
        '../../../src/external-links/helpers.js': {
          isLinkInaccessible: async () => true,
          calculatePriority: (links) => links,
          calculateKpiDeltasForAudit: () => ({}),
        },
        '../../../src/external-links/suggestions-generator.js': {
          generateSuggestionData: () => [{
            urlFrom: 'https://example.com',
            urlTo: 'https://example.com/broken',
            trafficDomain: 100,
            urlsSuggested: ['https://example.com/suggested'],
            aiRationale: 'Test rationale',
          }],
        },
      });

      const result = await handler.externalLinksAuditRunner('https://example.com', context);
      expect(result.auditResult.success).to.be.false;
    });
  });

  describe('runAuditAndImportTopPagesStep', () => {
    it('should run audit and return result', async () => {
      const result = await handler.runAuditAndImportTopPagesStep(context);
      expect(result).to.have.property('auditResult');
    });
  });

  describe('prepareScrapingStep', () => {
    it('should prepare scraping step with top pages', async () => {
      const result = await handler.prepareScrapingStep(context);
      expect(result).to.have.property('urls');
    });
  });

  describe('opportunityAndSuggestionsStep', () => {
    it('should handle no broken external links and update existing opportunity to RESOLVED', async () => {
      const setStatusStub = sinon.stub().resolves();
      const getSuggestionsStub = sinon.stub().resolves([]);
      const setUpdatedByStub = sinon.stub().returnsThis();
      const saveStub = sinon.stub().resolves();
      const mockOpportunity = {
        setStatus: setStatusStub,
        getType: () => Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS,
        getSuggestions: getSuggestionsStub,
        setUpdatedBy: setUpdatedByStub,
        save: saveStub,
        getId: () => 'oppty-id-1',
      };
      const allBySiteIdAndStatusStub = sinon.stub()
        .callsFake(() => Promise.resolve([mockOpportunity]));
      const testContext = {
        log: { info: sinon.stub(), error: sinon.stub() },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: allBySiteIdAndStatusStub,
          },
          Suggestion: {
            bulkUpdateStatus: sinon.stub().resolves(),
          },
        },
        site: { getId: () => 'test-site-id' },
        audit: {
          getAuditResult: () => ({ brokenExternalLinks: [] }),
          fullAuditRef: {},
        },
        finalUrl: 'https://example.com',
      };
      const result = await opportunityAndSuggestionsStep(testContext);
      expect(result).to.deep.equal({ status: 'complete' });
      expect(setStatusStub.calledWith('RESOLVED')).to.be.true;
      expect(setUpdatedByStub).to.have.been.calledWith('system');
      expect(saveStub).to.have.been.calledOnce;
    });

    it('should handle error when updating opportunity status', async () => {
      const setStatusStub = sinon.stub().rejects(new Error('Update error'));
      const getSuggestionsStub = sinon.stub().resolves([]);
      const setUpdatedByStub = sinon.stub().returnsThis();
      const saveStub = sinon.stub().resolves();
      const mockOpportunity = {
        setStatus: setStatusStub,
        getType: () => Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS,
        getSuggestions: getSuggestionsStub,
        setUpdatedBy: setUpdatedByStub,
        save: saveStub,
        getId: () => 'oppty-id-1',
      };
      const allBySiteIdAndStatusStub = sinon.stub()
        .callsFake(() => Promise.resolve([mockOpportunity]));
      const testContext = {
        log: { error: sinon.stub(), info: sinon.stub() },
        site: { getId: () => 'test-site-id' },
        finalUrl: 'https://example.com',
        audit: {
          getAuditResult: () => ({ brokenExternalLinks: [] }),
          getId: () => 'test-audit-id',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: allBySiteIdAndStatusStub,
          },
          Suggestion: {
            bulkUpdateStatus: sinon.stub().resolves(),
          },
        },
      };
      await expect(opportunityAndSuggestionsStep(testContext))
        .to.be.rejectedWith('Update error');
    });

    it('should handle error when fetching opportunities fails', async () => {
      const allBySiteIdAndStatusStub = sinon.stub().rejects(new Error('Fetch error'));
      const mockDataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: allBySiteIdAndStatusStub,
        },
      };

      const testContext = {
        log: mockLogger,
        site: { getId: () => 'test-site' },
        finalUrl: 'https://example.com',
        audit: {
          getAuditResult: () => ({ brokenExternalLinks: [] }),
          getId: () => 'audit-id',
        },
        dataAccess: mockDataAccess,
      };

      await expect(opportunityAndSuggestionsStep(testContext))
        .to.be.rejectedWith('Failed to fetch opportunities for siteId test-site: Fetch error');
    });

    it('should handle error when syncing suggestions fails', async () => {
      const mockOpportunity = {
        getId: () => 'opportunity-id',
        getType: () => Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS,
        setStatus: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves([]),
        save: sinon.stub().resolves(),
        setUpdatedBy: sinon.stub().returnsThis(),
        setAuditId: sinon.stub().returnsThis(),
        getData: () => ({}),
        setData: () => {},
        addSuggestions: sinon.stub().resolves({ createdItems: [], errorItems: [] }),
      };
      const allBySiteIdAndStatusStub = sinon.stub().resolves([mockOpportunity]);
      const mockDataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: allBySiteIdAndStatusStub,
        },
        Suggestion: {
          bulkUpdateStatus: sinon.stub().rejects(new Error('Sync error')),
        },
      };

      const testContext = {
        log: mockLogger,
        site: { getId: () => 'test-site' },
        finalUrl: 'https://example.com',
        audit: {
          getAuditResult: () => ({
            brokenExternalLinks: [{
              urlFrom: 'https://example.com/from',
              urlTo: 'https://example.com/to',
              trafficDomain: 100,
            }],
          }),
          getId: () => 'audit-id',
        },
        dataAccess: mockDataAccess,
      };

      const result = await opportunityAndSuggestionsStep(testContext);
      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should handle error when creating opportunity fails', async () => {
      const mockDataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().resolves([]),
          create: sinon.stub().rejects(new Error('Create error')),
        },
      };

      const testContext = {
        log: mockLogger,
        site: { getId: () => 'test-site' },
        finalUrl: 'https://example.com',
        audit: {
          getAuditResult: () => ({
            brokenExternalLinks: [{
              urlFrom: 'https://example.com/from',
              urlTo: 'https://example.com/to',
            }],
          }),
          getId: () => 'audit-id',
        },
        dataAccess: mockDataAccess,
      };

      await expect(opportunityAndSuggestionsStep(testContext))
        .to.be.rejectedWith('Create error');
    });

    it('should handle no broken external links and no existing opportunity', async () => {
      const allBySiteIdAndStatusStub = sinon.stub().resolves([]);
      const mockDataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: allBySiteIdAndStatusStub,
        },
      };

      const testContext = {
        log: mockLogger,
        site: { getId: () => 'test-site' },
        finalUrl: 'https://example.com',
        env: { FIREFALL_MODEL: 'test-model' },
        audit: {
          getAuditResult: () => ({ brokenExternalLinks: [] }),
          getId: () => 'audit-id',
        },
        dataAccess: mockDataAccess,
      };

      const result = await opportunityAndSuggestionsStep(testContext);
      expect(result).to.deep.equal({ status: 'complete' });
      expect(mockLogger.info).to.have.been.calledWith(`[${AUDIT_TYPE}] [Site: test-site] no broken external links found, skipping opportunity creation`);
    });

    it('should update suggestions to OUTDATED when no broken external links and existing opportunity has suggestions', async () => {
      const setStatusStub = sinon.stub().resolves();
      const getSuggestionsStub = sinon.stub().resolves([{ id: 'suggestion-1' }]);
      const setUpdatedByStub = sinon.stub().returnsThis();
      const saveStub = sinon.stub().resolves();
      const mockOpportunity = {
        setStatus: setStatusStub,
        getType: () => Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS,
        getSuggestions: getSuggestionsStub,
        setUpdatedBy: setUpdatedByStub,
        save: saveStub,
        getId: () => 'oppty-id-coverage',
      };
      const allBySiteIdAndStatusStub = sinon.stub().resolves([mockOpportunity]);
      const bulkUpdateStatusStub = sinon.stub().resolves();
      const mockDataAccess = {
        Opportunity: { allBySiteIdAndStatus: allBySiteIdAndStatusStub },
        Suggestion: { bulkUpdateStatus: bulkUpdateStatusStub },
      };
      const mockContext = {
        log: { info: sinon.stub(), error: sinon.stub() },
        site: { getId: () => 'site-id' },
        finalUrl: 'https://example.com',
        audit: { getAuditResult: () => ({ brokenExternalLinks: [] }) },
        dataAccess: mockDataAccess,
      };
      // Patch SuggestionDataAccess.STATUSES.OUTDATED if needed
      global.SuggestionDataAccess = { STATUSES: { OUTDATED: 'OUTDATED' } };
      await opportunityAndSuggestionsStep(mockContext);
      sinon.assert.calledOnce(bulkUpdateStatusStub);
      sinon.assert.calledWith(bulkUpdateStatusStub, [{ id: 'suggestion-1' }], 'OUTDATED');
    });

    it('should handle error when suggestion generation fails (coverage for line 152)', async () => {
      const mockDataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().resolves([]),
          create: sinon.stub().resolves({
            getId: () => 'new-opportunity-id',
            setStatus: sinon.stub().resolves(),
            getSuggestions: sinon.stub().resolves([]),
            save: sinon.stub().resolves(),
            setUpdatedBy: sinon.stub().returnsThis(),
            setAuditId: sinon.stub().returnsThis(),
            getData: () => ({}),
            setData: () => {},
            addSuggestions: sinon.stub().resolves({ createdItems: [], errorItems: [] }),
          }),
        },
        Configuration: {
          findLatest: sinon.stub().resolves({
            isHandlerEnabledForSite: () => true,
          }),
        },
      };

      const testContext = {
        log: mockLogger,
        site: { getId: () => 'test-site' },
        finalUrl: 'https://example.com',
        env: { FIREFALL_MODEL: 'test-model' },
        audit: {
          getAuditResult: () => ({
            success: true,
            brokenExternalLinks: [{ urlFrom: 'https://example.com', urlTo: 'https://broken.com' }],
          }),
          getId: () => 'audit-id',
        },
        dataAccess: mockDataAccess,
      };

      // Pass a stub that throws
      const throwingGenerateSuggestionData = sinon.stub()
        .rejects(new Error('Test error'));
      const result = await opportunityAndSuggestionsStep(
        testContext,
        throwingGenerateSuggestionData,
      );
      expect(mockLogger.error).to.have.been.calledWith(
        '[undefined] [Site: test-site] suggestion generation error: Test error',
      );
      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should run generateSuggestionDataImpl successfully without error', async () => {
      const mockData = [{
        urlFrom: 'https://example.com',
        urlTo: 'https://broken-link.com',
        trafficDomain: 100,
      }];

      const testContext = {
        log: { info: sinon.stub(), error: sinon.stub() },
        site: { getId: () => 'test-site' },
        finalUrl: 'https://example.com',
        audit: {
          getAuditResult: () => ({ brokenExternalLinks: [] }),
          getId: () => 'audit-id',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
            create: sinon.stub().resolves({
              getId: () => 'oppty-id-123',
              addSuggestions: sinon.stub().resolves({ createdItems: [], errorItems: [] }),
              getSuggestions: sinon.stub().resolves([]),
              setAuditId: sinon.stub().returnsThis(),
              save: sinon.stub().resolves(),
              setData: () => {},
              getData: () => {},
              setUpdatedBy: sinon.stub().returnsThis(),
              getType: () => Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS,
              getSiteId: () => 'test-site',
            }),
          },
          Suggestion: {
            bulkUpdateStatus: sinon.stub().resolves(),
          },
        },
      };

      const mockGenerateSuggestionData = sinon.stub().resolves(mockData);

      const result = await opportunityAndSuggestionsStep(testContext, mockGenerateSuggestionData);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should log an error when generateSuggestionDataImpl throws', async () => {
      const error = new Error('Failed');

      const testContext = {
        log: { info: sinon.stub(), error: sinon.stub() },
        site: { getId: () => 'test-site' },
        finalUrl: 'https://example.com',
        audit: {
          getAuditResult: () => ({ brokenExternalLinks: [] }),
          getId: () => 'audit-id',
        },
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
          Suggestion: { bulkUpdateStatus: sinon.stub().resolves() },
        },
      };

      const failingGenerateSuggestionData = sinon.stub().rejects(error);

      const result = await opportunityAndSuggestionsStep(
        testContext,
        failingGenerateSuggestionData,
      );

      expect(testContext.log.error).to.have.been.calledWithMatch(
        `[${AUDIT_TYPE}] [Site: test-site] suggestion generation error: ${error.message}`,
      );

      expect(result).to.deep.equal({ status: 'complete' });
    });
  });
});
