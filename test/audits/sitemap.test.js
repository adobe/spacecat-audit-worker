/*
 * Copyright 2023 Adobe. All rights reserved.
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
  findSitemap,
  fetchContent,
  checkSitemap,
  ERROR_CODES,
} from '../../src/sitemap/handler.js';
import { extractDomainAndProtocol } from '../../src/support/utils.js';

chai.use(sinonChai);
const { expect } = chai;
sinon.createSandbox();
describe('Sitemap Handler', () => {
  let context;
  let mockDataAccess;

  beforeEach('setup', () => {
    mockDataAccess = {
      getSiteByID: sinon.stub().resolves({
        id: 'site1',
        baseURL: 'https://some-domain.com',
        imsOrgId: 'org123',
      }),
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
            body: JSON.stringify({
              type: 'sitemap',
              url: 'site-id',
              auditContext: {},
            }),
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
    const resp = await audit(context.invocation.event.Records[0].body, context);
    expect(resp.status).to.equal(404);
    expect(context.sqs.sendMessage).to.have.callCount(0);
  });

  it('sitemap audit returns 500 when audit fails', async () => {
    context.sqs = sinon.stub().rejects('wololo');
    nock('https://some-domain.com').get('/sitemap.xml').reply(200);
    const resp = await audit(context.invocation.event.Records[0].body, context);
    expect(resp.status).to.equal(500);
  });

  it('fetchContent returns null when response is not ok', async () => {
    nock('https://some-domain.com')
      .get('/sitemap.xml')
      .reply(404);

    const resp = await fetchContent('https://some-domain.com/sitemap.xml');
    expect(resp).to.equal(null);
  });

  it('checkSitemap returns false when sitemap is not valid XML', async () => {
    nock('https://some-domain.com')
      .get('/sitemap.xml')
      .reply(200, 'Not valid XML');

    const resp = await checkSitemap('https://some-domain.com/sitemap.xml');
    expect(resp.existsAndIsValid).to.equal(false);
    expect(resp.reasons).to.include('ERR_SITEMAP_NOT_XML');
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
});

describe('findSitemap', () => {
  it('should return INVALID_URL error when the URL is invalid', async () => {
    const resp = await findSitemap('not a valid url');
    expect(resp.success).to.equal(false);
    expect(resp.reasons[0].error).to.equal(ERROR_CODES.INVALID_URL);
  });
});
