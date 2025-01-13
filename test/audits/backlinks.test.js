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
import { Configuration } from '@adobe/spacecat-shared-data-access';
import ConfigurationSchema from '@adobe/spacecat-shared-data-access/src/models/configuration/configuration.schema.js';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import auditBrokenBacklinks from '../../src/backlinks/handler.js';

use(sinonChai);
use(chaiAsPromised);

// eslint-disable-next-line func-names
describe('Backlinks Tests', function () {
  this.timeout(10000);
  let message;
  let context;
  let mockLog;
  let mockDataAccess;
  let configuration;

  const sandbox = sinon.createSandbox();

  const siteData = {
    getConfig: () => Config({}),
    getId: () => 'site1',
    getBaseURL: () => 'https://bar.foo.com',
    getIsLive: () => true,
    getOrganizationId: () => 'org1',
  };

  const site = siteData;

  const siteTopPage = {
    getSiteId: () => site.getId(),
    getUrl: () => `${site.getBaseURL()}/foo.html`,
    getTraffic: () => 1000,
    getSource: () => 'ahrefs',
    getGeo: () => 'global',
    getImportedAt: () => new Date('2024-06-18').toISOString(),
    getTopKeyword: () => '404',
  };

  const siteTopPage2 = {
    getSiteId: () => site.getId(),
    getUrl: () => `${site.getBaseURL()}/bar.html`,
    getTraffic: () => 500,
    getSource: () => 'ahrefs',
    getGeo: () => 'global',
    getImportedAt: () => new Date('2024-06-18').toISOString(),
    getTopKeyword: () => '429',
  };

  const site2 = {
    getId: () => 'site2',
    getBaseURL: () => 'https://foo.com',
    getConfig: () => Config({}),
    getIsLive: () => true,
    getOrganizationId: () => 'org2',
  };

  const site3 = {
    getId: () => 'site3',
    getBaseURL: () => 'https://foo.com',
    getConfig: () => Config({}),
    getIsLive: () => true,
    getOrganizationId: () => 'org3',
  };

  const org = { getId: () => 'org4', getName: () => 'org4' };

  const brokenBacklinkWithTimeout = {
    title: 'backlink that times out',
    url_from: 'https://from.com/from-4',
    url_to: 'https://foo.com/times-out',
    traffic_domain: 500,
  };

  const auditResult = {
    backlinks: [
      {
        title: 'backlink that returns 404',
        url_from: 'https://from.com/from-1',
        url_to: 'https://foo.com/returns-404',
        traffic_domain: 4000,
      },
      {
        title: 'backlink that redirects to www and throw connection error',
        url_from: 'https://from.com/from-2',
        url_to: 'https://foo.com/redirects-throws-error',
        traffic_domain: 2000,
      },
      {
        title: 'backlink that returns 429',
        url_from: 'https://from.com/from-3',
        url_to: 'https://foo.com/returns-429',
        traffic_domain: 1000,
      },
    ],
  };

  const excludedUrl = 'https://foo.com/returns-404';

  const siteWithExcludedUrls = {
    ...siteData,
    getConfig: () => Config({
      slack: {
        workspace: 'my-workspace',
        channel: 'general',
        invitedUserCount: 10,
      },
      handlers: {
        404: {
          mentions: {
            slack: ['user1', 'user2'],
            email: ['user1@example.com'],
          },
          excludedURLs: [excludedUrl],
        },
        'broken-backlinks': {
          mentions: {
            slack: ['user3'],
            email: ['user2@example.com'],
          },
          excludedURLs: [excludedUrl],
        },
      },
    }),
  };

  const expectedAuditResult = {
    finalUrl: 'https://bar.foo.com',
    brokenBacklinks: [
      {
        title: 'backlink that redirects to www and throw connection error',
        url_from: 'https://from.com/from-2',
        url_to: 'https://foo.com/redirects-throws-error',
        traffic_domain: 2000,
      },
      {
        title: 'backlink that returns 429',
        url_from: 'https://from.com/from-3',
        url_to: 'https://foo.com/returns-429',
        traffic_domain: 1000,
        url_suggested: 'https://bar.foo.com/bar.html',
      },
      {
        title: 'backlink that is not excluded',
        url_from: 'https://from.com/from-not-excluded',
        url_to: 'https://foo.com/not-excluded',
        traffic_domain: 5000,
      },
    ],
    fullAuditRef: sinon.match.string,
  };

  const backlinksNotExcluded = [
    {
      title: 'backlink that is not excluded',
      url_from: 'https://from.com/from-not-excluded',
      url_to: 'https://foo.com/not-excluded',
      traffic_domain: 5000,
    },
  ];

  const audit = {
    getId: () => 'test-audit-id',
  };

  let brokenBacklinksOpportunity;
  let brokenBacklinksSuggestions;
  let brokenBacklinkExistingSuggestions;
  let otherOpportunity;

  beforeEach(() => {
    configuration = new Configuration(
      { entities: { configuration: {} } },
      { getCollection: () => 'configurations' },
      ConfigurationSchema,
      {
        version: '1.0',
        queues: {},
        handlers: {
          'broken-backlinks': {
            enabled: {
              sites: ['site1', 'site2', 'site3', 'site'],
              orgs: ['org1', 'org2', 'org3'],
            },
            enabledByDefault: false,
            dependencies: [],
          },
          'broken-backlinks-auto-suggest': {
            enabled: {
              sites: ['site1', 'site2', 'site3', 'site'],
              orgs: ['org1', 'org2', 'org3'],
            },
            enabledByDefault: false,
            dependencies: [],
          },
        },
        jobs: [],
      },
      console,
    );

    configuration.patcher = {
      patchValue: sinon.stub(),
    };

    brokenBacklinksOpportunity = {
      getType: () => 'broken-backlinks',
      getId: () => 'test-opportunity-id',
      getSiteId: () => site.getId(),
      addSuggestions: sinon.stub(),
      getSuggestions: sinon.stub(),
      setAuditId: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    brokenBacklinksSuggestions = {
      createdItems: auditResult.backlinks,
      errorItems: [],
    };

    brokenBacklinkExistingSuggestions = [{
      opportunityId: brokenBacklinksOpportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: 5000,
      data: {
        title: 'backlink that is not excluded',
        url_from: 'https://from.com/from-not-excluded',
        url_to: 'https://foo.com/not-excluded',
        traffic_domain: 5000,
      },
      remove: sinon.stub(),
      getData: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub(),
    }];

    brokenBacklinkExistingSuggestions[0].remove.resolves();

    otherOpportunity = {
      getType: () => 'other',
    };

    mockDataAccess = {
      Audit: {
        create: sinon.stub().resolves(audit),
      },
      Configuration: {
        findLatest: sinon.stub().resolves(configuration),
      },
      Site: {
        findById: sinon.stub(),
      },
      SiteTopPage: {
        allBySiteId: sinon.stub(),
        allBySiteIdAndSourceAndGeo: sinon.stub(),
      },
      Opportunity: {
        allBySiteIdAndStatus: sinon.stub(),
        create: sinon.stub(),
      },
    };

    message = {
      type: 'broken-backlinks',
      siteId: 'site1',
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

    nock('https://foo.com')
      .get('/returns-404')
      .reply(404);

    nock('https://foo.com')
      .get('/redirects-throws-error')
      .reply(301, undefined, { location: 'https://www.foo.com/redirects-throws-error' });

    nock('https://www.foo.com')
      .get('/redirects-throws-error')
      .replyWithError({ code: 'ECONNREFUSED', syscall: 'connect' });

    nock('https://foo.com')
      .get('/returns-429')
      .reply(429);

    nock('https://foo.com')
      .get('/times-out')
      .delay(3010)
      .reply(200);
  });
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should filter out excluded URLs and include valid backlinks', async () => {
    mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([siteTopPage, siteTopPage2]);
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(siteWithExcludedUrls);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves(brokenBacklinkExistingSuggestions);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );
    brokenBacklinkExistingSuggestions[0].getData.returns(brokenBacklinkExistingSuggestions[0].data);
    brokenBacklinkExistingSuggestions[0].setData.returns();
    brokenBacklinkExistingSuggestions[0].save.resolves();

    nock(siteWithExcludedUrls.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, { backlinks: auditResult.backlinks.concat(backlinksNotExcluded) });

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(brokenBacklinkExistingSuggestions[0].setData).to.have.been.calledOnceWith(
      brokenBacklinkExistingSuggestions[0].data,
    );
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(
      context.env.AUDIT_RESULTS_QUEUE_URL,
      sinon.match({
        type: message.type,
        url: siteWithExcludedUrls.getBaseURL(),
        auditContext: sinon.match.any,
        auditResult: sinon.match({
          finalUrl: 'bar.foo.com',
          brokenBacklinks: expectedAuditResult.brokenBacklinks,
          fullAuditRef: sinon.match.string,
        }),
      }),
    );
  });

  it('should successfully perform an audit to detect broken backlinks, save and add the proper audit result to an existing opportunity', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const expectedMessage = {
      type: message.type,
      url: site.getBaseURL(),
      auditContext: {
        finalUrl: 'bar.foo.com',
      },
      auditResult: {
        finalUrl: 'bar.foo.com',
        brokenBacklinks: auditResult.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=bar.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.setAuditId).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
    expect(context.log.info).to.have.been.calledWith('Successfully audited site1 for broken-backlinks type audit');
  });

  it('should successfully perform an audit to detect broken backlinks, save and add the proper audit result to a new opportunity', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    mockDataAccess.Opportunity.create.resolves(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([otherOpportunity]);

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const expectedMessage = {
      type: message.type,
      url: site.getBaseURL(),
      auditContext: {
        finalUrl: 'bar.foo.com',
      },
      auditResult: {
        finalUrl: 'bar.foo.com',
        brokenBacklinks: auditResult.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=bar.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(mockDataAccess.Opportunity.create).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
    expect(context.log.info).to.have.been.calledWith('Successfully audited site1 for broken-backlinks type audit');
  });

  it('should perform a partial successful audit to detect broken backlinks, save and add the proper audit result to an existing opportunity', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves({
      createdItems: auditResult.backlinks,
      errorItems: [{
        item: auditResult.backlinks[0],
        error: 'ValidationError',
      }],
    });
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const expectedMessage = {
      type: message.type,
      url: site.getBaseURL(),
      auditContext: {
        finalUrl: 'bar.foo.com',
      },
      auditResult: {
        finalUrl: 'bar.foo.com',
        brokenBacklinks: auditResult.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=bar.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.setAuditId).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
    expect(context.log.info).to.have.been.calledWith('Successfully audited site1 for broken-backlinks type audit');
    expect(context.log.error).to.have.been.calledWith(
      'Suggestions for siteId site1 contains 1 items with errors',
    );
  });

  it('should successfully perform an audit to detect broken backlinks, save and send the proper audit result for message containing siteId', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const expectedMessage = {
      type: message.type,
      url: site.getBaseURL(),
      auditContext: {
        finalUrl: 'bar.foo.com',
      },
      auditResult: {
        finalUrl: 'bar.foo.com',
        brokenBacklinks: auditResult.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=bar.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
    expect(context.log.info).to.have.been.calledWith('Successfully audited site1 for broken-backlinks type audit');
  });

  it('should successfully perform an audit to detect broken backlinks and suggest fixes based on keywords from top pages if auto-suggest'
    + ' enabled', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([siteTopPage, siteTopPage2]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const expectedEnhancedBacklinks = auditResult.backlinks;
    expectedEnhancedBacklinks[0].url_suggested = 'https://bar.foo.com/foo.html';
    expectedEnhancedBacklinks[2].url_suggested = 'https://bar.foo.com/bar.html';

    const expectedMessage = {
      type: message.type,
      url: site.getBaseURL(),
      auditContext: {
        finalUrl: 'bar.foo.com',
      },
      auditResult: {
        finalUrl: 'bar.foo.com',
        brokenBacklinks: auditResult.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=bar.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('should successfully perform an audit to detect broken backlinks and not suggest fixes if auto-suggest disabled', async () => {
    mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);
    mockDataAccess.Site.findById = sinon.stub().withArgs('site2').resolves(site2);
    configuration.disableHandlerForSite('broken-backlinks-auto-suggest', {
      getId: () => site2.getId(),
      getOrganizationId: () => org.getId(),
    });
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    // FetchError: Nock: No match for request {
    //   "method": "GET",
    //   "url": "https://www.foo.com/",
    //   "headers": {
    //     "user-agent": "curl/7.88.1",
    //     "host": "www.foo.com",
    //     "accept": "*/*",
    //     "accept-encoding": "gzip,deflate,br"
    //   }
    // }

    nock(site2.getBaseURL())
      .get(/.*/)
      .reply(301, undefined, { location: 'https://www.foo.com' });

    nock('https://www.foo.com')
      .get('/')
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const expectedMessage = {
      type: message.type,
      url: site2.getBaseURL(),
      auditContext: {
        finalUrl: 'www.foo.com',
      },
      auditResult: {
        finalUrl: 'www.foo.com',
        brokenBacklinks: auditResult.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=www.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks({
      siteId: site2.getId(), type: 'broken-backlinks',
    }, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.SiteTopPage.allBySiteId).to.not.have.been.called;
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
    expect(context.log.info).to.have.been.calledWith('Successfully audited site2 for broken-backlinks type audit');
  });

  it('should detect broken backlinks and save the proper audit result, even if the suggested fix fails', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([{
      getSiteId: () => site.getId(),
      getUrl: () => `${site.getBaseURL()}/foo.html`,
      getTraffic: () => 1000,
      getSource: () => 'ahrefs',
      getGeo: () => 'global',
      getImportedAt: () => new Date('2024-06-18').toISOString(),
      getTopKeyword: () => 'c++',
    }]);
    const brokenBacklink = {
      backlinks: [
        {
          title: 'backlink that has a faulty path',
          url_from: 'https://from.com/from-1',
          url_to: 'https://foo.com/c++',
          domain_traffic: 4000,
        }],
    };
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );
    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, brokenBacklink);

    const expectedMessage = {
      type: message.type,
      url: site.getBaseURL(),
      auditContext: {
        finalUrl: 'bar.foo.com',
      },
      auditResult: {
        finalUrl: 'bar.foo.com',
        brokenBacklinks: brokenBacklink.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=bar.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };
    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
  });

  it('should successfully perform an audit to detect broken backlinks and set finalUrl, for baseUrl redirecting to www domain', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site2').resolves(site2);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site2.getBaseURL())
      .get(/.*/)
      .reply(301, undefined, { location: 'https://www.foo.com' });

    nock('https://www.foo.com')
      .get('/')
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const expectedMessage = {
      type: message.type,
      url: site2.getBaseURL(),
      auditContext: {
        finalUrl: 'www.foo.com',
      },
      auditResult: {
        finalUrl: 'www.foo.com',
        brokenBacklinks: auditResult.backlinks,
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=www.foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks({
      siteId: site2.getId(), type: 'broken-backlinks',
    }, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
    expect(context.log.info).to.have.been.calledWith('Successfully audited site2 for broken-backlinks type audit');
  });

  it('should filter out from audit result broken backlinks the ones that return ok (even with redirection)', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site2').resolves(site2);
    mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    const fixedBacklinks = [
      {
        title: 'fixed backlink',
        url_from: 'https://from.com/from-1',
        url_to: 'https://foo.com/fixed',
        traffic_domain: 4500,
      },
      {
        title: 'fixed backlink via redirect',
        url_from: 'https://from.com/from-2',
        url_to: 'https://foo.com/fixed-via-redirect',
        traffic_domain: 1500,
      },
    ];
    const allBacklinks = auditResult.backlinks.concat(fixedBacklinks, brokenBacklinkWithTimeout);

    nock('https://foo.com')
      .get('/fixed')
      .reply(200);

    nock('https://foo.com')
      .get('/fixed-via-redirect')
      .reply(301, undefined, { location: 'https://www.foo.com/fixed-via-redirect' });

    nock('https://www.foo.com')
      .get('/fixed-via-redirect')
      .reply(200);

    nock(site2.getBaseURL())
      .get('/')
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, { backlinks: allBacklinks });

    const expectedMessage = {
      type: message.type,
      url: site2.getBaseURL(),
      auditContext: {
        finalUrl: 'foo.com',
      },
      auditResult: {
        finalUrl: 'foo.com',
        brokenBacklinks: auditResult.backlinks.concat(brokenBacklinkWithTimeout),
        fullAuditRef: 'https://ahrefs.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to%2Ctraffic_domain&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=foo.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      },
    };

    const response = await auditBrokenBacklinks({
      siteId: site2.getId(), type: 'broken-backlinks',
    }, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(context.env.AUDIT_RESULTS_QUEUE_URL, expectedMessage);
    expect(context.log.warn).to.have.been.calledWith('Backlink https://foo.com/returns-429 returned status 429');
    expect(context.log.info).to.have.been.calledWith('Successfully audited site2 for broken-backlinks type audit');
  });

  it('returns a 404 when site does not exist', async () => {
    mockDataAccess.Site.findById.resolves(null);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(404);
  });

  it('returns a 200 when site audit is disabled', async () => {
    /* const siteWithDisabledAudits = createSite({
      ...siteData,
      auditConfig: { auditsDisabled: true },
    }); */
    message = {
      type: 'broken-backlinks',
      siteId: 'site3',
    };

    mockDataAccess.Site.findById.resolves(site3);
    configuration.isHandlerEnabledForSite = sinon.stub().returns(false);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledOnce;
    expect(mockLog.info).to.have.been.calledWith('Audit type broken-backlinks disabled for site site3');
  });

  it('returns a 500 for sites with no base url', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site2').resolves(site2);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);

    const response = await auditBrokenBacklinks(message, context);
    expect(response.status).to.equal(500);
    expect(mockLog.error).to.have.been.calledTwice;
  });

  it('should return a 500 if suggestions cannot be added to an opportunity', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves({
      createdItems: [],
      errorItems: [{
        item: auditResult.backlinks[0],
        error: 'ValidationError',
      }],
    });
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(500);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.setAuditId).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledOnce;
    expect(context.log.error).to.have.been.calledWith('Suggestions for siteId site1 contains 1 items with errors');
  });

  it('should return 500 when opportunity fetching fails', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('oppty error'));

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(500);
    expect(mockLog.error).to.have.been.calledWith('Fetching opportunities for siteId site1 failed with error: oppty error');
  });

  it('should return 500 when opportunity saving fails', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.SiteTopPage.allBySiteId.resolves([]);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.save.rejects(new Error('save error'));
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(500);
    expect(mockLog.error).to.have.been.calledWith('Creating opportunity for siteId site1 failed with error: save error');
  });

  it('returns a 200 when site is not live', async () => {
    const siteWithDisabledAudits = {
      ...siteData,
      getIsLive: () => false,
    };

    mockDataAccess.Site.findById.resolves(siteWithDisabledAudits);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(200);
    expect(mockLog.info).to.have.been.calledWith('Site site1 is not live');
  });

  it('should handle audit api errors gracefully', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    mockDataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    brokenBacklinksOpportunity.setAuditId.returns(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [otherOpportunity, brokenBacklinksOpportunity],
    );

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(500);

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(204);
    expect(mockDataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(
      context.env.AUDIT_RESULTS_QUEUE_URL,
      sinon.match({
        type: message.type,
        url: site.getBaseURL(),
        auditResult: {
          finalUrl: 'bar.foo.com',
          error: `broken-backlinks type audit for ${site.getId()} with url bar.foo.com failed with error`,
        },
      }),
    );
  });

  it('should handle errors gracefully', async () => {
    mockDataAccess.Site.findById.throws('some-error');

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(500);
  });

  it('should handle fetch errors gracefully', async () => {
    mockDataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);

    nock(site.getBaseURL())
      .get(/.*/)
      .replyWithError({ code: 'ECONNREFUSED', syscall: 'connect' });

    const response = await auditBrokenBacklinks(message, context);

    expect(response.status).to.equal(500);
  });
});
