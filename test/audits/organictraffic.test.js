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
import auditOrganicTraffic from '../../src/organictraffic/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

describe('Organic Traffic Tests', () => {
  let message;
  let context;
  let mockLog;
  let mockDataAccess;

  const sandbox = sinon.createSandbox();

  const siteData = {
    id: 'site1',
    baseURL: 'https://bar.foo.com',
    isLive: false,
  };

  const site = createSite(siteData);
  site.updateAuditTypeConfig('organic-traffic', { disabled: false });
  site.toggleLive();

  const site2 = createSite({
    id: 'site2',
    baseURL: 'https://foo.com',
    isLive: false,
  });
  site2.updateAuditTypeConfig('organic-traffic', { disabled: false });
  site2.toggleLive();

  const auditResult = {
    fullAuditRef: 'https://ahrefs.com/audit/123',
    metrics: [
      {
        date: '2024-01-29T00:00:00Z',
        org_traffic: 179364,
        paid_traffic: 72,
        org_cost: 11284251,
        paid_cost: 2675,
      },
      {
        date: '2024-02-05T00:00:00Z',
        org_traffic: 176236,
        paid_traffic: 52,
        org_cost: 10797893,
        paid_cost: 1724,
      },
    ],
  };

  beforeEach(() => {
    mockDataAccess = {
      getSiteByID: sinon.stub(),
      addAudit: sinon.stub(),
      getLatestAuditForSite: sinon.stub(),
    };

    message = {
      type: 'organic-traffic',
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

  it('should successfully perform an audit to get organic traffic', async () => {
    mockDataAccess.getSiteByID = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.getLatestAuditForSite = sinon.stub().resolves({ auditResult: { metrics: [{ date: '2024-01-29' }] } });

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const response = await auditOrganicTraffic(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.log.info).to.have.been.calledWith('Successfully audited site1 for organic-traffic type audit');
  });

  it('returns a 404 when site does not exist', async () => {
    mockDataAccess.getSiteByID.resolves(null);

    const response = await auditOrganicTraffic(message, context);

    expect(response.status).to.equal(404);
  });

  it('returns a 200 when site audits are disabled', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: true },
    });
    siteWithDisabledAudits.toggleLive();

    mockDataAccess.getLatestAuditForSite = sinon.stub().resolves({});
    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await auditOrganicTraffic(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledTwice;
    expect(mockLog.info).to.have.been.calledWith('Audits disabled for site site1');
  });

  it('returns a 200 when audits for type are disabled', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: false, auditTypeConfigs: { 'organic-traffic': { disabled: true } } },
    });
    siteWithDisabledAudits.toggleLive();

    mockDataAccess.getLatestAuditForSite = sinon.stub().resolves({});
    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await auditOrganicTraffic(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledWith('Audit type organic-traffic disabled for site site1');
  });

  it('returns a 200 when site is not live', async () => {
    const siteWithDisabledAudits = createSite({
      ...siteData,
      isLive: false,
    });

    mockDataAccess.getSiteByID.resolves(siteWithDisabledAudits);

    const response = await auditOrganicTraffic(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledWith('Site site1 is not live');
  });

  it('should handle audit api errors gracefully', async () => {
    mockDataAccess.getSiteByID = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.getLatestAuditForSite = sinon.stub().resolves({ auditResult: { metrics: [{ date: '2024-01-29' }] } });

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(500);

    const response = await auditOrganicTraffic(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.addAudit).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(
      context.env.AUDIT_RESULTS_QUEUE_URL,
      sinon.match({
        type: message.type,
        url: site.getBaseURL(),
        auditResult: {
          error: `organic-traffic type audit for ${site.getId()} with url ${site.getBaseURL()} failed with error`,
        },
      }),
    );
  });

  it('should handle errors gracefully', async () => {
    mockDataAccess.getLatestAuditForSite = sinon.stub().resolves({});
    mockDataAccess.getSiteByID.throws('some-error');

    const response = await auditOrganicTraffic(message, context);

    expect(response.status).to.equal(500);
  });
});
