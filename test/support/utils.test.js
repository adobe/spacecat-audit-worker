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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  getBaseUrlPagesFromSitemapContents, getScrapedDataForSiteId,
  getUrlWithoutPath,
} from '../../src/support/utils.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('getUrlWithoutPath', () => {
  it('returns the URL without the path from a URL with a path', () => {
    const url = 'https://www.example.com/path/to/resource';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });

  it('returns the same URL from a URL without a path', () => {
    const url = 'https://www.example.com';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });

  it('returns the URL without the path from a URL with a path and query parameters', () => {
    const url = 'https://www.example.com/path/to/resource?param=value';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });

  it('returns the URL without the path from a URL with a path and a fragment', () => {
    const url = 'https://www.example.com/path/to/resource#fragment';
    const expected = 'https://www.example.com';
    expect(getUrlWithoutPath(url)).to.deep.equal(expected);
  });
});

describe('getBaseUrlPagesFromSitemapContents', () => {
  it('should return an empty array when the sitemap content is empty', () => {
    const result = getBaseUrlPagesFromSitemapContents('https://my-site.adbe', undefined);
    expect(result).to.deep.equal([]);
  });
});

describe('getScrapedDataForSiteId (with utility functions)', () => {
  let sandbox;
  let context;
  let site;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    site = {
      getId: sandbox.stub().returns('site-id'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  xit('processes S3 files and extracts metadata and links', async () => {
    // Mock S3 response with file metadata
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/file1.json' },
        { Key: 'scrapes/site-id/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    // Mock GetObjectCommand results
    const mockFile1Response = {
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };

    // const mockScrapeResponse = {
    //   Body: {
    //     transformToString: sandbox.stub().resolves(JSON.stringify({
    //       title: 'Page 1 Title',
    //       description: 'Page 1 Description',
    //       h1: ['Page 1 H1'],
    //     })),
    //   },
    // };

    // Stub specific calls to GetObjectCommand
    context.s3Client.send.onCall(1).resolves(mockFile1Response);
    context.s3Client.send.onCall(2).resolves(mockFile1Response);
    context.s3Client.send.onCall(3).resolves(mockFile1Response);

    // Act
    const result = await getScrapedDataForSiteId(site, context);

    // Assert
    expect(result).to.deep.equal({
      headerLinks: ['https://example.com/home', 'https://example.com/about'],
      siteData: [
        {
          url: 'https://example.com/page1',
          title: 'Page 1 Title',
          description: 'Page 1 Description',
          h1: 'Page 1 H1',
        },
      ],
    });

    // Verify S3 interactions
    expect(context.s3Client.send)
      .to
      .have
      .been
      .calledWith(sinon.match.instanceOf(ListObjectsV2Command));
    expect(context.s3Client.send).to.have.been.calledWith(sinon.match.instanceOf(GetObjectCommand));
    expect(context.s3Client.send).to.have.been.calledTwice;
  });

  xit('handles JSON parsing errors and excludes invalid files', async () => {
    // Mock S3 response with file metadata
    context.s3Client.send.resolves({
      Contents: [
        { Key: 'scrapes/site-id/file1.json' },
        { Key: 'scrapes/site-id/file2.json' },
        { Key: 'scrapes/site-id/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    // Mock GetObjectCommand results
    const mockFile1Response = {
      Body: {
        transformToString: sandbox.stub().resolves('{ invalid json'),
      },
    };

    const mockFile2Response = {
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/page2',
          scrapeResult: {
            tags: {
              title: 'Page 2 Title',
              description: 'Page 2 Description',
              h1: ['Page 2 H1'],
            },
          },
        })),
      },
    };

    const mockScrapeResponse = {
      Body: {
        transformToString: sandbox.stub().resolves(`
          <html>
            <body>
              <header>
                <a href="/contact">Contact</a>
              </header>
            </body>
          </html>
        `),
      },
    };

    context.s3Client.send
      .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('Key', 'scrapes/site-id/file1.json')))
      .resolves(mockFile1Response)
      .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('Key', 'scrapes/site-id/file2.json')))
      .resolves(mockFile2Response)
      .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('Key', 'scrapes/site-id/scrape.json')))
      .resolves(mockScrapeResponse);

    // Act
    const result = await getScrapedDataForSiteId(site, context);

    // Assert
    expect(result).to.deep.equal({
      headerLinks: ['https://example.com/contact'],
      siteData: [
        {
          url: 'https://example.com/page2',
          title: 'Page 2 Title',
          description: 'Page 2 Description',
          h1: 'Page 2 H1',
        },
      ],
    });

    // Verify error logging
    expect(context.log.error).to.have.been.calledWithMatch('SyntaxError');
  });
});
