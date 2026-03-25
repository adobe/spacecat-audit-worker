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
import esmock from 'esmock';

use(sinonChai);

describe('url-utils', () => {
  let sandbox;
  let getTopPageUrls;
  let allBySiteIdAndSourceAndGeoStub;
  let getRUMUrlStub;
  let rumQueryStub;
  let rumCreateFromStub;
  let log;

  const siteId = 'site-id';
  const baseURL = 'https://example.com';

  const makeSite = (includedURLs = []) => ({
    getBaseURL: () => baseURL,
    getConfig: () => ({
      getIncludedURLs: sinon.stub().returns(includedURLs),
    }),
  });

  const makeDataAccess = () => ({
    SiteTopPage: {
      allBySiteIdAndSourceAndGeo: allBySiteIdAndSourceAndGeoStub,
    },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    allBySiteIdAndSourceAndGeoStub = sandbox.stub();
    getRUMUrlStub = sandbox.stub().resolves('example.com');
    rumQueryStub = sandbox.stub();
    rumCreateFromStub = sandbox.stub().returns({ query: rumQueryStub });

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
    };

    ({ getTopPageUrls } = await esmock(
      '../../../src/image-alt-text/url-utils.js',
      {
        '@adobe/spacecat-shared-rum-api-client': {
          default: { createFrom: rumCreateFromStub },
        },
        '../../../src/support/utils.js': {
          getRUMUrl: getRUMUrlStub,
        },
      },
    ));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns Ahrefs URLs when Ahrefs has data', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/page2' },
    ]);

    const result = await getTopPageUrls({
      siteId, site: makeSite(), dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
    expect(rumCreateFromStub).to.not.have.been.called;
    expect(log.info).to.have.been.calledWith(sinon.match('Found 2 top pages from Ahrefs'));
  });

  it('falls back to RUM when Ahrefs is empty, sorted by earned desc', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.resolves([
      { url: 'www.example.com/low', earned: 10 },
      { url: 'www.example.com/high', earned: 100 },
      { url: 'www.example.com/mid', earned: 50 },
    ]);

    const result = await getTopPageUrls({
      siteId, site: makeSite(), dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal([
      'https://www.example.com/high',
      'https://www.example.com/mid',
      'https://www.example.com/low',
    ]);
    expect(log.info).to.have.been.calledWith(sinon.match('No Ahrefs top pages, falling back to RUM'));
    expect(log.info).to.have.been.calledWith(sinon.match('Found 3 URLs from RUM'));
  });

  it('normalizes RUM URLs that already have a scheme', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.resolves([
      { url: 'https://example.com/already-has-scheme', earned: 50 },
    ]);

    const result = await getTopPageUrls({
      siteId, site: makeSite(), dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal(['https://example.com/already-has-scheme']);
  });

  it('handles RUM results with missing earned values', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.resolves([
      { url: 'www.example.com/no-earned-1' },
      { url: 'www.example.com/with-earned', earned: 10 },
      { url: 'www.example.com/no-earned-2' },
    ]);

    const result = await getTopPageUrls({
      siteId, site: makeSite(), dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal([
      'https://www.example.com/with-earned',
      'https://www.example.com/no-earned-1',
      'https://www.example.com/no-earned-2',
    ]);
  });

  it('falls back to includedURLs when Ahrefs is empty and RUM returns empty', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.resolves([]);

    const site = makeSite(['https://example.com/included1', 'https://example.com/included2']);

    const result = await getTopPageUrls({
      siteId, site, dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal([
      'https://example.com/included1',
      'https://example.com/included2',
    ]);
    expect(log.info).to.have.been.calledWith(sinon.match('No URLs from RUM, falling back to includedURLs'));
    expect(log.info).to.have.been.calledWith(sinon.match('Found 2 included URLs from site config'));
  });

  it('falls back to includedURLs when Ahrefs is empty and RUM throws error', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.rejects(new Error('RUM API unavailable'));

    const site = makeSite(['https://example.com/included1']);

    const result = await getTopPageUrls({
      siteId, site, dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal(['https://example.com/included1']);
    expect(log.warn).to.have.been.calledWith(sinon.match('RUM fallback failed: RUM API unavailable'));
  });

  it('falls back to includedURLs when Ahrefs is empty and RUM returns null', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.resolves(null);

    const site = makeSite(['https://example.com/included1']);

    const result = await getTopPageUrls({
      siteId, site, dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal(['https://example.com/included1']);
  });

  it('returns empty array when all sources are empty', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.resolves([]);

    const result = await getTopPageUrls({
      siteId, site: makeSite(), dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal([]);
    expect(log.warn).to.have.been.calledWith(sinon.match('No URLs found from any source'));
  });

  it('handles site with no getConfig', async () => {
    allBySiteIdAndSourceAndGeoStub.resolves([]);
    rumQueryStub.resolves([]);

    const site = {
      getBaseURL: () => baseURL,
      getConfig: undefined,
    };

    const result = await getTopPageUrls({
      siteId, site, dataAccess: makeDataAccess(), context: {}, log,
    });

    expect(result).to.deep.equal([]);
  });
});
