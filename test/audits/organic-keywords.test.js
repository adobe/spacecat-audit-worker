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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import nock from 'nock';
import auditOrganicKeywords from '../../src/organic-keywords/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

describe('Organic Keywords Tests', () => {
  let message;
  let context;
  let dataAccessMock;

  const sandbox = sinon.createSandbox();

  const siteData = {
    id: 'foo',
    baseURL: 'https://foobar.com',
    auditConfig: {
      auditTypeConfigs: {
        'organic-keywords': {
          disabled: false,
        },
      },
    },
  };
  const site = createSite(siteData);

  const auditResult = {
    keywords: [
      {
        keyword: 'foo',
        sum_traffic: 123,
        best_position: 1,
        best_position_prev: 1,
        best_position_diff: 0,
      },
      {
        keyword: 'bar',
        sum_traffic: 23,
        best_position: 2,
        best_position_prev: 7,
        best_position_diff: -5,
      },
      {
        keyword: 'bax',
        sum_traffic: 3,
        best_position: 8,
        best_position_prev: 3,
        best_position_diff: 5,
      },
    ],
  };

  beforeEach(() => {
    message = {
      type: 'organic-keywords',
      url: 'foo',
      auditContext: 'context',
    };

    dataAccessMock = {
      getSiteByID: sinon.stub(),
      addAudit: sinon.stub(),
    };

    context = {
      log: {
        info: sinon.spy(),
        warn: sinon.spy(),
        error: sinon.spy(),
      },
      env: {
        AHREFS_API_BASE_URL: 'https://ahrefs.com',
        AHREFS_API_KEY: 'ahrefs-token',
        AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
      },
      dataAccess: dataAccessMock,
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should return 404 if site not found', async () => {
    dataAccessMock.getSiteByID.resolves(null);

    const result = await auditOrganicKeywords(message, context);
    expect(result.status).to.equal(404);
  });

  it('should return 200 if audits for site is disabled', async () => {
    const disabledSite = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: true },
    });

    dataAccessMock.getSiteByID.resolves(disabledSite);

    const ressult = await auditOrganicKeywords(message, context);

    expect(ressult.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith('Audits disabled for site foo');
  });

  it('should return 200 if audit for organic keyword is disabled', async () => {
    const disabledSite = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: false, auditTypeConfigs: { 'organic-keywords': { disabled: true } } },
    });

    dataAccessMock.getSiteByID.resolves(disabledSite);

    const ressult = await auditOrganicKeywords(message, context);

    expect(ressult.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith('Audit type organic-keywords disabled for site foo');
  });

  it('should successfully perform an audit to fetch top 15 organic keywords', async () => {
    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    dataAccessMock.getSiteByID.resolves(site);
    const today = new Date();
    const monthAgo = new Date(new Date().setMonth(new Date().getMonth() - 1));

    const result = await auditOrganicKeywords(message, context);

    expect(result.status).to.equal(204);
    expect(dataAccessMock.addAudit).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(
      context.env.AUDIT_RESULTS_QUEUE_URL,
      {
        type: message.type,
        url: site.getBaseURL(),
        auditContext: message.auditContext,
        auditResult: {
          keywords: auditResult.keywords,
          fullAuditRef: `https://ahrefs.com/site-explorer/organic-keywords?country=us&limit=15&date=${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}&date_compared=${monthAgo.getFullYear()}-${String(monthAgo.getMonth() + 1).padStart(2, '0')}-${String(monthAgo.getDate()).padStart(2, '0')}&target=https%3A%2F%2Ffoobar.com&output=json&order_by=sum_traffic&mode=prefix&select=keyword%2Cbest_position%2Cbest_position_prev%2Cbest_position_diff%2Csum_traffic`,
        },
      },
    );
  });

  it('should handle errors gracefully', async () => {
    dataAccessMock.getSiteByID.throws('foo-error');

    const result = await auditOrganicKeywords(message, context);

    expect(result.status).to.equal(500);
  });
});
