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
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import sinonChai from 'sinon-chai';
import { Request } from '@adobe/fetch';
import nock from 'nock';
import { main } from '../../src/index.js';
import { getRUMUrl } from '../../src/support/utils.js';
import { notFoundData } from '../fixtures/notfounddata.js';

chai.use(sinonChai);
const { expect } = chai;

const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  interval: 7,
  offset: 0,
  limit: 101,
};

describe('Index Tests', () => {
  const request = new Request('https://space.cat');
  let context;
  let messageBodyJson;
  let site;

  beforeEach('setup', () => {
    const siteData = {
      id: 'site1',
      baseURL: 'https://adobe.com',
    };

    site = createSite(siteData);
    const mockDataAccess = {
      getSiteByBaseURL: sinon.stub().resolves(site),
      getSiteByID: sinon.stub().resolves(site),
      addAudit: sinon.stub(),
    };
    messageBodyJson = {
      type: '404',
      url: 'adobe.com',
      auditContext: {
        finalUrl: 'adobe.com',
      },
    };
    context = {
      log: console,
      runtime: {
        region: 'us-east-1',
      },
      env: {
        RUM_DOMAIN_KEY: 'domainkey',
      },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(messageBodyJson),
          }],
        },
      },
      dataAccess: mockDataAccess,
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch 404s for base url > process > send results', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-sources')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        checkpoint: 404,
        url: 'adobe.com',
      })
      .reply(200, notFoundData);

    const resp = await main(request, context);

    expect(resp.status).to.equal(204);
    expect(context.dataAccess.addAudit).to.have.been.calledOnce;
  });

  it('fetch 404s for base url > site data access exception > reject', async () => {
    const exceptionContext = { ...context };
    exceptionContext.dataAccess.getSiteByBaseURL = sinon.stub().rejects('Exception data accesss');

    const resp = await main(request, exceptionContext);

    expect(resp.status).to.equal(500);
  });

  it('fetch 404s for base url > process > notfound', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-sources')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        checkpoint: 404,
        url: 'adobe.com',
      })
      .replyWithError('Bad request');
    const noSiteContext = { ...context };
    noSiteContext.dataAccess.getSiteByBaseURL = sinon.stub().resolves(null);

    const resp = await main(request, noSiteContext);

    expect(resp.status).to.equal(404);
  });

  it('fetch 404s for base url > process > reject', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-sources')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        checkpoint: 404,
        url: 'adobe.com',
      })
      .replyWithError('Bad request');

    const resp = await main(request, context);

    expect(resp.status).to.equal(500);
  });

  it('fetch 404s for base url > audit data model exception > reject', async () => {
    nock('https://adobe.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-sources')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        checkpoint: 404,
        url: 'adobe.com',
      })
      .reply(200, notFoundData);
    const auditFailContext = { ...context };
    auditFailContext.dataAccess.addAudit = sinon.stub().rejects('Error adding audit');

    const resp = await main(request, auditFailContext);

    expect(resp.status).to.equal(500);
  });

  it('getRUMUrl do not add scheme to urls with a scheme already', async () => {
    nock('http://space.cat')
      .get('/')
      .reply(200);

    const finalUrl = await getRUMUrl('http://space.cat');
    expect(finalUrl).to.eql('space.cat');
  });
});
