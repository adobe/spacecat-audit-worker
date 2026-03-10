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
import { HeadObjectCommand } from '@aws-sdk/client-s3';
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
    let isAuditEnabledForSiteStub;

    beforeEach(async () => {
      sendAltTextOpportunityToMystiqueStub = sandbox.stub().resolves();
      clearAltTextSuggestionsStub = sandbox.stub().resolves();
      isAuditEnabledForSiteStub = sandbox.stub().resolves(false); // Default to 100 page limit
      // Mock the module with our stubs
      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
        '../../../src/image-alt-text/opportunityHandler.js': {
          default: sandbox.stub(),
          sendAltTextOpportunityToMystique: sendAltTextOpportunityToMystiqueStub,
          clearAltTextSuggestions: clearAltTextSuggestionsStub,
        },
        '../../../src/common/audit-utils.js': {
          isAuditEnabledForSite: isAuditEnabledForSiteStub,
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
        [],
        false,
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
        [],
        false,
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
        [],
        false,
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
        [],
        false,
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
        [],
        false,
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

      it('should pass imageUrlsWithAltText from existing NEW suggestions to Mystique', async () => {
        const existingSuggestions = [
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page1',
                imageUrl: 'https://example.com/image1.jpg',
              }],
            }),
            getStatus: () => 'NEW',
          },
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page2',
                imageUrl: 'https://example.com/image2.jpg',
              }],
            }),
            getStatus: () => 'SKIPPED', // Not NEW, should be excluded
          },
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page1',
                imageUrl: 'https://example.com/image3.jpg',
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

        expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
          'https://example.com',
          sinon.match.array,
          'site-id',
          'audit-id',
          context,
          ['https://example.com/image1.jpg', 'https://example.com/image3.jpg'],
          false,
        );
      });

      it('should exclude just-outdated suggestions from imageUrlsWithAltText', async () => {
        const existingSuggestions = [
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/old-page', // NOT in current pageUrls, will be outdated
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

        // image1.jpg should be excluded because its suggestion was just marked OUTDATED
        // image2.jpg should be included because it's a NEW suggestion on a current page
        expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
          'https://example.com',
          sinon.match.array,
          'site-id',
          'audit-id',
          context,
          ['https://example.com/image2.jpg'],
          false,
        );
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

  describe('processScraping', () => {
    let s3ClientMock;
    let isAuditEnabledForSiteStub;

    beforeEach(async () => {
      s3ClientMock = {
        send: sandbox.stub(),
      };

      isAuditEnabledForSiteStub = sandbox.stub();

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          s3Client: s3ClientMock,
          site: {
            getId: () => 'site-id',
            getBaseURL: () => 'https://example.com',
          },
          env: {
            S3_SCRAPER_BUCKET_NAME: bucketName,
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://example.com/page1' },
                { getUrl: () => 'https://example.com/page2' },
                { getUrl: () => 'https://example.com/page3' },
              ]),
            },
          },
        })
        .build();

      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '../../../src/common/audit-utils.js': {
          isAuditEnabledForSite: isAuditEnabledForSiteStub,
        },
      });
    });

    it('should check S3 for existing scrapes and return missing URLs', async () => {
      isAuditEnabledForSiteStub.resolves(false); // Regular site, 100 page limit

      // Mock S3 responses: page1 exists, page2 and page3 don't
      s3ClientMock.send.callsFake((command) => {
        if (command instanceof HeadObjectCommand) {
          const key = command.input.Key;
          if (key.includes('page1')) {
            return Promise.resolve(); // Scrape exists
          }
          const error = new Error('NotFound');
          error.name = 'NotFound';
          throw error;
        }
        return Promise.resolve();
      });

      const result = await handlerModule.processScraping(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page2' },
          { url: 'https://example.com/page3' },
        ],
        siteId: 'site-id',
        type: 'default',
        allowCache: false,
        maxScrapeAge: 0,
      });

      // Verify HeadObjectCommand was called for each page
      expect(s3ClientMock.send).to.have.been.calledThrice;
      expect(s3ClientMock.send).to.have.been.calledWith(
        sinon.match.instanceOf(HeadObjectCommand),
      );
    });

    it('should send first URL when all scrapes exist', async () => {
      isAuditEnabledForSiteStub.resolves(false);

      // Mock S3 to return success for all pages
      s3ClientMock.send.resolves();

      const result = await handlerModule.processScraping(context);

      expect(result).to.deep.equal({
        urls: [{ url: 'https://example.com/page1' }],
        siteId: 'site-id',
        type: 'default',
        allowCache: true,
        maxScrapeAge: 0,
      });
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: All scrapes exist, sending first URL to ensure scrape client step completes',
      );
    });

    it('should throw error when no top pages found', async () => {
      isAuditEnabledForSiteStub.resolves(false);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(handlerModule.processScraping(context))
        .to.be.rejectedWith('No top pages found for site site-id');
    });

    it('should limit pages to 20 when summit-plg is enabled', async () => {
      isAuditEnabledForSiteStub.resolves(true); // summit-plg enabled

      // Create 25 pages to ensure slicing works
      const pages = Array.from({ length: 25 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i + 1}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(pages);

      // All scrapes missing
      const error = new Error('NotFound');
      error.name = 'NotFound';
      s3ClientMock.send.rejects(error);

      const result = await handlerModule.processScraping(context);

      // Should only check first 20 pages
      expect(s3ClientMock.send).to.have.callCount(20);
      expect(result.urls).to.have.lengthOf(20);
      expect(result.urls[0].url).to.equal('https://example.com/page1');
      expect(result.urls[19].url).to.equal('https://example.com/page20');
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 20 (summit-plg enabled: true)',
      );
    });

    it('should limit pages to 100 when summit-plg is disabled', async () => {
      isAuditEnabledForSiteStub.resolves(false); // summit-plg disabled

      // Create 150 pages to ensure slicing works
      const pages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i + 1}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(pages);

      // All scrapes missing
      const error = new Error('NotFound');
      error.name = 'NotFound';
      s3ClientMock.send.rejects(error);

      const result = await handlerModule.processScraping(context);

      // Should check first 100 pages
      expect(s3ClientMock.send).to.have.callCount(100);
      expect(result.urls).to.have.lengthOf(100);
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 100 (summit-plg enabled: false)',
      );
    });

    it('should handle NoSuchKey error as missing scrape', async () => {
      isAuditEnabledForSiteStub.resolves(false);

      const error = new Error('NoSuchKey');
      error.name = 'NoSuchKey';
      s3ClientMock.send.rejects(error);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(3);
      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/page2' },
        { url: 'https://example.com/page3' },
      ]);
    });

    it('should handle other S3 errors with fail-safe approach', async () => {
      isAuditEnabledForSiteStub.resolves(false);

      const error = new Error('S3 Connection timeout');
      error.name = 'NetworkError';
      s3ClientMock.send.rejects(error);

      const result = await handlerModule.processScraping(context);

      // Should assume all scrapes are missing (fail-safe)
      expect(result.urls).to.have.lengthOf(3);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Error checking scrape for.*assuming missing/),
      );
    });

    it('should use correct S3 key format with pathname', async () => {
      isAuditEnabledForSiteStub.resolves(false);

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => 'https://example.com/products/item1' },
      ]);

      s3ClientMock.send.resolves();

      await handlerModule.processScraping(context);

      expect(s3ClientMock.send).to.have.been.calledWith(
        sinon.match((cmd) => cmd instanceof HeadObjectCommand
          && cmd.input.Bucket === bucketName
          && cmd.input.Key === 'scrapes/site-id/products/item1/scrape.json'),
      );
    });

    it('should handle mix of existing and missing scrapes', async () => {
      isAuditEnabledForSiteStub.resolves(false);

      // page1 exists, page2 doesn't, page3 exists
      s3ClientMock.send.callsFake((command) => {
        if (command instanceof HeadObjectCommand) {
          const key = command.input.Key;
          if (key.includes('page2')) {
            const error = new Error('NotFound');
            error.name = 'NotFound';
            throw error;
          }
          return Promise.resolve();
        }
        return Promise.resolve();
      });

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0].url).to.equal('https://example.com/page2');
      expect(context.log.info).to.have.been.calledWith(
        '[alt-text]: Found 1 URLs needing scraping out of 3 top pages',
      );
    });
  });

  describe('processAltTextWithMystique with page limits', () => {
    let sendAltTextOpportunityToMystiqueStub;
    let isAuditEnabledForSiteStub;

    beforeEach(async () => {
      sendAltTextOpportunityToMystiqueStub = sandbox.stub().resolves();
      isAuditEnabledForSiteStub = sandbox.stub();

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: {
            getId: () => 'site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({
              getIncludedURLs: sandbox.stub().returns([]),
            }),
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub(),
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
        })
        .build();

      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
        '../../../src/image-alt-text/opportunityHandler.js': {
          default: sandbox.stub(),
          sendAltTextOpportunityToMystique: sendAltTextOpportunityToMystiqueStub,
        },
        '../../../src/common/audit-utils.js': {
          isAuditEnabledForSite: isAuditEnabledForSiteStub,
        },
      });
    });

    it('should limit to 20 pages when summit-plg is enabled', async () => {
      isAuditEnabledForSiteStub.resolves(true); // summit-plg enabled

      // Create 50 pages
      const pages = Array.from({ length: 50 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i + 1}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(pages);

      await handlerModule.processAltTextWithMystique(context);

      // Should only send first 20 pages to Mystique
      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];
      expect(sentUrls).to.have.lengthOf(20);
      expect(sentUrls[0]).to.equal('https://example.com/page1');
      expect(sentUrls[19]).to.equal('https://example.com/page20');
      expect(callArgs[6]).to.equal(true);

      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 20 (summit-plg enabled: true)',
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Using 20 top pages out of 50 (limit: 20)',
      );
    });

    it('should limit to 100 pages when summit-plg is disabled', async () => {
      isAuditEnabledForSiteStub.resolves(false); // summit-plg disabled

      // Create 150 pages
      const pages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i + 1}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(pages);

      await handlerModule.processAltTextWithMystique(context);

      // Should only send first 100 pages to Mystique
      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];
      expect(sentUrls).to.have.lengthOf(100);
      expect(sentUrls[0]).to.equal('https://example.com/page1');
      expect(sentUrls[99]).to.equal('https://example.com/page100');
      expect(callArgs[6]).to.equal(false);

      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 100 (summit-plg enabled: false)',
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Using 100 top pages out of 150 (limit: 100)',
      );
    });

    it('should include includedURLs in addition to limited top pages', async () => {
      isAuditEnabledForSiteStub.resolves(true); // 20 page limit

      const pages = Array.from({ length: 25 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i + 1}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(pages);

      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getIncludedURLs: sandbox.stub().withArgs('alt-text').returns([
            'https://example.com/included1',
            'https://example.com/included2',
          ]),
        }),
      };

      await handlerModule.processAltTextWithMystique(context);

      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];

      // Should have 20 top pages + 2 included URLs = 22 total
      expect(sentUrls).to.have.lengthOf(22);
      expect(sentUrls).to.include('https://example.com/included1');
      expect(sentUrls).to.include('https://example.com/included2');
      expect(sentUrls).to.include('https://example.com/page1');
      expect(sentUrls).to.include('https://example.com/page20');
      expect(sentUrls).to.not.include('https://example.com/page21');
      expect(callArgs[6]).to.equal(true);
    });

    it('should handle when isAuditEnabledForSite throws error', async () => {
      isAuditEnabledForSiteStub.rejects(new Error('Configuration error'));

      await expect(handlerModule.processAltTextWithMystique(context))
        .to.be.rejectedWith('Configuration error');

      expect(context.log.error).to.have.been.calledWith(
        '[alt-text]: Failed to process with Mystique: Configuration error',
      );
    });
  });
});
