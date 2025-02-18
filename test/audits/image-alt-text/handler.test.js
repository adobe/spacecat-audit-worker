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

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { auditImageAltTextRunner, fetchAndProcessPageObject } from '../../../src/image-alt-text/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Image Alt Text Handler', () => {
  let s3ClientStub;
  let logStub;
  let context;

  beforeEach(() => {
    sinon.restore();
    s3ClientStub = {
      send: sinon.stub(),
    };
    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };
    context = {
      log: logStub,
      s3Client: s3ClientStub,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
    };
  });

  describe('fetchAndProcessPageObject', () => {
    it('should return null if no raw HTML content found', async () => {
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {},
            }),
          },
        });

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        'test-bucket',
        'scrapes/site-id/page1/scrape.json',
        'scrapes/site-id/',
        logStub,
      );

      expect(result).to.be.null;
      expect(logStub.error).to.have.been.calledWith(
        'No raw HTML content found in S3 scrapes/site-id/page1/scrape.json object',
      );
    });

    it('should handle S3 errors gracefully', async () => {
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .rejects(new Error('S3 Error'));

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        'test-bucket',
        'scrapes/site-id/page1/scrape.json',
        'scrapes/site-id/',
        logStub,
      );

      expect(result).to.be.null;
    });
  });

  describe('auditImageAltTextRunner', () => {
    it('should perform full image alt text audit successfully', async () => {
      const mockHtml = `
        <html>
          <body>
            <img src="test1.jpg" alt="Test 1">
            <img src="test2.jpg" alt="">
          </body>
        </html>
      `;

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/page1/scrape.json' },
            { Key: 'scrapes/site-id/page2/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {
                rawBody: mockHtml,
              },
            }),
          },
          ContentType: 'application/json',
        });

      const result = await auditImageAltTextRunner(
        'http://example.com',
        context,
        { getId: () => 'site-id' },
      );

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('detectedTags');
      expect(result.auditResult.detectedTags).to.have.property('imagesWithoutAltText');
      expect(result.auditResult.detectedTags.imagesWithoutAltText.length).to.equal(2);
      expect(result.auditResult).to.have.property('sourceS3Folder', 'test-bucket/scrapes/site-id/');
      expect(result.auditResult).to.have.property('finalUrl', 'http://example.com');
      expect(result).to.have.property('fullAuditRef', 'http://example.com');
    });

    it('should handle case when no pages are found to audit', async () => {
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/page1/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {
                // Empty scrape result to simulate no tags extracted
              },
            }),
          },
        });

      const result = await auditImageAltTextRunner(
        'http://example.com',
        context,
        { getId: () => 'site-id' },
      );

      expect(result.auditResult.detectedTags).to.deep.equal({ imagesWithoutAltText: [] });
      expect(logStub.error).to.have.been.calledWith(
        'Failed to extract tags from scraped content for bucket test-bucket and prefix scrapes/site-id/',
      );
    });
  });
});
