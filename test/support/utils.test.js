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
import esmock from 'esmock';
import {
  enhanceBacklinksWithFixes,
  extractKeywordsFromUrl, getBaseUrlPagesFromSitemapContents,
  getUrlWithoutPath,
} from '../../src/support/utils.js';

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

describe('extractKeywordsFromUrl', () => {
  let log;

  beforeEach(() => {
    log = { error: sinon.stub() };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('returns an empty array when the URL does not contain any keywords', () => {
    const url = 'https://www.example.com';
    const result = extractKeywordsFromUrl(url, log);
    expect(result).to.deep.equal([]);
  });

  it('returns an empty array and logs an error if the URL is not a string', () => {
    const url = 123;
    const result = extractKeywordsFromUrl(url, log);
    expect(result).to.deep.equal([]);
    expect(log.error).to.have.been.calledOnce;
  });

  it('returns a list of ranked keywords from the URL', () => {
    const expected = [
      { keyword: 'foo', rank: 3 },
      { keyword: 'bar baz', rank: 2 },
      { keyword: 'qux', rank: 1 },
    ];
    const url = 'https://www.space.cat/foo/bar-baz/qux';
    const result = extractKeywordsFromUrl(url, log);
    expect(result).to.deep.equal(expected);
  });
});

describe('enhanceBacklinksWithFixes', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.stub() };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should prioritize keywords closer to the end of the URL path', async () => {
    const brokenBacklinks = [
      {
        url_to: 'https://www.example.com/foo/bar/baz.html',
      },
    ];

    const keywords = [
      { keyword: 'foo', traffic: 100, url: 'https://www.example.com/foo.html' },
      { keyword: 'bar', traffic: 200, url: 'https://www.example.com/foo/bar.html' },
      { keyword: 'baz', traffic: 50, url: 'https://www.example.com/baz.html' },
    ];

    const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);

    expect(result).to.be.an('array').that.has.lengthOf(1);
    expect(result[0].url_suggested).to.equal('https://www.example.com/baz.html');
  });

  it('should use traffic as a secondary sort criterion', async () => {
    const brokenBacklinks = [
      {
        url_to: 'https://www.example.com/foo/bar/baz.html',
      },
    ];

    const keywords = [
      { keyword: 'foo', traffic: 300, url: 'https://www.example.com/foo.html' },
      { keyword: 'another baz', traffic: 200, url: 'https://www.example.com/foo/bar.html' },
      { keyword: 'baz', traffic: 100, url: 'https://www.example.com/baz.html' },
    ];

    const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);

    expect(result).to.be.an('array').that.has.lengthOf(1);
    expect(result[0].url_suggested).to.equal('https://www.example.com/foo/bar.html');
  });

  it('should correctly handle cases where keywords are split', async () => {
    const brokenBacklinks = [
      {
        url_to: 'https://www.example.com/foo-bar-baz.html',
      },
    ];

    const keywords = [
      { keyword: 'foo', traffic: 100, url: 'https://www.example.com/foo.html' },
      { keyword: 'bar', traffic: 300, url: 'https://www.example.com/bar.html' },
      { keyword: 'baz', traffic: 200, url: 'https://www.example.com/baz.html' },
    ];

    const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);

    expect(result).to.be.an('array').that.has.lengthOf(1);
    expect(result[0].url_suggested).to.equal('https://www.example.com/bar.html');
  });

  it('should match keywords only for whole words', () => {
    const brokenBacklinks = [
      {
        url_to: 'https://www.example.com/foo/bar.html',
      },
    ];
    const keywords = [
      { keyword: 'foobar', traffic: 400, url: 'https://www.example.com/foobar.html' },
      { keyword: 'foo', traffic: 200, url: 'https://www.example.com/foo.html' },
      { keyword: 'bar', traffic: 50, url: 'https://www.example.com/bar.html' },
    ];
    const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);
    expect(result).to.be.an('array').that.has.lengthOf(1);
    expect(result[0].url_suggested).to.equal('https://www.example.com/bar.html');
  });
});

describe('getBaseUrlPagesFromSitemapContents', () => {
  it('should return an empty array when the sitemap content is empty', () => {
    const result = getBaseUrlPagesFromSitemapContents('https://my-site.adbe', undefined);
    expect(result).to.deep.equal([]);
  });
});

describe('utils.calculateCPCValue', () => {
  let context;
  let utils;
  beforeEach(async () => {
    sinon.restore();
    const getObjectFromKey = sinon.stub().returns([
      {
        cost: 200,
        value: 100,
      },
    ]);
    utils = await esmock('../../src/support/utils.js', {
      '../../src/utils/s3-utils.js': { getObjectFromKey },
    });
    context = {
      env: { S3_IMPORTER_BUCKET_NAME: 'my-bucket' },
      s3Client: {},
      log: {
        info: sinon.stub(),
        error: sinon.stub(),
      },
    };
  });
  it('should throw an error if S3_IMPORTER_BUCKET_NAME is missing', async () => {
    context.env.S3_IMPORTER_BUCKET_NAME = null;
    await expect(utils.calculateCPCValue(context, 'siteId')).to.be.rejectedWith('S3 importer bucket name is required');
  });

  it('should throw an error if s3Client is missing', async () => {
    context.s3Client = null;
    await expect(utils.calculateCPCValue(context, 'siteId')).to.be.rejectedWith('S3 client is required');
  });

  it('should throw an error if logger is missing', async () => {
    context.log = null;
    await expect(utils.calculateCPCValue(context, 'siteId')).to.be.rejectedWith('Logger is required');
  });

  it('should throw an error if siteId is missing', async () => {
    await expect(utils.calculateCPCValue(context)).to.be.rejectedWith('SiteId is required');
  });

  it('should return 1 if organicTrafficData array is empty', async () => {
    const getObjectFromKey = sinon.stub().returns([]);
    utils = await esmock('../../src/support/utils.js', {
      '../../src/utils/s3-utils.js': { getObjectFromKey },
    });
    const result = await utils.calculateCPCValue(context, 'siteId');
    expect(result).to.equal(1);
    expect(context.log.info.calledOnce).to.be.true;
    expect(context.log.info.calledWith('Organic traffic data not available for siteId. Using Default CPC value.')).to.be.true;
  });

  it('should return 1 if organicTrafficData is not an array', async () => {
    const getObjectFromKey = sinon.stub().returns('dummy');
    utils = await esmock('../../src/support/utils.js', {
      '../../src/utils/s3-utils.js': { getObjectFromKey },
    });
    const result = await utils.calculateCPCValue(context, 'siteId');
    expect(result).to.equal(1);
  });

  it('should calculate CPC correctly if organicTrafficData is valid', async () => {
    const getObjectFromKey = sinon.stub().returns([
      { cost: 100, value: 50 },
      { cost: 200, value: 100 },
    ]);
    utils = await esmock('../../src/support/utils.js', {
      '../../src/utils/s3-utils.js': { getObjectFromKey },
    });
    const result = await utils.calculateCPCValue(context, 'siteId');
    expect(result).to.equal(2); // (200 / 100)
  });

  it('should handle errors during data fetching and return 1', async () => {
    const getObjectFromKey = sinon.stub().throws(new Error('Fetch error'));
    utils = await esmock('../../src/support/utils.js', {
      '../../src/utils/s3-utils.js': { getObjectFromKey },
    });
    const result = await utils.calculateCPCValue(context, 'siteId');
    expect(result).to.equal(1);
    expect(context.log.error.calledOnce).to.be.true;
    expect(context.log.error.calledWith('Error fetching organic traffic data for site siteId. Using Default CPC value.', sinon.match.instanceOf(Error))).to.be.true;
  });
});
