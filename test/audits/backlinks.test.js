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

import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import auditBrokenBacklinks from '../../src/backlinks/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

describe('Backlinks Tests', () => {
  let message;
  let context;
  let mockLog;
  let mockDataAccess;

  const sandbox = sinon.createSandbox();

  const siteData = {
    id: 'site1',
    baseURL: 'https://bar.foo.com',
    isLive: true,
  };

  const site = createSite(siteData);
  site.updateAuditTypeConfig('broken-backlinks', { disabled: false });

  const site2 = createSite({
    id: 'site2',
    baseURL: 'https://foo.com',
    isLive: true,
  });
  site2.updateAuditTypeConfig('broken-backlinks', { disabled: false });

  const auditResult = {
    backlinks: [
      {
        title: 'backlink title',
        url_from: 'url-from',
        url_to: 'url-to',
      },
      {
        title: 'backlink title 2',
        url_from: 'url-from-2',
        url_to: 'url-to-2',
      },
    ],
  };

  beforeEach(() => {
    mockDataAccess = {
      getSiteByID: sinon.stub(),
      addAudit: sinon.stub(),
    };

    message = {
      type: 'broken-backlinks',
      url: 'site1',
    };

    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };

    context = {
      log: mockLog,
      env: {
        AHREFS_API_BASE_URL: 'https://ahrefs.com',
        AHREFS_API_KEY: 'ahrefs-token',
        AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
      },
      dataAccess: mockDataAccess,
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should successfully perform an audit to detect broken backlinks', async () => {
    mockDataAccess.getSiteByID = sinon.stub().withArgs('site1').resolves(site);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.log.info).to.have.been.calledWith('Successfully audited site1 for broken-backlinks type audit');
  });

  it('should successfully perform an audit to detect broken backlinks for both www and non www', async () => {
    const getSiteByIdStub = sinon.stub();
    getSiteByIdStub.withArgs('site1').resolves(site);
    getSiteByIdStub.withArgs('site2').resolves(site2);
    mockDataAccess.getSiteByID = getSiteByIdStub;

    nock('https://ahrefs.com')
      .get(/.*/)
      .times(2)
      .reply(200, auditResult);

    const response = await auditBrokenBacklinks({ url: 'site2', type: 'broken-backlinks' }, context);
    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(
      context.env.AUDIT_RESULTS_QUEUE_URL,
      sinon.match({
        type: message.type,
        url: site2.getBaseURL(),
        auditResult: {
          'https://foo.com': {
            brokenBacklinks: auditResult.backlinks,
            fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=https%3A%2F%2Ffoo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22is_dofollow%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22is_content%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
          },
          'https://www.foo.com': {
            brokenBacklinks: auditResult.backlinks,
            fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=https%3A%2F%2Fwww.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22is_dofollow%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22is_content%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
          },
        },
      }),
    );
  });

  it('returns a 404 when site does not exist', async () => {
    mockDataAccess.getSiteByID.resolves(null);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(404);
  });

  it('returns a 200 when site audits are disabled', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: true },
    });

    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledTwice;
    expect(mockLog.info).to.have.been.calledWith('Audits disabled for site site1');
  });

  it('returns a 200 when audits for type are disabled', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: false, auditTypeConfigs: { 'broken-backlinks': { disabled: true } } },
    });

    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledWith('Audit type broken-backlinks disabled for site site1');
  });

  it('returns a 200 when site is not live', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      isLive: false,
    });

    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledWith('Site site1 is not live');
  });

  it('should handle audit api errors gracefully', async () => {
    mockDataAccess.getSiteByID = sinon.stub().withArgs('site1').resolves(site);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(500);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(
      context.env.AUDIT_RESULTS_QUEUE_URL,
      sinon.match({
        type: message.type,
        url: site.getBaseURL(),
        auditResult: {
          'https://bar.foo.com': {
            error: `broken-backlinks type audit for ${site.getId()} with url ${site.getBaseURL()} failed with error`,
          },
        },
      }),
    );
  });

  it('should handle errors gracefully', async () => {
    mockDataAccess.getSiteByID.throws('some-error');

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(500);
  });
});
