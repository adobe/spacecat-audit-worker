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
import { LambdaClient } from '@aws-sdk/client-lambda';
import {
  enhanceBacklinksWithFixes,
  extractKeywordsFromUrl,
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

describe('enhanceBacklinksWithFixes', () => {
  let log;
  let invokeStub;

  beforeEach(() => {
    log = { info: sinon.stub(), error: sinon.stub() };
    invokeStub = sinon.stub(LambdaClient.prototype, 'send').resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should invoke the Lambda function with the correct payload', async () => {
    const siteId = 'testSiteId';
    const brokenBacklinks = [
      { url_to: 'https://www.example.com/foo/bar/baz.html' },
    ];
    const sitemapUrls = ['https://www.example.com/sitemap.xml'];
    const config = {
      region: 'test-region',
      statisticsServiceArn: 'testStatisticsService',
      log,
    };

    const result = await enhanceBacklinksWithFixes(siteId, brokenBacklinks, sitemapUrls, config);

    expect(invokeStub.calledOnce).to.be.true;
    const [command] = invokeStub.getCall(0).args;
    expect(command.input.FunctionName).to.equal('testStatisticsService');
    const payload = JSON.parse(command.input.Payload);
    expect(payload).to.deep.equal({
      type: 'broken-backlinks',
      payload: {
        siteId: 'testSiteId',
        brokenBacklinks: [{ url_to: 'https://www.example.com/foo/bar/baz.html' }],
        sitemapUrls: ['https://www.example.com/sitemap.xml'],
      },
    });

    expect(result).to.deep.equal({ status: 'Lambda function invoked' });
  });

  it('should log info message when Lambda function is invoked successfully', async () => {
    const siteId = 'testSiteId';
    const brokenBacklinks = [
      { url_to: 'https://www.example.com/foo/bar/baz.html' },
    ];
    const sitemapUrls = ['https://www.example.com/sitemap.xml'];
    const config = {
      region: 'test-region',
      statisticsServiceArn: 'testStatisticsService',
      log,
    };

    await enhanceBacklinksWithFixes(siteId, brokenBacklinks, sitemapUrls, config);

    expect(log.info.calledWith('Lambda function testStatisticsService invoked successfully.')).to.be.true;
  });

  it('should log error message when Lambda function invocation fails', async () => {
    invokeStub.rejects(new Error('Invocation failed'));

    const siteId = 'testSiteId';
    const brokenBacklinks = [
      { url_to: 'https://www.example.com/foo/bar/baz.html' },
    ];
    const sitemapUrls = ['https://www.example.com/sitemap.xml'];
    const config = {
      region: 'test-region',
      statisticsServiceArn: 'testStatisticsService',
      log,
    };

    await enhanceBacklinksWithFixes(siteId, brokenBacklinks, sitemapUrls, config);

    expect(log.error.calledOnce).to.be.true;
    expect(log.error.args[0][0]).to.equal('Error invoking Lambda function testStatisticsService:');
    expect(log.error.args[0][1]).to.be.an('error').that.has.property('message', 'Invocation failed');
  });
});
