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

import chai from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
// import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  // enhanceBacklinksWithFixes,
  extractKeywordsFromUrl,
  // getStoredMetrics,
  getUrlWithoutPath,
} from '../../src/support/utils.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

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

// describe('enhanceBacklinksWithFixes', () => {
//   let log;
//
//   beforeEach(() => {
//     log = { info: sinon.stub() };
//   });
//
//   afterEach(() => {
//     sinon.restore();
//   });
//
//   it('should prioritize keywords closer to the end of the URL path', async () => {
//     const brokenBacklinks = [
//       {
//         url_to: 'https://www.example.com/foo/bar/baz.html',
//       },
//     ];
//
//     const keywords = [
//       { keyword: 'foo', traffic: 100, url: 'https://www.example.com/foo.html' },
//       { keyword: 'bar', traffic: 200, url: 'https://www.example.com/foo/bar.html' },
//       { keyword: 'baz', traffic: 50, url: 'https://www.example.com/baz.html' },
//     ];
//
//     const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);
//
//     expect(result).to.be.an('array').that.has.lengthOf(1);
//     expect(result[0].url_suggested).to.equal('https://www.example.com/baz.html');
//   });
//
//   it('should use traffic as a secondary sort criterion', async () => {
//     const brokenBacklinks = [
//       {
//         url_to: 'https://www.example.com/foo/bar/baz.html',
//       },
//     ];
//
//     const keywords = [
//       { keyword: 'foo', traffic: 300, url: 'https://www.example.com/foo.html' },
//       { keyword: 'another baz', traffic: 200, url: 'https://www.example.com/foo/bar.html' },
//       { keyword: 'baz', traffic: 100, url: 'https://www.example.com/baz.html' },
//     ];
//
//     const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);
//
//     expect(result).to.be.an('array').that.has.lengthOf(1);
//     expect(result[0].url_suggested).to.equal('https://www.example.com/foo/bar.html');
//   });
//
//   it('should correctly handle cases where keywords are split', async () => {
//     const brokenBacklinks = [
//       {
//         url_to: 'https://www.example.com/foo-bar-baz.html',
//       },
//     ];
//
//     const keywords = [
//       { keyword: 'foo', traffic: 100, url: 'https://www.example.com/foo.html' },
//       { keyword: 'bar', traffic: 300, url: 'https://www.example.com/bar.html' },
//       { keyword: 'baz', traffic: 200, url: 'https://www.example.com/baz.html' },
//     ];
//
//     const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);
//
//     expect(result).to.be.an('array').that.has.lengthOf(1);
//     expect(result[0].url_suggested).to.equal('https://www.example.com/bar.html');
//   });
//
//   it('should match keywords only for whole words', () => {
//     const brokenBacklinks = [
//       {
//         url_to: 'https://www.example.com/foo/bar.html',
//       },
//     ];
//     const keywords = [
//       { keyword: 'foobar', traffic: 400, url: 'https://www.example.com/foobar.html' },
//       { keyword: 'foo', traffic: 200, url: 'https://www.example.com/foo.html' },
//       { keyword: 'bar', traffic: 50, url: 'https://www.example.com/bar.html' },
//     ];
//     const result = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);
//     expect(result).to.be.an('array').that.has.lengthOf(1);
//     expect(result[0].url_suggested).to.equal('https://www.example.com/bar.html');
//   });
//
//   describe('getStoredMetrics', () => {
//     let s3Client;
//     let config;
//     let context;
//
//     beforeEach(() => {
//       s3Client = {
//         send: sinon.stub(),
//       };
//       config = {
//         siteId: 'testSite',
//         source: 'testSource',
//         metric: 'testMetric',
//       };
//       context = {
//         log: {
//           info: sinon.stub(),
//           error: sinon.stub(),
//         },
//         env: {
//           S3_BUCKET_NAME: 'testBucket',
//         },
//       };
//     });
//
//     it('should return metrics when retrieval is successful', async () => {
//       const expectedMetrics = [{
//         siteId: '123',
//         source: 'ahrefs',
//         time: '2023-03-12T00:00:00Z',
//         name: 'organic-traffic',
//         value: 100,
//       }, {
//         siteId: '123',
//         source: 'ahrefs',
//         time: '2023-03-13T00:00:00Z',
//         name: 'organic-traffic',
//         value: 200,
//       }];
//       s3Client.send.resolves({
//         Body: {
//           transformToString: sinon.stub().resolves(JSON.stringify(expectedMetrics)),
//         },
//       });
//
//       const metrics = await getStoredMetrics(s3Client, config, context);
//
//       expect(metrics).to.deep.equal(expectedMetrics);
//       expect(s3Client.send.calledWith(sinon.match.instanceOf(GetObjectCommand))).to.be.true;
// eslint-disable-next-line max-len
//       expect(s3Client.send.calledWith(sinon.match.hasNested('input.Bucket', context.env.S3_BUCKET_NAME))).to.be.true;
// eslint-disable-next-line max-len
//       expect(s3Client.send.calledWith(sinon.match.hasNested('input.Key', 'metrics/testSite/testSource/testMetric.json'))).to.be.true;
// eslint-disable-next-line max-len
//       expect(context.log.info).to.have.been.calledWith('Successfully retrieved 2 metrics from metrics/testSite/testSource/testMetric.json');
//     });
//
//     it('should return empty array when retrieval fails', async () => {
//       s3Client.send.rejects(new Error('Test error'));
//
//       const metrics = await getStoredMetrics(s3Client, config, context);
//
//       expect(metrics).to.deep.equal([]);
// eslint-disable-next-line max-len
//       expect(context.log.error).to.have.been.calledWith('Failed to retrieve metrics from metrics/testSite/testSource/testMetric.json, error: Test error');
//     });
//   });
// });
