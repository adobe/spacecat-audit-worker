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
  let getTopPageUrlsStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    tracingFetchStub = sandbox.stub().resolves({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(Buffer.from('test-blob')),
      headers: new Map([['Content-Length', '100']]),
    });
    getTopPageUrlsStub = sandbox.stub().resolves([
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
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
          getBaseURL: () => 'https://example.com',
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
          Configuration: {
            findLatest: sandbox.stub().resolves({
              getEnabledSiteIdsForHandler: sandbox.stub().returns([]),
              isHandlerEnabledForSite: sandbox.stub().returns(false),
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
      '../../../src/image-alt-text/url-utils.js': {
        getTopPageUrls: getTopPageUrlsStub,
      },
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

  describe('isDecorativeAgentEnabled', () => {
    it('should return true when enabled sites is empty', async () => {
      context.dataAccess.Configuration = {
        findLatest: sandbox.stub().resolves({
          getEnabledSiteIdsForHandler: sandbox.stub().returns([]),
        }),
      };
      const result = await handlerModule.isDecorativeAgentEnabled(context);
      expect(result).to.be.true;
    });

    it('should return false when enabled sites is non-empty', async () => {
      context.dataAccess.Configuration = {
        findLatest: sandbox.stub().resolves({
          getEnabledSiteIdsForHandler: sandbox.stub().returns(['site-1']),
        }),
      };
      const result = await handlerModule.isDecorativeAgentEnabled(context);
      expect(result).to.be.false;
    });
  });

  describe('processAltTextWithMystique', () => {
    let sendAltTextOpportunityToMystiqueStub;

    beforeEach(async () => {
      sendAltTextOpportunityToMystiqueStub = sandbox.stub().resolves();
      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
        '../../../src/image-alt-text/opportunityHandler.js': {
          default: sandbox.stub(),
          sendAltTextOpportunityToMystique: sendAltTextOpportunityToMystiqueStub,
        },
        '../../../src/image-alt-text/url-utils.js': {
          getTopPageUrls: getTopPageUrlsStub,
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
        true,
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Processing alt-text with Mystique for site site-id',
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Sent 2 pages to Mystique for generating alt-text suggestions',
      );
    });

    it('should handle case when no top pages found', async () => {
      getTopPageUrlsStub.resolves([]);
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

      expect(context.log.info).to.have.been.calledWith(
        '[alt-text]: Updating opportunity for new audit run',
      );

      // Should call setData with preserved existing data and topPagesOffset
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({
          existingData: 'value', // Existing data preserved
          topPagesOffset: 0,
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
          topPagesOffset: 0,
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

      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Creating new opportunity for site site-id',
      );
    });

    it('should pass URLs from getTopPageUrls directly to Mystique', async () => {
      getTopPageUrlsStub.resolves([
        'https://example.com/rum-page1',
        'https://example.com/rum-page2',
        'https://example.com/rum-page3',
      ]);
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      await handlerModule.processAltTextWithMystique(context);

      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.calledWith(
        'https://example.com',
        ['https://example.com/rum-page1', 'https://example.com/rum-page2', 'https://example.com/rum-page3'],
        'site-id',
        'audit-id',
        context,
        [],
        false,
        true,
      );
    });

    it('should handle case when all URL sources return empty', async () => {
      getTopPageUrlsStub.resolves([]);
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
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
          true,
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
          true,
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
    let configurationMock;

    beforeEach(async () => {
      configurationMock = {
        isHandlerEnabledForSite: sandbox.stub().returns(false),
      };

      getTopPageUrlsStub.resolves([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
      ]);

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: {
            getId: () => 'site-id',
            getBaseURL: () => 'https://example.com',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
            },
            Configuration: {
              findLatest: sandbox.stub().resolves(configurationMock),
            },
          },
        })
        .build();

      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '../../../src/image-alt-text/url-utils.js': {
          getTopPageUrls: getTopPageUrlsStub,
        },
      });
    });

    it('should send all URLs to scrape client with maxScrapeAge and pageLoadTimeout', async () => {
      const result = await handlerModule.processScraping(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
          { url: 'https://example.com/page3' },
        ],
        siteId: 'site-id',
        type: 'default',
        maxScrapeAge: 24,
        options: {
          pageLoadTimeout: 45000,
        },
      });

      expect(context.log.info).to.have.been.calledWith(
        '[alt-text]: Sending 3 URLs to scrape client (maxScrapeAge: 24h)',
      );
    });

    it('should throw error when no top pages found', async () => {
      getTopPageUrlsStub.resolves([]);

      await expect(handlerModule.processScraping(context))
        .to.be.rejectedWith('No top pages found for site site-id');
    });

    it('should limit pages to 20 when summit-plg is enabled', async () => {
      configurationMock.isHandlerEnabledForSite.returns(true);

      const pageUrls = Array.from({ length: 25 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(result.urls[0].url).to.equal('https://example.com/page1');
      expect(result.urls[19].url).to.equal('https://example.com/page20');
      expect(result.maxScrapeAge).to.equal(24);
      expect(result.options).to.deep.equal({ pageLoadTimeout: 45000 });
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 20 (summit-plg enabled: true)',
      );
    });

    it('should limit pages to 100 when summit-plg is disabled', async () => {
      const pageUrls = Array.from({ length: 150 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(100);
      expect(result.maxScrapeAge).to.equal(24);
      expect(result.options).to.deep.equal({ pageLoadTimeout: 45000 });
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 100 (summit-plg enabled: false)',
      );
    });
  });

  describe('processAltTextWithMystique with page limits', () => {
    let sendAltTextOpportunityToMystiqueStub;
    let configurationMock;

    beforeEach(async () => {
      sendAltTextOpportunityToMystiqueStub = sandbox.stub().resolves();
      configurationMock = {
        getEnabledSiteIdsForHandler: sandbox.stub().returns([]),
        isHandlerEnabledForSite: sandbox.stub().returns(false),
      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: {
            getId: () => 'site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
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
            Configuration: {
              findLatest: sandbox.stub().resolves(configurationMock),
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
        '../../../src/image-alt-text/url-utils.js': {
          getTopPageUrls: getTopPageUrlsStub,
        },
      });
    });

    it('should limit to 20 pages when summit-plg is enabled', async () => {
      configurationMock.isHandlerEnabledForSite.returns(true);

      // Create 50 page URLs
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      await handlerModule.processAltTextWithMystique(context);

      // Should only send first 20 pages to Mystique
      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];
      expect(sentUrls).to.have.lengthOf(20);
      expect(sentUrls[0]).to.equal('https://example.com/page1');
      expect(sentUrls[19]).to.equal('https://example.com/page20');
      expect(callArgs[6]).to.equal(true);
      expect(callArgs[7]).to.equal(true);

      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 20 (summit-plg enabled: true)',
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Using pages 0-19 of 50 (limit: 20)',
      );
    });

    it('should limit to 100 pages when summit-plg is disabled', async () => {
      // Create 150 page URLs
      const pageUrls = Array.from({ length: 150 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      await handlerModule.processAltTextWithMystique(context);

      // Should only send first 100 pages to Mystique
      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];
      expect(sentUrls).to.have.lengthOf(100);
      expect(sentUrls[0]).to.equal('https://example.com/page1');
      expect(sentUrls[99]).to.equal('https://example.com/page100');
      expect(callArgs[6]).to.equal(false);
      expect(callArgs[7]).to.equal(true);

      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Page limit set to 100 (summit-plg enabled: false)',
      );
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: Using pages 0-99 of 150 (limit: 100)',
      );
    });

    it('should pass all URLs from getTopPageUrls through page window', async () => {
      configurationMock.isHandlerEnabledForSite.returns(true);

      // getTopPageUrls now handles the fallback chain including includedURLs
      const pageUrls = Array.from({ length: 25 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      await handlerModule.processAltTextWithMystique(context);

      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];

      // Should have 20 pages (summit-plg limit)
      expect(sentUrls).to.have.lengthOf(20);
      expect(sentUrls).to.include('https://example.com/page1');
      expect(sentUrls).to.include('https://example.com/page20');
      expect(sentUrls).to.not.include('https://example.com/page21');
      expect(callArgs[6]).to.equal(true);
      expect(callArgs[7]).to.equal(true);
    });

    it('should handle when Configuration.findLatest throws error', async () => {
      context.dataAccess.Configuration.findLatest.rejects(new Error('Configuration error'));

      await expect(handlerModule.processAltTextWithMystique(context))
        .to.be.rejectedWith('Configuration error');

      expect(context.log.error).to.have.been.calledWith(
        '[alt-text]: Failed to process with Mystique: Configuration error',
      );
    });
  });

  describe('processAltTextWithMystique reads stored offset', () => {
    let sendAltTextOpportunityToMystiqueStub;
    let configurationMock;
    let bulkUpdateStatusStub;

    beforeEach(async () => {
      sendAltTextOpportunityToMystiqueStub = sandbox.stub().resolves();
      bulkUpdateStatusStub = sandbox.stub().resolves();
      configurationMock = {
        getEnabledSiteIdsForHandler: sandbox.stub().returns([]),
        isHandlerEnabledForSite: sandbox.stub().returns(true),

      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: {
            getId: () => 'site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves({
                getId: sandbox.stub().returns('opportunity-id'),
                getData: sandbox.stub().returns({ topPagesOffset: 0 }),
                setData: sandbox.stub(),
                save: sandbox.stub().resolves(),
                getType: sandbox.stub().returns('alt-text'),
              }),
            },
            Suggestion: {
              bulkUpdateStatus: bulkUpdateStatusStub,
            },
            Configuration: {
              findLatest: sandbox.stub().resolves(configurationMock),
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
        '../../../src/image-alt-text/url-utils.js': {
          getTopPageUrls: getTopPageUrlsStub,
        },
      });
    });

    it('should use stored offset from opportunity to determine page window', async () => {
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 20 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      await handlerModule.processAltTextWithMystique(context);

      // Should process pages 20-39 based on stored offset
      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];
      expect(sentUrls).to.have.lengthOf(20);
      expect(sentUrls[0]).to.equal('https://example.com/page21');
      expect(sentUrls[19]).to.equal('https://example.com/page40');
    });

    it('should default to offset 0 when no opportunity exists', async () => {
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      await handlerModule.processAltTextWithMystique(context);

      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];
      expect(sentUrls).to.have.lengthOf(20);
      expect(sentUrls[0]).to.equal('https://example.com/page1');
    });

    it('should ignore offset for non-summit-plg sites (always starts at 0)', async () => {
      configurationMock.isHandlerEnabledForSite.returns(false);

      const pageUrls = Array.from({ length: 150 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 20 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      await handlerModule.processAltTextWithMystique(context);

      const callArgs = sendAltTextOpportunityToMystiqueStub.getCall(0).args;
      const sentUrls = callArgs[1];
      expect(sentUrls).to.have.lengthOf(100);
      expect(sentUrls[0]).to.equal('https://example.com/page1');
    });

    it('should store topPagesOffset: 0 when creating new opportunity', async () => {
      const pageUrls = Array.from({ length: 5 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      await handlerModule.processAltTextWithMystique(context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledWith(
        sinon.match({
          data: sinon.match({ topPagesOffset: 0 }),
        }),
      );
    });
  });

  describe('processAltTextWithMystique scrape pre-check', () => {
    let sendAltTextOpportunityToMystiqueStub;

    beforeEach(async () => {
      sendAltTextOpportunityToMystiqueStub = sandbox.stub().resolves();
      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: sandbox.stub().resolves() },
        '../../../src/image-alt-text/opportunityHandler.js': {
          default: sandbox.stub(),
          sendAltTextOpportunityToMystique: sendAltTextOpportunityToMystiqueStub,
        },
        '../../../src/image-alt-text/url-utils.js': {
          getTopPageUrls: getTopPageUrlsStub,
        },
      });
    });

    it('should throw when scrapeResultPaths is missing URLs', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      // scrapeResultPaths only has page1, but page2 is also expected
      context.scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/job-123/page1/scrape.json'],
      ]);

      await expect(handlerModule.processAltTextWithMystique(context))
        .to.be.rejectedWith('Cannot proceed: 1 of 2 URLs have no scrape results');

      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Missing scrapes for 1\/2 URLs/),
      );
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to process with Mystique.*Cannot proceed/),
      );
      expect(sendAltTextOpportunityToMystiqueStub).to.not.have.been.called;
    });

    it('should proceed when all URLs exist in scrapeResultPaths', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      context.scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/job-123/page1/scrape.json'],
        ['https://example.com/page2', 'scrapes/job-123/page2/scrape.json'],
      ]);

      await handlerModule.processAltTextWithMystique(context);

      expect(context.log.info).to.have.been.calledWith(
        '[alt-text]: Verified scrapes exist for all 2 page URLs',
      );
      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.called;
    });

    it('should warn and continue when scrapeResultPaths is not in context', async () => {
      context.site = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      // No scrapeResultPaths in context
      delete context.scrapeResultPaths;

      await handlerModule.processAltTextWithMystique(context);

      expect(context.log.warn).to.have.been.calledWith(
        '[alt-text]: No scrapeResultPaths in context, skipping scrape verification',
      );
      expect(sendAltTextOpportunityToMystiqueStub).to.have.been.called;
    });
  });

  describe('processScraping with page offset', () => {
    let configurationMock;

    beforeEach(async () => {
      configurationMock = {
        isHandlerEnabledForSite: sandbox.stub().returns(true),
      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: {
            getId: () => 'site-id',
            getBaseURL: () => 'https://example.com',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
            },
            Configuration: {
              findLatest: sandbox.stub().resolves(configurationMock),
            },
          },
        })
        .build();

      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '../../../src/image-alt-text/url-utils.js': {
          getTopPageUrls: getTopPageUrlsStub,
        },
      });
    });

    it('should advance offset when no NEW suggestions in current window', async () => {
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 0 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(result.urls[0].url).to.equal('https://example.com/page21');
      expect(result.urls[19].url).to.equal('https://example.com/page40');
      expect(result.maxScrapeAge).to.equal(24);
      expect(result.options).to.deep.equal({ pageLoadTimeout: 45000 });

      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ topPagesOffset: 20 }),
      );
      expect(mockOpportunity.save).to.have.been.called;
    });

    it('should keep offset when NEW suggestions exist in current window', async () => {
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 0 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page1',
                imageUrl: 'https://example.com/image1.jpg',
              }],
            }),
            getStatus: () => 'NEW',
          },
        ]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(result.urls[0].url).to.equal('https://example.com/page1');

      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ topPagesOffset: 0 }),
      );
    });

    it('should advance when only OUTDATED/SKIPPED suggestions in window', async () => {
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 0 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page1',
                imageUrl: 'https://example.com/image1.jpg',
              }],
            }),
            getStatus: () => 'OUTDATED',
          },
          {
            getData: () => ({
              recommendations: [{
                pageUrl: 'https://example.com/page2',
                imageUrl: 'https://example.com/image2.jpg',
              }],
            }),
            getStatus: () => 'SKIPPED',
          },
        ]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls[0].url).to.equal('https://example.com/page21');
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ topPagesOffset: 20 }),
      );
    });

    it('should wrap offset to 0 when it exceeds total pages', async () => {
      const pageUrls = Array.from({ length: 25 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 20 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls[0].url).to.equal('https://example.com/page1');
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ topPagesOffset: 0 }),
      );
      expect(context.log.info).to.have.been.calledWith(
        '[alt-text]: Offset 40 exceeds 25 pages, wrapping to 0',
      );
    });

    it('should advance from offset 20 to 40 when no NEW suggestions at 20', async () => {
      const pageUrls = Array.from({ length: 60 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 20 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(result.urls[0].url).to.equal('https://example.com/page41');
      expect(result.urls[19].url).to.equal('https://example.com/page60');
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ topPagesOffset: 40 }),
      );
    });

    it('should default to offset 0 when opportunity lookup fails', async () => {
      const pageUrls = Array.from({ length: 25 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('DB error'));

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(result.urls[0].url).to.equal('https://example.com/page1');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to read opportunity offset, defaulting to 0/),
      );
    });

    it('should not save offset when no opportunity exists', async () => {
      const pageUrls = Array.from({ length: 25 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(result.urls[0].url).to.equal('https://example.com/page1');
    });

    it('should read stored offset without suggestion check for non-summit-plg', async () => {
      configurationMock.isHandlerEnabledForSite.returns(false);

      const pageUrls = Array.from({ length: 150 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 20 }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(100);
      expect(result.urls[0].url).to.equal('https://example.com/page1');
    });

    it('should handle opportunity getData returning null when saving offset', async () => {
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: sandbox.stub()
          .onFirstCall().returns({ topPagesOffset: 0 })
          .onSecondCall().returns(null),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ topPagesOffset: 20 }),
      );
    });

    it('should handle save offset failure gracefully', async () => {
      const pageUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i + 1}`);
      getTopPageUrlsStub.resolves(pageUrls);

      const mockOpportunity = {
        getType: () => AUDIT_TYPE,
        getId: () => 'opportunity-id',
        getData: () => ({ topPagesOffset: 0 }),
        setData: sandbox.stub(),
        save: sandbox.stub().rejects(new Error('Save failed')),
        getSuggestions: sandbox.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      // Should not throw — save failure is handled gracefully
      const result = await handlerModule.processScraping(context);

      expect(result.urls).to.have.lengthOf(20);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to save opportunity offset/),
      );
    });
  });
});
