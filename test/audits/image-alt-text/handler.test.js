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
import chaiAsPromised from 'chai-as-promised';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

describe('Image Alt Text Handler', () => {
  let sandbox;
  const bucketName = 'test-bucket';
  const s3BucketPath = 'scrapes/site-id/';
  let context;
  let tracingFetchStub;
  let handlerModule;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    tracingFetchStub = sandbox.stub().resolves({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(Buffer.from('test-blob')),
      headers: new Map([['Content-Length', '100']]),
    });
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        s3Client: {
          send: sandbox.stub().resolves({
            Contents: [
              { Key: `${s3BucketPath}page1/scrape.json` },
              { Key: `${s3BucketPath}page2/scrape.json` },
            ],
          }),
        },
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-id',
          resolveFinalURL: () => 'https://example.com',
          getConfig: () => ({
            getIncludedURLs: sandbox.stub().returns([]),
          }),
        },
        audit: {
          getId: () => 'audit-id',
        },
        env: {
          S3_SCRAPER_BUCKET_NAME: bucketName,
          IMS_HOST: 'test-ims-host',
          IMS_CLIENT_ID: 'test-client-id',
          IMS_CLIENT_CODE: 'test-client-code',
          IMS_CLIENT_SECRET: 'test-client-secret',
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              { getUrl: () => 'https://example.com/page1' },
              { getUrl: () => 'https://example.com/page2' },
            ]),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves({
              getId: sandbox.stub().returns('opportunity-id'),
              getData: sandbox.stub().returns({}),
              setData: sandbox.stub(),
              save: sandbox.stub().resolves(),
              getType: sandbox.stub().returns('alt-text'),
            }),
          },
        },
        imsHost: 'test-ims-host',
        clientId: 'test-client-id',
        clientCode: 'test-client-code',
        clientSecret: 'test-client-secret',
      })
      .build();

    // Mock the module using esmock
    handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processImportStep', () => {
    it('should prepare import step with correct parameters', async () => {
      const result = await handlerModule.processImportStep(context);

      expect(result).to.deep.equal({
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: s3BucketPath,
        type: 'top-pages',
        siteId: 'site-id',
      });
    });
  });

  describe('processAltTextWithMystique', () => {
    let sendAltTextOpportunityToMystiqueStub;
    let clearAltTextSuggestionsStub;

    beforeEach(async () => {
      sendAltTextOpportunityToMystiqueStub = sandbox.stub().resolves();
      clearAltTextSuggestionsStub = sandbox.stub().resolves();
      // Mock the module with our stubs
      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
        '../../../src/image-alt-text/opportunityHandler.js': {
          default: sandbox.stub(),
          sendAltTextOpportunityToMystique: sendAltTextOpportunityToMystiqueStub,
          clearAltTextSuggestions: clearAltTextSuggestionsStub,
        },
      });
    });

    it('should process alt-text with Mystique successfully', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
        'https://example.com',
        ['https://example.com/page1', 'https://example.com/page2'],
        'site-id',
        'audit-id',
        context,
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Processing alt-text with Mystique for site site-id',
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Sent 2 pages to Mystique for generating alt-text suggestions',
      );
    });

    it('should handle case when no top pages found', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      await expect(handlerModule.processAltTextWithMystique(context))
        .to.be.rejectedWith('No top pages found for site site-id');

      expect(context.log.error).to.have.been.calledWith(
        '[alt-text]: Failed to process with Mystique: No top pages found for site site-id',
      );
    });

    it('should handle errors when sending to Mystique fails', async () => {
      const error = new Error('Mystique send failed');
      sendAltTextOpportunityToMystiqueStub.rejects(error);
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      await expect(handlerModule.processAltTextWithMystique(context))
        .to.be.rejectedWith('Mystique send failed');

      expect(context.log.error).to.have.been.calledWith(
        '[alt-text]: Failed to process with Mystique: Mystique send failed',
      );
    });

    it('should update opportunity data when existing opportunity is found', async () => {
      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ existingData: 'value' }), // Return some existing data
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };

      // Override the default empty array with our mock opportunity
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      await handlerModule.processAltTextWithMystique(context);

      // Should NOT call clearAltTextSuggestions anymore
      expect(clearAltTextSuggestionsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        '[alt-text]: Updating opportunity for new audit run',
      );

      // Should call setData with preserved existing data
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({
          existingData: 'value', // Existing data preserved
          mystiqueResponsesReceived: 0,
          mystiqueResponsesExpected: sinon.match.number,
          processedSuggestionIds: [],
        }),
      );
    });

    it('should handle when existing opportunity getData returns null', async () => {
      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => null,
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({
          mystiqueResponsesReceived: 0,
          mystiqueResponsesExpected: sinon.match.number,
          processedSuggestionIds: [],
        }),
      );
    });

    it('should create new opportunity when no existing opportunity is found', async () => {
      // Ensure no existing opportunities are returned
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(clearAltTextSuggestionsStub).to.not.have.been.called;
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Creating new opportunity for site site-id',
      );
    });

    it('should handle includedURLs when site.getConfig is available', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getIncludedURLs: sandbox.stub().withArgs('alt-text').returns(['https://example.com/included']),
        }),
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
        'https://example.com',
        ['https://example.com/page1', 'https://example.com/page2', 'https://example.com/included'],
        'site-id',
        'audit-id',
        context,
      );
    });

    it('should handle when site.getConfig is null', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
        getConfig: () => null,
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
        'https://example.com',
        ['https://example.com/page1', 'https://example.com/page2'],
        'site-id',
        'audit-id',
        context,
      );
    });

    it('should handle when site.getConfig is undefined', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
        getConfig: undefined,
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
        'https://example.com',
        ['https://example.com/page1', 'https://example.com/page2'],
        'site-id',
        'audit-id',
        context,
      );
    });

    it('should handle when getIncludedURLs returns null', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getIncludedURLs: sandbox.stub().withArgs('alt-text').returns(null),
        }),
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
        'https://example.com',
        ['https://example.com/page1', 'https://example.com/page2'],
        'site-id',
        'audit-id',
        context,
      );
    });

    it('should handle case when no top pages and no included URLs found', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getIncludedURLs: sandbox.stub().withArgs('alt-text').returns([]),
        }),
      };

      await expect(handlerModule.processAltTextWithMystique(context))
        .to.be.rejectedWith('No top pages found for site site-id');
    });

    describe('outdating suggestions for URLs no longer in top pages', () => {
      let bulkUpdateStatusStub;

      beforeEach(() => {
        bulkUpdateStatusStub = sandbox.stub().resolves();
        context.dataAccess.Suggestion = {
          bulkUpdateStatus: bulkUpdateStatusStub,
        };
      });

      it('should mark suggestions as OUTDATED when their URL is not in current pageUrls', async () => {
        const existingSuggestions = [
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/old-page', // NOT in current pageUrls
                imageUrl: 'https://example.com/image1.jpg',
              }],
            }),
            getStatus: () => 'NEW',
          },
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page1', // IN current pageUrls
                imageUrl: 'https://example.com/image2.jpg',
              }],
            }),
            getStatus: () => 'NEW',
          },
        ];

        const mockOpportunity = {
          getType: () => AUDIT_TYPE,
          getId: () => 'opportunity-id',
          getData: () => ({}),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
          getSuggestions: sandbox.stub().resolves(existingSuggestions),
        };

        context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);
        context.site = {
          getId: () => 'site-id',
          getBaseURL: () => 'https://example.com',
        };

        await handlerModule.processAltTextWithMystique(context);

        // Only the suggestion with old-page URL should be marked as OUTDATED
        expect(bulkUpdateStatusStub).to.have.been.calledWith(
          [existingSuggestions[0]],
          'OUTDATED',
        );
        expect(context.log.info).to.have.been.calledWith(
          '[alt-text]: Marked 1 suggestions as OUTDATED',
        );
      });

      it('should skip suggestions without a pageUrl', async () => {
        const existingSuggestions = [
          {
            // Suggestion with no pageUrl - should be skipped
            getData: () => ({
              recommendations: [{
                imageUrl: 'https://example.com/image1.jpg',
                // no pageUrl
              }],
            }),
            getStatus: () => 'NEW',
          },
          {
            // Suggestion with null recommendations - should be skipped
            getData: () => ({}),
            getStatus: () => 'NEW',
          },
          {
            // Suggestion with empty recommendations array - should be skipped
            getData: () => ({
              recommendations: [],
            }),
            getStatus: () => 'NEW',
          },
          {
            // Valid suggestion with outdated URL - should be marked
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/old-page',
                imageUrl: 'https://example.com/image2.jpg',
              }],
            }),
            getStatus: () => 'NEW',
          },
        ];

        const mockOpportunity = {
          getType: () => AUDIT_TYPE,
          getId: () => 'opportunity-id',
          getData: () => ({}),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
          getSuggestions: sandbox.stub().resolves(existingSuggestions),
        };

        context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);
        context.site = {
          getId: () => 'site-id',
          getBaseURL: () => 'https://example.com',
        };

        await handlerModule.processAltTextWithMystique(context);

        // Only the last suggestion (with valid outdated URL) should be marked
        expect(bulkUpdateStatusStub).to.have.been.calledWith(
          [existingSuggestions[3]],
          'OUTDATED',
        );
      });

      it('should NOT mark manually edited suggestions as OUTDATED', async () => {
        const existingSuggestions = [
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/old-page', // NOT in current pageUrls
                imageUrl: 'https://example.com/image1.jpg',
                isManuallyEdited: true, // Should NOT be outdated
              }],
            }),
            getStatus: () => 'NEW',
          },
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/another-old-page', // NOT in current pageUrls
                imageUrl: 'https://example.com/image2.jpg',
                isManuallyEdited: false,
              }],
            }),
            getStatus: () => 'NEW',
          },
        ];

        const mockOpportunity = {
          getType: () => AUDIT_TYPE,
          getId: () => 'opportunity-id',
          getData: () => ({}),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
          getSuggestions: sandbox.stub().resolves(existingSuggestions),
        };

        context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);
        context.site = {
          getId: () => 'site-id',
          getBaseURL: () => 'https://example.com',
        };

        await handlerModule.processAltTextWithMystique(context);

        // Only the non-manually-edited suggestion should be marked as OUTDATED
        expect(bulkUpdateStatusStub).to.have.been.calledWith(
          [existingSuggestions[1]],
          'OUTDATED',
        );
      });

      it('should NOT re-process suggestions already in SKIPPED, FIXED, or OUTDATED status', async () => {
        const existingSuggestions = [
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/old-page',
                imageUrl: 'https://example.com/image1.jpg',
              }],
            }),
            getStatus: () => 'SKIPPED',
          },
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/another-old-page',
                imageUrl: 'https://example.com/image2.jpg',
              }],
            }),
            getStatus: () => 'FIXED',
          },
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/third-old-page',
                imageUrl: 'https://example.com/image3.jpg',
              }],
            }),
            getStatus: () => 'OUTDATED',
          },
        ];

        const mockOpportunity = {
          getType: () => AUDIT_TYPE,
          getId: () => 'opportunity-id',
          getData: () => ({}),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
          getSuggestions: sandbox.stub().resolves(existingSuggestions),
        };

        context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);
        context.site = {
          getId: () => 'site-id',
          getBaseURL: () => 'https://example.com',
        };

        await handlerModule.processAltTextWithMystique(context);

        // bulkUpdateStatus should NOT be called since all suggestions are in ignored statuses
        expect(bulkUpdateStatusStub).to.not.have.been.called;
      });

      it('should not call bulkUpdateStatus when no suggestions need to be outdated', async () => {
        const existingSuggestions = [
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page1', // IN current pageUrls
                imageUrl: 'https://example.com/image1.jpg',
              }],
            }),
            getStatus: () => 'NEW',
          },
        ];

        const mockOpportunity = {
          getType: () => AUDIT_TYPE,
          getId: () => 'opportunity-id',
          getData: () => ({}),
          setData: sandbox.stub(),
          save: sandbox.stub().resolves(),
          getSuggestions: sandbox.stub().resolves(existingSuggestions),
        };

        context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);
        context.site = {
          getId: () => 'site-id',
          getBaseURL: () => 'https://example.com',
        };

        await handlerModule.processAltTextWithMystique(context);

        // bulkUpdateStatus should NOT be called since all URLs are in current pageUrls
        expect(bulkUpdateStatusStub).to.not.have.been.called;
      });
    });
  });
});
