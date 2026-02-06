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

/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('On-Page SEO Handler Tests', () => {
  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';
  const baseURL = 'https://example.com';

  let context;
  let sandbox;
  let site;
  let audit;
  let validateUrlsStub;
  let createOpportunityStub;
  let createSuggestionStub;
  let sendMessageStub;
  let handler;
  let processKeywordClusters;

  before('setup', async () => {
    sandbox = sinon.createSandbox();

    validateUrlsStub = sandbox.stub();
    createOpportunityStub = {
      getId: () => 'oppty-123',
    };

    // Load the handler with mocked dependencies
    const handlerModule = await esmock('../../src/on-page-seo/handler.js', {
      '../../src/utils/seo-validators.js': {
        validateUrls: validateUrlsStub,
      },
      '../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves(createOpportunityStub),
      },
    });

    handler = handlerModule.default;
    processKeywordClusters = handlerModule.processKeywordClusters;
  });

  beforeEach(() => {
    sandbox.resetHistory();

    site = {
      getBaseURL: () => baseURL,
      getId: () => siteId,
      getDeliveryType: () => 'aem_edge',
    };

    audit = {
      getId: () => auditId,
      getAuditType: () => 'on-page-seo',
    };

    createSuggestionStub = sandbox.stub().resolves();
    sendMessageStub = sandbox.stub().resolves();

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves(site),
          },
          Audit: {
            findById: sandbox.stub().resolves(audit),
          },
          Suggestion: {
            create: createSuggestionStub,
          },
        },
        sqs: {
          sendMessage: sendMessageStub,
        },
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processKeywordClusters', () => {
    it('should return early if no mappings provided', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          clusters: [],
          mappings: [],
        },
      };

      const result = await processKeywordClusters(message, context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(validateUrlsStub).to.not.have.been.called;
    });

    it('should process mappings, validate URLs, and create opportunity', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          clusters: [{ name: 'cluster1' }],
          mappings: [
            {
              url: 'https://example.com/page1',
              keywords: ['keyword1', 'keyword2'],
              searchVolume: 5000,
              difficulty: 35,
              ranking: 7,
            },
            {
              url: 'https://example.com/page2',
              keywords: ['keyword3'],
              searchVolume: 8000,
              difficulty: 25,
              ranking: 5,
            },
          ],
        },
      };

      // Mock validation - all clean
      validateUrlsStub.resolves([
        {
          url: 'https://example.com/page1',
          indexable: true,
          blockers: [],
          checks: {},
        },
        {
          url: 'https://example.com/page2',
          indexable: true,
          blockers: [],
          checks: {},
        },
      ]);

      const result = await processKeywordClusters(message, context);

      expect(result.status).to.equal('complete');
      expect(result.opportunity).to.equal(createOpportunityStub);
      expect(validateUrlsStub).to.have.been.calledOnce;
      expect(sendMessageStub).to.have.been.calledOnce;
    });

    it('should select top 5 opportunities by quick-win score', async () => {
      const mappings = Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/page${i}`,
        keywords: [`keyword${i}`],
        searchVolume: 1000 * (i + 1),
        difficulty: 30,
        ranking: 5,
      }));

      const message = {
        siteId,
        auditId,
        data: {
          clusters: [],
          mappings,
        },
      };

      // Mock validation to return clean URLs
      validateUrlsStub.resolves(
        Array.from({ length: 5 }, (_, i) => ({
          url: `https://example.com/page${9 - i}`,
          indexable: true,
          blockers: [],
          checks: {},
        })),
      );

      await processKeywordClusters(message, context);

      // Get the most recent call (last call index)
      const validateCall = validateUrlsStub.lastCall;
      const urlsArg = validateCall.args[0];
      expect(urlsArg).to.have.lengthOf(5); // Only top 5 selected
      // Verify they are sorted by quick-win score (highest search volume first)
      expect(urlsArg[0]).to.equal('https://example.com/page9'); // Highest score
    });

    it('should create suggestions for blocked URLs with technical details', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          clusters: [],
          mappings: [
            {
              url: 'https://example.com/page1',
              keywords: ['keyword1'],
              searchVolume: 5000,
              difficulty: 35,
              ranking: 7,
            },
          ],
        },
      };

      // Mock validation - blocked URL
      validateUrlsStub.resolves([
        {
          url: 'https://example.com/page1',
          indexable: false,
          blockers: ['http-error'],
          checks: {
            httpStatus: { passed: false, statusCode: 404 },
          },
        },
      ]);

      await processKeywordClusters(message, context);

      expect(createSuggestionStub).to.have.been.calledOnce;
      const suggestionData = createSuggestionStub.getCall(0).args[0];
      expect(suggestionData.data.requiresTechnicalFix).to.be.true;
      expect(suggestionData.data.technicalIssues).to.deep.equal(['http-error']);
      expect(suggestionData.data.checks).to.exist;
    });

    it('should send clean URLs to Mystique with correct message format', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          clusters: [{ name: 'cluster1' }],
          mappings: [
            {
              url: 'https://example.com/page1',
              keywords: ['keyword1'],
              searchVolume: 5000,
              difficulty: 35,
              ranking: 7,
            },
          ],
        },
      };

      validateUrlsStub.resolves([
        {
          url: 'https://example.com/page1',
          indexable: true,
          blockers: [],
          checks: {},
        },
      ]);

      await processKeywordClusters(message, context);

      expect(sendMessageStub).to.have.been.calledOnce;
      const messageToMystique = sendMessageStub.getCall(0).args[1];
      expect(messageToMystique.type).to.equal('guidance:on-page-seo');
      expect(messageToMystique.opportunityId).to.equal('oppty-123');
      expect(messageToMystique.data.urls).to.have.lengthOf(1);
      expect(messageToMystique.data.urls[0]).to.include({
        url: 'https://example.com/page1',
        searchVolume: 5000,
        difficulty: 35,
        ranking: 7,
      });
    });

    it('should not send message to Mystique if all URLs are blocked', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          clusters: [],
          mappings: [
            {
              url: 'https://example.com/page1',
              keywords: ['keyword1'],
              searchVolume: 5000,
              difficulty: 35,
              ranking: 7,
            },
          ],
        },
      };

      // All URLs blocked
      validateUrlsStub.resolves([
        {
          url: 'https://example.com/page1',
          indexable: false,
          blockers: ['http-error'],
          checks: {},
        },
      ]);

      await processKeywordClusters(message, context);

      expect(sendMessageStub).to.not.have.been.called;
    });

    it('should respect requiresValidation flag for suggestion status', async () => {
      context.site = { requiresValidation: true };

      const message = {
        siteId,
        auditId,
        data: {
          clusters: [],
          mappings: [
            {
              url: 'https://example.com/page1',
              keywords: ['keyword1'],
              searchVolume: 5000,
              difficulty: 35,
              ranking: 7,
            },
          ],
        },
      };

      validateUrlsStub.resolves([
        {
          url: 'https://example.com/page1',
          indexable: false,
          blockers: ['http-error'],
          checks: {},
        },
      ]);

      await processKeywordClusters(message, context);

      const suggestionData = createSuggestionStub.getCall(0).args[0];
      expect(suggestionData.status).to.equal('PENDING_VALIDATION');
    });
  });

  describe('default handler', () => {
    it('should call processKeywordClusters', async () => {
      const message = {
        siteId,
        auditId,
        data: {
          clusters: [],
          mappings: [],
        },
      };

      const result = await handler(message, context);

      expect(result).to.deep.equal({ status: 'complete' });
    });
  });
});

