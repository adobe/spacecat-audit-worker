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
import { expect } from 'chai';
import sinon from 'sinon';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import {
  processImportStep,
  prepareScrapingStep,
  fetchPageScrapeAndRunAudit,
  processAltTextAuditStep,
} from '../../../src/image-alt-text/handler.js';
import { MockContextBuilder } from '../../shared.js';

describe('Image Alt Text Handler', () => {
  let context;
  let sandbox;
  const siteId = 'site-id';
  const auditId = 'audit-id';
  const bucketName = 'test-bucket';
  const s3BucketPath = `scrapes/${siteId}/`;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          S3_SCRAPER_BUCKET_NAME: bucketName,
          IMS_HOST: 'https://ims-na1.adobelogin.com',
          IMS_CLIENT_ID: 'test-client-id',
          IMS_CLIENT_CODE: 'test-client-code',
          IMS_CLIENT_SECRET: 'test-client-secret',
          FIREFALL_API_ENDPOINT: 'https://firefall-api.adobe.com',
          FIREFALL_API_KEY: 'test-firefall-api-key',
        },
        site: {
          getId: () => siteId,
          resolveFinalURL: () => 'https://example.com',
        },
        audit: {
          getId: () => auditId,
        },
        s3Client: {
          send: sandbox.stub(),
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves({
              getId: () => 'opportunity-id',
              setAuditId: sandbox.stub(),
              setData: sandbox.stub(),
              save: sandbox.stub(),
              getSuggestions: sandbox.stub().returns([]),
              addSuggestions: sandbox.stub().returns({ errorItems: [], createdItems: [1] }),
              getType: () => AuditModel.AUDIT_TYPES.ALT_TEXT,
              getSiteId: () => siteId,
            }),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processImportStep', () => {
    it('should prepare import step with correct parameters', async () => {
      const result = await processImportStep(context);

      expect(result).to.deep.equal({
        auditResult: { status: 'preparing' },
        fullAuditRef: s3BucketPath,
        type: 'top-pages',
        siteId,
      });
    });
  });

  describe('prepareScrapingStep', () => {
    it('should prepare scraping step with top pages', async () => {
      const topPages = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/page2' },
      ];
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
      };

      const result = await prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: topPages.map((page) => ({ url: page.getUrl() })),
        siteId,
        type: 'alt-text',
      });
    });

    it('should throw error if no top pages found', async () => {
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
      };

      await expect(prepareScrapingStep(context)).to.be.rejectedWith('No top pages found for site');
    });
  });

  describe('fetchPageScrapeAndRunAudit', () => {
    it('should return null if no raw HTML content found', async () => {
      context.s3Client.send.resolves(
        { Body: { transformToString: sandbox.stub().resolves(JSON.stringify({})) } },
      );

      const result = await fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        'scrape.json',
        s3BucketPath,
        context.log,
      );

      expect(result).to.be.null;
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: No raw HTML content found in S3 scrape.json object',
      );
    });

    it('should process images and identify presentational ones', async () => {
      const mockScrapeResult = {
        scrapeResult: {
          rawBody: `
            <html>
              <body>
                <img src="image1.jpg" alt="Image 1" />
                <img src="image2.jpg" role="presentation" src="image2.jpg" />
                <img src="image3.jpg" aria-hidden="true" src="image3.jpg" />
                <img src="image4.jpg" alt="" src="image4.jpg" />
              </body>
            </html>
          `,
        },
      };

      context.s3Client.send.resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(mockScrapeResult)),
        },
      });

      const result = await fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        `${s3BucketPath}page1/scrape.json`,
        s3BucketPath,
        context.log,
      );

      expect(result).to.not.be.null;
      expect(result).to.have.property('/page1');
      expect(result['/page1']).to.have.property('images');
      expect(result['/page1'].images).to.have.lengthOf(4);
      expect(result['/page1'].images.filter((img) => img.isPresentational)).to.have.lengthOf(3);
    });
  });

  describe('processAltTextAuditStep', () => {
    const mockScrapeResults = [
      {
        scrapeResult: {
          rawBody: `
            <html>
              <body>
                <img src="image1.jpg" />
                <img src="image2.jpg" alt="Image 2" />
              </body>
            </html>
          `,
        },
      },
      {
        scrapeResult: {
          rawBody: `
            <html>
              <body>
                <img src="image3.jpg" />
                <img src="image4.jpg" role="presentation" />
              </body>
            </html>
          `,
        },
      },
    ];

    beforeEach(() => {
      context.s3Client.send.onFirstCall().resolves({
        Contents: [
          { Key: `${s3BucketPath}page1/scrape.json` },
          { Key: `${s3BucketPath}page2/scrape.json` },
        ],
      });

      context.s3Client.send.onSecondCall().resolves({
        Body: { transformToString: sandbox.stub().resolves(JSON.stringify(mockScrapeResults[0])) },
      });

      context.s3Client.send.onThirdCall().resolves({
        Body: { transformToString: sandbox.stub().resolves(JSON.stringify(mockScrapeResults[1])) },
      });
    });

    it('should process scraped pages and create opportunities', async () => {
      const result = await processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.info).to.have.been.calledWith(
        `[alt-text] [Site Id: ${siteId}] processing scraped content`,
      );
      expect(context.log.info).to.have.been.calledWith(
        `[alt-text] [Site Id: ${siteId}] found 2 scraped pages to analyze`,
      );
    });

    it('should handle case when no scraped content is found', async () => {
      context.s3Client.send.onFirstCall().resolves({
        Contents: [],
      });

      const result = await processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.error).to.have.been.calledWith(
        `[alt-text] [Site Id: ${siteId}] no scraped content found, cannot proceed with audit`,
      );
    });

    it('should handle errors during page processing', async () => {
      context.s3Client.send.onSecondCall().rejects(new Error('S3 error'));

      const result = await processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.error).to.have.been.calledWith(
        'Error while fetching S3 object from bucket test-bucket using key scrapes/site-id/page1/scrape.json',
      );
    });
  });
});
