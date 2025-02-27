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
  extractLinksFromHeader,
  getBaseUrlPagesFromSitemapContents,
  getScrapedDataForSiteId,
  getUrlWithoutPath, sleep,
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
      .withOverrides({
        s3Client: {
          send: sandbox.stub(),
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('processes S3 files, filters by json files, and extracts metadata and links', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/scrape.json' },
      ],
      IsTruncated: true,
      NextContinuationToken: 'token',
    });

    context.s3Client.send.onCall(1).resolves({
      Contents: [
        { Key: 'scrapes/site-id/screenshot.png' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });

    const mockFileResponse = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html lang="en"><body><header><a href="/home">Home</a><a href="/about">About</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };

    context.s3Client.send.resolves(mockFileResponse);

    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: ['https://example.com/home', 'https://example.com/about'],
      formData: [],
      siteData: [
        {
          url: 'https://example.com/page1',
          title: 'Page 1 Title',
          description: 'Page 1 Description',
          h1: 'Page 1 H1',
        },
      ],
    });

    expect(context.s3Client.send)
      .to
      .have
      .been
      .calledWith(sinon.match.instanceOf(ListObjectsV2Command));
    expect(context.s3Client.send).to.have.been.calledWith(sinon.match.instanceOf(GetObjectCommand));
    expect(context.s3Client.send)
      .to
      .have
      .been
      .callCount(4); // 1. get list of files, 2. get meta tags, 3. non json file, 4. header links
  });

  it('returns empty arrays when no files are found', async () => {
    context.s3Client.send.resolves({
      Contents: [],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: [],
      formData: [],
      siteData: [],
    });
  });

  it('returns only the metadata if there are not header links', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    const mockFileResponse = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html lang="en"><body></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };

    context.s3Client.send.resolves(mockFileResponse);

    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: [],
      formData: [],
      siteData: [
        {
          url: 'https://example.com/page1',
          title: 'Page 1 Title',
          description: 'Page 1 Description',
          h1: 'Page 1 H1',
        },
      ],
    });
  });

  it('returns only the metadata if there is no root file', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/page/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    const mockFileResponse = {
      ContentType: 'application/json',
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

    context.s3Client.send.resolves(mockFileResponse);

    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: [],
      formData: [],
      siteData: [
        {
          url: 'https://example.com/page1',
          title: 'Page 1 Title',
          description: 'Page 1 Description',
          h1: 'Page 1 H1',
        },
      ],
    });
  });

  it('handles JSON parsing errors and excludes invalid files', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/scrape.json' },
        { Key: 'scrapes/site-id/invalid.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    const mockFileResponse = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          scrapeResult: {
            tags: {},
          },
        })),
      },
    };

    const mockInvalidFileResponse = {
      Body: {
        transformToString: sandbox.stub().resolves('invalid json'),
      },
    };

    context.s3Client.send.onCall(1).resolves(mockFileResponse);
    context.s3Client.send.onCall(2).resolves(mockInvalidFileResponse);
    context.s3Client.send.onCall(3).resolves(mockFileResponse);

    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: [],
      formData: [],
      siteData: [
        {
          url: '',
          title: '',
          description: '',
          h1: '',
        },
      ],
    });
  });

  it('handles form data extraction from forms/scrape.json', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/forms/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    const mockFormFileResponse = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/contact',
          scrapeResult: [
            {
              id: '',
              formType: 'search',
              classList: '',
              visibleATF: true,
              fieldCount: 2,
              visibleFieldCount: 0,
              fieldsLabels: [
                'Search articles',
                'search-btn',
              ],
              visibleInViewPortFieldCount: 0,
            },
            {
              id: '',
              formType: 'search',
              classList: '',
              visibleATF: true,
              fieldCount: 2,
              visibleFieldCount: 2,
              fieldsLabels: [
                'Search articles',
                'search-btn',
              ],
              visibleInViewPortFieldCount: 2,
            },
            {
              id: '',
              formType: 'search',
              classList: 'adopt-search-results-box-wrapper',
              visibleATF: true,
              fieldCount: 7,
              visibleFieldCount: 5,
              fieldsLabels: [
                'Any\nDog\nCat\nOther',
                'Any',
                'Any',
                'Enter Zip/Postal Code',
                '✕',
                'Search',
                'Create Search Alert',
              ],
              visibleInViewPortFieldCount: 5,
            },
          ],
        })),
      },
    };

    context.s3Client.send.resolves(mockFormFileResponse);

    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: [],
      siteData: [
        {
          description: '',
          h1: '',
          title: '',
          url: 'https://example.com/contact',
        },
      ],
      formData: [{
        finalUrl: 'https://example.com/contact',
        scrapeResult: [
          {
            id: '',
            formType: 'search',
            classList: '',
            visibleATF: true,
            fieldCount: 2,
            visibleFieldCount: 0,
            fieldsLabels: [
              'Search articles',
              'search-btn',
            ],
            visibleInViewPortFieldCount: 0,
          },
          {
            id: '',
            formType: 'search',
            classList: '',
            visibleATF: true,
            fieldCount: 2,
            visibleFieldCount: 2,
            fieldsLabels: [
              'Search articles',
              'search-btn',
            ],
            visibleInViewPortFieldCount: 2,
          },
          {
            id: '',
            formType: 'search',
            classList: 'adopt-search-results-box-wrapper',
            visibleATF: true,
            fieldCount: 7,
            visibleFieldCount: 5,
            fieldsLabels: [
              'Any\nDog\nCat\nOther',
              'Any',
              'Any',
              'Enter Zip/Postal Code',
              '✕',
              'Search',
              'Create Search Alert',
            ],
            visibleInViewPortFieldCount: 5,
          },
        ],
      }],
    });
  });

  it('handles multiple form files', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/forms/scrape.json' },
        { Key: 'scrapes/site-id/forms/other/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    const mockFormResponse1 = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/contact',
          scrapeResult: [
            {
              id: '',
              formType: 'search',
              classList: '',
              visibleATF: true,
              fieldCount: 2,
              visibleFieldCount: 0,
              fieldsLabels: [
                'Search articles',
                'search-btn',
              ],
              visibleInViewPortFieldCount: 0,
            },
          ],
        })),
      },
    };

    context.s3Client.send.resolves(mockFormResponse1);
    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: [],
      siteData: [
        {
          description: '',
          h1: '',
          title: '',
          url: 'https://example.com/contact',
        },
        {
          description: '',
          h1: '',
          title: '',
          url: 'https://example.com/contact',
        },
      ],
      formData: [
        {
          finalUrl: 'https://example.com/contact',
          scrapeResult: [
            {
              id: '',
              formType: 'search',
              classList: '',
              visibleATF: true,
              fieldCount: 2,
              visibleFieldCount: 0,
              fieldsLabels: [
                'Search articles',
                'search-btn',
              ],
              visibleInViewPortFieldCount: 0,
            },
          ],
        },
      ],
    });
  });

  it('handles invalid form data files', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site-id/forms/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: null,
    });

    const mockInvalidFormResponse = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves('invalid json'),
      },
    };

    context.s3Client.send.resolves(mockInvalidFormResponse);

    const result = await getScrapedDataForSiteId(site, context);

    expect(result).to.deep.equal({
      headerLinks: [],
      siteData: [],
      formData: [null],
    });
  });
});

describe('extractLinksFromHeader', () => {
  let log;

  beforeEach(() => {
    log = {
      warn: sinon.stub(),
      error: sinon.stub(),
      info: sinon.stub(),
    };
  });

  it('should return an empty array if data is not a non-empty object', () => {
    const result = extractLinksFromHeader({}, 'https://example.com', log);
    expect(result).to.deep.equal([]);
    expect(log.warn.calledOnce).to.be.true;
  });

  it('should return an empty array if rawBody is not present', () => {
    const data = { scrapeResult: {} };
    const result = extractLinksFromHeader(data, 'https://example.com', log);
    expect(result).to.deep.equal([]);
    expect(log.warn.calledOnce).to.be.true;
  });

  it('should return an empty array if no <header> element is found', () => {
    const data = { scrapeResult: { rawBody: '<html><body></body></html>' } };
    const result = extractLinksFromHeader(data, 'https://example.com', log);
    expect(result).to.deep.equal([]);
    expect(log.info.calledOnce).to.be.true;
  });

  it('should return an array of valid URLs found in the <header>', () => {
    const data = {
      scrapeResult: {
        rawBody: '<html><body><header><a href="/home">Home</a><a href="https://example.com/about">About</a></header></body></html>',
      },
    };
    const result = extractLinksFromHeader(data, 'https://example.com', log);
    expect(result).to.deep.equal(['https://example.com/home', 'https://example.com/about']);
  });

  it('should log a warning and exclude invalid URLs', () => {
    const data = {
      scrapeResult: {
        rawBody: '<html><body><header><a href="invalid-url">Invalid</a></header></body></html>',
      },
    };
    const result = extractLinksFromHeader(data, 'https://example.com', log);
    expect(result).to.deep.equal([]);
    expect(log.error.calledOnce).to.be.true;
  });
});

describe('sleep', () => {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  it('should resolve after the specified time', async () => {
    const ms = 1000;
    const promise = sleep(ms);

    clock.tick(ms);

    await expect(promise).to.be.fulfilled;
  });

  it('should not resolve before the specified time', async () => {
    const ms = 1000;
    const promise = sleep(ms);

    clock.tick(ms - 1);

    await clock.runAllAsync();

    let isFulfilled = false;
    promise.then(() => {
      isFulfilled = true;
    });

    expect(isFulfilled).to.be.false;

    clock.tick(1);
    await clock.runAllAsync();

    expect(isFulfilled).to.be.true;
  });
});
