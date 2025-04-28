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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

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
        site: {
          getId: () => 'site-id',
          resolveFinalURL: () => 'https://example.com',
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
            create: sandbox.stub().resolves({}),
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
        auditResult: { status: 'preparing' },
        fullAuditRef: s3BucketPath,
        type: 'top-pages',
        siteId: 'site-id',
      });
    });
  });

  describe('prepareScrapingStep', () => {
    it('should prepare scraping step with top pages', async () => {
      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });

    it('should throw error if no top pages found', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(handlerModule.prepareScrapingStep(context)).to.be.rejectedWith('No top pages found for site');
    });
  });

  describe('fetchPageScrapeAndRunAudit', () => {
    it('should return null if no raw HTML content found', async () => {
      context.s3Client.send.resolves(
        { Body: { transformToString: sandbox.stub().resolves(JSON.stringify({})) } },
      );

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
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

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
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

  xdescribe('processAltTextAuditStep', () => {

  });
});
