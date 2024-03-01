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
    const siteObj = {
      id: 'site1',
      baseURL: 'https://some-domain.adobe',
      imsOrgId: 'org123',
    };

    mockDataAccess = {
      getSiteByID: sinon.stub().resolves({
        ...siteObj,
        getBaseURL: () => siteObj.baseURL,
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

    nock('https://some-domain.adobe')
      .get('/')
      .reply(200);

    nock('https://www.some-domain.adobe')
      .get('/')
      .reply(200);

    const resp = await audit(messageBodyJson, context);
    expect(resp.status).to.equal(500);
  });

  it('sitemap ', async () => {
    context.sqs = { sendMessage: sinon.stub().resolves() };

    nock('https://www.some-domain.adobe')
      .get('/robots.txt')
      .reply(200, '');

    nock('https://www.some-domain.adobe')
      .get('/sitemap.xml')
      .reply(404);

    const resp = await audit(messageBodyJson, context);
    expect(resp.status).to.equal(204);
  });

  it('fetchContent returns null when response is not ok', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(404);

    const resp = await fetchContent('https://some-domain.adobe/sitemap.xml');
    expect(resp).to.equal(null);
  });

  it('returns not found when site does not exist', async () => {
    mockDataAccess.getSiteByID = sinon.stub().resolves(null);
    const resp = await audit({ type: 'sitemap', url: 'site-id', auditContext: {} }, context);
    expect(resp.status).to.equal(404);
  });
});

describe('checkRobotsForSitemap', () => {
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  it('checkRobotsForSitemap returns error when no sitemap found in robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Allow: /');

    const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
    expect(result).to.deep.equal({ path: null, reasons: [ERROR_CODES.NO_SITEMAP_IN_ROBOTS] });
  });

  it('checkRobotsForSitemap returns error when unable to fetch robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(404);

    const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
    expect(result).to.deep.equal({ path: null, reasons: [ERROR_CODES.ROBOTS_NOT_FOUND] });
  });

  it('checkRobotsForSitemap returns error when no sitemap found in robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Disallow: /');

    const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
    expect(result.path).to.be.null;
    expect(result.reasons).to.deep.equal([ERROR_CODES.NO_SITEMAP_IN_ROBOTS]);
  });

  it('checkRobotsForSitemap returns error when unable to fetch robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(404);

    const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
    expect(result.path).to.be.null;
    expect(result.reasons).to.deep.equal([ERROR_CODES.ROBOTS_NOT_FOUND]);
  });
});

describe('extractDomainAndProtocol', () => {
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should correctly extract the domain and protocol from a URL', () => {
    const result = extractDomainAndProtocol('https://some-domain.adobe/path');
    expect(result).to.deep.equal({
      protocol: 'https',
      domain: 'some-domain.adobe',
    });
  });

  it('should return null for an invalid URL', () => {
    const result = extractDomainAndProtocol('not a valid url');
    expect(result).to.equal(null);
  });
});

describe('checkSitemap', () => {
  it('should return SITEMAP_NOT_FOUND and SITEMAP_EMPTY errors when the sitemap does not exist', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(404);

    const resp = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_NOT_FOUND);
    expect(resp.reasons).to.include(ERROR_CODES.SITEMAP_EMPTY);
  });

  it('should return FETCH_ERROR when there is a network error', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .replyWithError('Network error');

    const resp = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include(ERROR_CODES.FETCH_ERROR);
  });

  it('checkSitemap returns false when sitemap is not valid XML', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(200, 'Not valid XML');

    const resp = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include('SITEMAP_NOT_XML');
  });

  it('checkSitemap returns invalid result for non-existing sitemap', async () => {
    nock('https://some-domain.adobe')
      .get('/non-existent-sitemap.xml')
      .reply(404);

    const result = await checkSitemap('https://some-domain.adobe/non-existent-sitemap.xml');
    expect(result.existsAndIsValid).to.equal(false);
    expect(result.reasons).to.deep.equal(
      [ERROR_CODES.SITEMAP_NOT_FOUND, ERROR_CODES.SITEMAP_EMPTY],
    );
  });

  it('checkSitemap returns invalid result for non-XML content', async () => {
    nock('https://some-domain.adobe')
      .get('/invalid-sitemap.xml')
      .reply(200, 'This is not XML content');

    const result = await checkSitemap('https://some-domain.adobe/invalid-sitemap.xml');
    expect(result.existsAndIsValid).to.be.false;
    expect(result.reasons).to.deep.equal([ERROR_CODES.SITEMAP_NOT_XML]);
  });

  it('checkSitemap returns error for fetch error', async () => {
    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .replyWithError('Fetch error');

    const result = await checkSitemap('https://some-domain.adobe/sitemap.xml');
    expect(result.existsAndIsValid).to.be.false;
    expect(result.reasons).to.deep.equal([ERROR_CODES.FETCH_ERROR]);
  });
});

describe('findSitemap', () => {
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should return error when URL is invalid', async () => {
    const result = await findSitemap('not a valid url');
    expect(result.success).to.equal(false);
    expect(result.reasons[0].error).to.equal(ERROR_CODES.INVALID_URL);
  });

  it('should return success when sitemap is found in robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Sitemap: /sitemap.xml');

    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(200, '<?xml');

    const result = await findSitemap('https://some-domain.adobe');
    expect(result.success).to.equal(true);
    expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap.xml');
  });

  it('should return success when sitemap.xml is found', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Allow: /');

    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(200, '<?xml');

    const result = await findSitemap('https://some-domain.adobe');
    expect(result.success).to.equal(true);
    expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap.xml');
  });

  it('should return success when sitemap_index.xml is found', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Allow: /');

    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(404);

    nock('https://some-domain.adobe')
      .get('/sitemap_index.xml')
      .reply(200, '<?xml');

    const result = await findSitemap('https://some-domain.adobe');
    expect(result.success).to.equal(true);
    expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap_index.xml');
  });

  it('should return error when no sitemap is found', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Allow: /');

    nock('https://some-domain.adobe')
      .get('/sitemap.xml')
      .reply(404);

    nock('https://some-domain.adobe')
      .get('/sitemap_index.xml')
      .reply(404);

    const result = await findSitemap('https://some-domain.adobe');
    expect(result.success).to.equal(false);
  });

  it('checkRobotsForSitemap returns sitemap path when found in robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Sitemap: /sitemap.xml');

    const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
    expect(result.path).to.equal('/sitemap.xml');
    expect(result.reasons).to.be.an('array').that.is.empty;
  });

  it('checkRobotsForSitemap returns sitemap path found in robots.txt that exists', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Sitemap: /sitemap2.xml');

    nock('https://some-domain.adobe')
      .get('/sitemap2.xml')
      .reply(200, '<?xml');

    const result = await findSitemap('https://some-domain.adobe');
    expect(result.success).to.equal(true);
    expect(result.paths[0]).to.equal('https://some-domain.adobe/sitemap2.xml');
  });

  it('checkRobotsForSitemap returns sitemap path found in robots.txt but does not exist', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, 'Sitemap: /sitemap2.xml');

    nock('https://some-domain.adobe')
      .get('/sitemap2.xml')
      .reply(404, '');

    const result = await findSitemap('https://some-domain.adobe');
    expect(result.success).to.equal(false);
  });

  it('checkRobotsForSitemap returns error when no sitemap is found in robots.txt', async () => {
    nock('https://some-domain.adobe')
      .get('/robots.txt')
      .reply(200, '');

    const result = await checkRobotsForSitemap('https', 'some-domain.adobe');
    expect(result.path).to.be.null;
    expect(result.reasons).to.deep.equal([ERROR_CODES.NO_SITEMAP_IN_ROBOTS]);
  });
});
