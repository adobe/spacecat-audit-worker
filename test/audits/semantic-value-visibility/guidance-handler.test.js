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
import esmock from 'esmock';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

use(sinonChai);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = join(__dirname, '../../fixtures/semantic-value-visibility');

// Load Krisshop fixture (new format with top-level guidance)
const krisshopFixture = JSON.parse(readFileSync(join(fixturesPath, 'Krisshop.json'), 'utf8'));

describe('Semantic Value Visibility Guidance Handler', () => {
  let context;
  let log;
  let Opportunity;
  let Site;
  let syncSuggestionsStub;
  let convertToOpportunityStub;
  let handler;
  let dummyOpportunity;

  beforeEach(async function () {
    this.timeout(10000);

    // Stub external dependencies - these are FAKE, not real
    syncSuggestionsStub = sinon.stub().resolves();
    convertToOpportunityStub = sinon.stub();

    // Load handler with mocked dependencies
    const mockedHandler = await esmock(
      '../../../src/semantic-value-visibility/guidance-handler.js',
      {
        '../../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
      },
    );

    handler = mockedHandler.default;

    // Fake opportunity object
    dummyOpportunity = {
      getId: sinon.stub().returns('oppty-123'),
    };

    convertToOpportunityStub.resolves(dummyOpportunity);

    // Fake database
    Opportunity = {
      allBySiteIdAndStatus: sinon.stub().resolves([]),
    };

    Site = {
      findById: sinon.stub().resolves({ getId: () => 'site-123' }),
    };

    // Fake logger
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    context = {
      log,
      dataAccess: {
        Opportunity,
        Site,
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('processing Krisshop fixture', () => {
    it('should create opportunity and sync suggestions', async () => {
      const message = {
        siteId: 'site-krisshop',
        auditId: 'audit-123',
        url: krisshopFixture.url,
        data: {
          url: krisshopFixture.url,
          guidance: krisshopFixture.guidance,
          suggestions: krisshopFixture.suggestions,
        },
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(200);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0].newData).to.have.lengthOf(krisshopFixture.suggestions.length);
    });

    it('should preserve suggestion data structure', async () => {
      const message = {
        siteId: 'site-krisshop',
        auditId: 'audit-123',
        url: krisshopFixture.url,
        data: {
          url: krisshopFixture.url,
          guidance: krisshopFixture.guidance,
          suggestions: krisshopFixture.suggestions,
        },
      };

      await handler(message, context);

      const syncCall = syncSuggestionsStub.getCall(0);
      const syncArgs = syncCall.args[0];
      const firstSuggestion = syncArgs.newData[0];

      expect(firstSuggestion.imageUrl).to.be.a('string');
      expect(firstSuggestion.semanticHtml).to.be.a('string');
      expect(firstSuggestion.detectedText).to.be.an('array');
      expect(firstSuggestion.transformRules.action).to.equal('insertAfter');
      expect(firstSuggestion.transformRules.selector).to.be.a('string');
    });

    it('should use imageUrl as unique key', async () => {
      const message = {
        siteId: 'site-krisshop',
        auditId: 'audit-123',
        url: krisshopFixture.url,
        data: {
          url: krisshopFixture.url,
          guidance: krisshopFixture.guidance,
          suggestions: krisshopFixture.suggestions,
        },
      };

      await handler(message, context);

      const syncCall = syncSuggestionsStub.getCall(0);
      const syncArgs = syncCall.args[0];
      const testData = krisshopFixture.suggestions[0].data;
      const key = syncArgs.buildKey(testData);
      expect(key).to.equal(testData.imageUrl);
    });

    it('should map suggestions with correct structure', async () => {
      const message = {
        siteId: 'site-krisshop',
        auditId: 'audit-123',
        url: krisshopFixture.url,
        data: {
          url: krisshopFixture.url,
          guidance: krisshopFixture.guidance,
          suggestions: krisshopFixture.suggestions,
        },
      };

      await handler(message, context);

      const syncCall = syncSuggestionsStub.getCall(0);
      const syncArgs = syncCall.args[0];
      const testData = krisshopFixture.suggestions[0].data;
      const mappedSuggestion = syncArgs.mapNewSuggestion(testData);

      expect(mappedSuggestion.opportunityId).to.equal('oppty-123');
      expect(mappedSuggestion.type).to.equal('SUGGESTION_CODE');
      expect(mappedSuggestion.rank).to.equal(0);
      expect(mappedSuggestion.data).to.deep.equal(testData);
    });
  });

  describe('empty suggestions', () => {
    it('should return ok when no suggestions', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        url: 'https://example.com',
        data: {
          suggestions: [],
        },
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(200);
      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(syncSuggestionsStub).not.to.have.been.called;
    });

    it('should handle missing suggestions array', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        url: 'https://example.com',
        data: {},
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(200);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });
  });

  describe('error handling', () => {
    it('should return badRequest when opportunity creation fails', async () => {
      // Make convertToOpportunity return null (failure)
      convertToOpportunityStub.resolves(null);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        url: krisshopFixture.url,
        data: {
          url: krisshopFixture.url,
          guidance: krisshopFixture.guidance,
          suggestions: krisshopFixture.suggestions,
        },
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(400);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to create opportunity/),
      );
    });

    it('should return notFound when site is not found', async () => {
      Site.findById.resolves(null);

      const message = {
        siteId: 'invalid-site',
        auditId: 'audit-456',
        url: 'https://example.com',
        data: {
          suggestions: krisshopFixture.suggestions,
        },
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(404);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Site not found/),
      );
    });

    it('should return badRequest when suggestions is not an array', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        url: 'https://example.com',
        data: {
          suggestions: 'not-an-array',
        },
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(400);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Invalid suggestions format/),
      );
    });

    it('should skip suggestions with missing required fields', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        url: 'https://example.com',
        data: {
          suggestions: [
            { data: { imageUrl: 'https://example.com/img.jpg' } }, // missing semanticHtml
            { data: { semanticHtml: '<section></section>' } }, // missing imageUrl
            { data: { imageUrl: 'https://example.com/valid.jpg', semanticHtml: '<section>Valid</section>' } }, // valid
          ],
        },
      };

      await handler(message, context);

      // Should have logged warnings for invalid suggestions
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Skipping suggestion with missing/),
      );

      // Should only sync the 1 valid suggestion
      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0].newData).to.have.lengthOf(1);
    });
  });

  describe('stale opportunity cleanup', () => {
    it('should mark stale opportunity as RESOLVED when no new suggestions', async () => {
      const staleOpportunity = {
        getId: sinon.stub().returns('stale-oppty-123'),
        getType: sinon.stub().returns('semantic-value-visibility'),
        setStatus: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      Opportunity.allBySiteIdAndStatus.resolves([staleOpportunity]);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        url: 'https://example.com',
        data: {
          suggestions: [],
        },
      };

      await handler(message, context);

      expect(staleOpportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(staleOpportunity.save).to.have.been.calledOnce;
    });
  });
});
