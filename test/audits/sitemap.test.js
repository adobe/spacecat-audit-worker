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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import audit, {
  fetchContent,
  checkSitemap,
  ERROR_CODES, checkRobotsForSitemap,
} from '../../src/sitemap/handler.js';
import { extractDomainAndProtocol, findSitemap } from '../../src/support/utils.js';

chai.use(sinonChai);
const { expect } = chai;
sinon.createSandbox();
describe('Sitemap Handler', () => {
  let context;
  let mockDataAccess;
  let messageBodyJson;

  beforeEach('setup', () => {
    mockDataAccess = {
      getSiteByID: sinon.stub().resolves({
        id: 'site1',
        baseURL: 'https://some-domain.com',
        imsOrgId: 'org123',
      }),
    };

    messageBodyJson = {
      type: 'audit',
      url: 'site-id',
      auditContext: {},
    };

    context = {
      log: {
        info: sinon.spy(),
        warn: sinon.spy(),
        error: sinon.spy(),
      },
      runtime: { region: 'us-east-1' },
      env: { AUDIT_RESULTS_QUEUE_URL: 'some-queue-url' },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(messageBodyJson),
          }],
        },
      },
      dataAccess: mockDataAccess,
      sqs: { sendMessage: sinon.stub().resolves() },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('sitemap audit returns 404 when site not found', async () => {
    mockDataAccess.getSiteByID = sinon.stub().resolves(null);

    const resp = await audit(messageBodyJson, context);
    expect(resp.status).to.equal(404);
    expect(context.sqs.sendMessage).to.have.callCount(0);
  });

  it('sitemap audit returns 500 when audit fails', async () => {
    context.sqs = sinon.stub().rejects('wololo');

    nock('https://some-domain.com')
      .get('/')
      .reply(200);

    nock('https://www.some-domain.com')
      .get('/')
      .reply(200);

    const resp = await audit(messageBodyJson, context);
    expect(resp.status).to.equal(500);
  });

  it('fetchContent returns null when response is not ok', async () => {
    nock('https://some-domain.com')
      .get('/sitemap.xml')
      .reply(404);

    const resp = await fetchContent('https://some-domain.com/sitemap.xml');
    expect(resp).to.equal(null);
  });

  it('returns not found when site does not exist', async () => {
    mockDataAccess.getSiteByID = sinon.stub().resolves(null);
    const resp = await audit({ type: 'sitemap', url: 'site-id', auditContext: {} }, context);
    expect(resp.status).to.equal(404);
  });
});

describe('checkRobotsForSitemap', () => {
  it('checkRobotsForSitemap returns error when no sitemap found in robots.txt', async () => {
    nock('https://some-domain.com')
      .get('/robots.txt')
      .reply(200, 'Disallow: /');

    const result = await checkRobotsForSitemap('https', 'some-domain.com');
    expect(result).to.deep.equal({ path: null, reasons: [ERROR_CODES.NO_SITEMAP_IN_ROBOTS] });
  });

  it('checkRobotsForSitemap returns error when unable to fetch robots.txt', async () => {
    nock('https://some-domain.com')
      .get('/robots.txt')
      .reply(404);

    const result = await checkRobotsForSitemap('https', 'some-domain.com');
    expect(result).to.deep.equal({ path: null, reasons: [ERROR_CODES.ROBOTS_NOT_FOUND] });
  });

  it('checkRobotsForSitemap returns sitemap path when found in robots.txt', async () => {
    nock('https://some-domain.com')
      .get('/robots.txt')
      .reply(200, 'Sitemap: /sitemap.xml');

    const result = await checkRobotsForSitemap('https', 'some-domain.com');
    expect(result.path).to.equal('/sitemap.xml');
    expect(result.reasons).to.be.an('array').that.is.empty;
  });

  it('checkRobotsForSitemap returns error when no sitemap found in robots.txt', async () => {
    nock('https://some-domain.com')
      .get('/robots.txt')
      .reply(200, 'Disallow: /');

    const result = await checkRobotsForSitemap('https', 'some-domain.com');
    expect(result.path).to.be.null;
    expect(result.reasons).to.deep.equal([ERROR_CODES.NO_SITEMAP_IN_ROBOTS]);
  });

  it('checkRobotsForSitemap returns error when unable to fetch robots.txt', async () => {
    nock('https://some-domain.com')
      .get('/robots.txt')
      .reply(404);

    const result = await checkRobotsForSitemap('https', 'some-domain.com');
    expect(result.path).to.be.null;
    expect(result.reasons).to.deep.equal([ERROR_CODES.ROBOTS_NOT_FOUND]);
  });
});

describe('extractDomainAndProtocol', () => {
  it('should correctly extract the domain and protocol from a URL', () => {
    const result = extractDomainAndProtocol('https://some-domain.com/path');
    expect(result).to.deep.equal({
      protocol: 'https',
      domain: 'some-domain.com',
    });
  });

  it('should return null for an invalid URL', () => {
    const result = extractDomainAndProtocol('not a valid url');
    expect(result).to.equal(null);
  });
});

describe('checkSitemap', () => {
  it('should return SITEMAP_NOT_FOUND and SITEMAP_EMPTY errors when the sitemap does not exist', async () => {
    nock('https://some-domain.com')
      .get('/sitemap.xml')
      .reply(404);

    const resp = await checkSitemap('https://some-domain.com/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_NOT_FOUND);
    expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_EMPTY);
  });

  it('should return FETCH_ERROR when there is a network error', async () => {
    nock('https://some-domain.com')
      .get('/sitemap.xml')
      .replyWithError('Network error');

    const resp = await checkSitemap('https://some-domain.com/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include(ERROR_CODES.FETCH_ERROR);
  });
  it('checkSitemap returns false when sitemap is not valid XML', async () => {
    nock('https://some-domain.com')
      .get('/sitemap.xml')
      .reply(200, 'Not valid XML');

    const resp = await checkSitemap('https://some-domain.com/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include('ERR_SITEMAP_NOT_XML');
  });
  it('checkSitemap returns invalid result for non-existing sitemap', async () => {
    nock('https://some-domain.com')
      .get('/non-existent-sitemap.xml')
      .reply(404);

    const result = await checkSitemap('https://some-domain.com/non-existent-sitemap.xml');
    expect(result.existsAndIsValid).to.be.false;
    expect(result.reasons).to.deep.equal(
      [ERROR_CODES.SITEMAP_NOT_FOUND, ERROR_CODES.SITEMAP_EMPTY],
    );
  });

  it('checkSitemap returns invalid result for non-XML content', async () => {
    nock('https://some-domain.com')
      .get('/invalid-sitemap.xml')
      .reply(200, 'This is not XML content');

    const result = await checkSitemap('https://some-domain.com/invalid-sitemap.xml');
    expect(result.existsAndIsValid).to.be.false;
    expect(result.reasons).to.deep.equal([ERROR_CODES.SITEMAP_NOT_XML]);
  });

  it('checkSitemap returns error for fetch error', async () => {
    nock('https://some-domain.com')
      .get('/sitemap.xml')
      .replyWithError('Fetch error');

    const result = await checkSitemap('https://some-domain.com/sitemap.xml');
    expect(result.existsAndIsValid).to.be.false;
    expect(result.reasons).to.deep.equal([ERROR_CODES.FETCH_ERROR]);
  });

  it('checks sitemap from robots.txt and returns failure when sitemap is not valid', async () => {
    nock('https://some-domain.com')
      .get('/robots.txt')
      .reply(200, 'Sitemap: /invalid-sitemap.xml');

    nock('https://some-domain.com')
      .get('/invalid-sitemap.xml')
      .reply(404);

    const result = await findSitemap('https://some-domain.com');
    expect(result.success).to.be.false;
    expect(result.reasons).to.have.lengthOf(3); // 1 from robots.txt, 2 from invalid sitemap
  });
});

describe('findSitemap', () => {
  it('should return INVALID_URL error when the URL is invalid', async () => {
    const resp = await findSitemap('not a valid url');
    expect(resp.success).to.equal(false);
    expect(resp.reasons[0].error).to.equal(ERROR_CODES.INVALID_URL);
  });
});
