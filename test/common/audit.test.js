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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { composeAuditURL, hasText, prependSchema } from '@adobe/spacecat-shared-utils';
import {
  BaseAudit,
  defaultMessageSender,
  defaultOrgProvider,
  defaultPersister,
  defaultPostProcessors,
  defaultSiteProvider,
  defaultUrlResolver,
  noopPersister,
  noopUrlResolver,
  wwwUrlResolver,
} from '../../src/common/index.js';
import { AuditBuilder } from '../../src/common/audit-builder.js';
import { MockContextBuilder } from '../shared.js';
import { getUrlWithoutPath } from '../../src/support/utils.js';

use(sinonChai);
use(chaiAsPromised);

const baseURL = 'https://space.cat';
const message = {
  type: 'dummy',
  siteId: 'site-id',
  auditContext: { someField: 431 },
};
const mockDate = '2023-03-12T15:24:51.231Z';
const sandbox = sinon.createSandbox();
describe('Audit tests', () => {
  let clock;
  let context;
  let site;
  let org;
  let configuration;

  beforeEach('setup', () => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(message);

    org = {
      getId: () => 'some-org-id',
      getName: () => 'some-org',
    };
    site = {
      getId: () => 'site-id',
      getBaseURL: () => baseURL,
      getOrganizationId: () => org.getId(),
      getIsLive: () => true,
      getIsError: () => false,
    };
    configuration = {
      getVersion: () => '1.0',
      getQueues: () => {
      },
      getHandlers: () => ({
        dummy: {
          enabled: {
            sites: ['site-id', 'space.cat', site.getId()],
            orgs: ['some-org', 'org2', org.getId()],
          },
          enabledByDefault: false,
          dependencies: [],
        },
      }),
      getJobs: () => [],
      isHandlerEnabledForSite: () => true,
      disableHandlerForSite: () => true,
      disableHandlerForOrg: () => true,
    };
  });

  afterEach('clean', () => {
    clock.restore();
  });

  describe('default components', () => {
    it('default site provider throws error when site is not found', async () => {
      context.dataAccess.Site.findById.withArgs(message.url).resolves(null);
      await expect(defaultSiteProvider(message.url, context))
        .to.be.rejectedWith(`Site with id ${message.url} not found`);
    });

    it('default site provider returns site', async () => {
      context.dataAccess.Site.findById.withArgs(message.url).resolves(site);

      const result = await defaultSiteProvider(message.url, context);
      expect(result.getBaseURL()).to.equal(baseURL);

      expect(context.dataAccess.Site.findById).to.have.been.calledOnce;
    });

    it('default org provider throws error when org is not found', async () => {
      context.dataAccess.Organization.findById.withArgs(site.getOrganizationId()).resolves(null);
      await expect(defaultOrgProvider(site.getOrganizationId(), context))
        .to.be.rejectedWith(`Org with id ${site.getOrganizationId()} not found`);
    });

    it('default org provider returns org', async () => {
      context.dataAccess.Organization.findById.withArgs(site.getOrganizationId()).resolves(org);

      const result = await defaultOrgProvider(site.getOrganizationId(), context);
      expect(result.getId()).to.equal(site.getOrganizationId());

      expect(context.dataAccess.Organization.findById).to.have.been.calledOnce;
    });

    it('default persister saves the audit result to data access', async () => {
      context.dataAccess.Audit.create.resolves();
      const auditData = { result: 'hebele' };

      await defaultPersister(auditData, context);

      expect(context.dataAccess.Audit.create).to.have.been.calledOnce;
      expect(context.dataAccess.Audit.create).to.have.been.calledWith(auditData);
    });

    it('default message sender sends the audit to sqs', async () => {
      const queueUrl = 'some-queue-url';
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.sqs.sendMessage.resolves();

      const resultMessage = { result: 'hebele' };

      await defaultMessageSender(resultMessage, context);

      expect(context.sqs.sendMessage).not.to.have.been.calledOnce;
    });

    it('default url resolves gets the base url and follows redirects', async () => {
      const finalUrl = 'www.space.cat';

      nock(baseURL)
        .get('/')
        .reply(301, undefined, { Location: `https://${finalUrl}/` });

      nock(`https://${finalUrl}`)
        .get('/')
        .reply(200, 'Success');

      const url = await defaultUrlResolver(site);

      expect(url).to.equal(finalUrl);
    });

    it('no-op url resolver returns the base url only', async () => {
      const url = await noopUrlResolver(site);
      expect(url).to.equal(baseURL);
    });
  });

  describe('audit runner', () => {
    it('audit fails when built without a runner', async () => {
      expect(() => new AuditBuilder().build()).to.throw('Audit must have either steps or a runner defined');
    });

    it('audit run fails when an underlying audit step throws an error', async () => {
      const dummyRummer = () => 123;
      const audit = new AuditBuilder()
        .withRunner(dummyRummer)
        .build();

      await expect(audit.run(message, context))
        .to.be.rejectedWith(`${message.type} audit failed for site ${message.siteId}. Reason: Site with id ${message.siteId} not found`);
    });

    it('should follow redirection and return final URL', async () => {
      nock('https://spacekitty.cat')
        .get('/blog')
        .reply(301, undefined, { Location: 'https://www.spacekitty.cat/blog' });

      nock('https://www.spacekitty.cat')
        .get('/blog')
        .reply(200, () => 'hello world', {});

      const testsite = { getBaseURL: () => 'https://spacekitty.cat/blog', getOrganizationId: () => org.getId() };
      const initialBaseURL = testsite.getBaseURL();
      const auditURL = await composeAuditURL(initialBaseURL);
      const urlWithSchema = prependSchema(auditURL);
      const finalURL = getUrlWithoutPath(urlWithSchema);

      expect(finalURL).to.equal('https://www.spacekitty.cat');
    });

    it('audit run skips when audit is disabled', async () => {
      configuration.isHandlerEnabledForSite = sinon.stub().returns(false);
      const queueUrl = 'some-queue-url';
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.dataAccess.Site.findById.withArgs(message.siteId).resolves(site);
      context.dataAccess.Organization.findById.withArgs(site.getOrganizationId()).resolves(org);
      context.dataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);

      const audit = new AuditBuilder()
        .withRunner(() => 123)
        .build();

      const resp = await audit.run(message, context);

      expect(resp.status).to.equal(200);
      expect(context.log.warn).to.have.been.calledWith('dummy audits disabled for site site-id, skipping...');
    });

    it('audit runs as expected with post processors', async () => {
      const queueUrl = 'some-queue-url';
      const fullAuditRef = 'hebele';
      const auditData = {
        siteId: site.getId(),
        isLive: site.getIsLive(),
        auditedAt: mockDate,
        auditType: message.type,
        auditResult: { metric: 42 },
        fullAuditRef,
      };
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.dataAccess.Site.findById.withArgs(message.siteId).resolves(site);
      context.dataAccess.Organization.findById.withArgs(site.getOrganizationId()).resolves(org);
      context.dataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
      context.dataAccess.Audit.create.resolves({
        getId: () => 'some-audit-id',
      });
      context.sqs.sendMessage.resolves();

      // Stubs for post processors
      const updatedAuditData1 = {
        ...auditData,
        auditResult: { ...auditData.auditResult, extraMetric: 100 },
      };
      const updatedAuditData2 = {
        ...updatedAuditData1,
        auditResult: { ...updatedAuditData1.auditResult, anotherMetric: 200 },
      };

      const postProcessors = [
        sandbox.stub().resolves(updatedAuditData1), // First post processor modifies auditData
        sandbox.stub().resolves(), // second post processor does not return anything
        sandbox.stub().rejects(new Error('some nasty error')), // Third post processor throws an error
        sandbox.stub().resolves(updatedAuditData2), // Fourth post processor should not be called
      ];

      nock(baseURL)
        .get('/')
        .reply(200);

      const dummyRunner = (url, _context) => ({
        auditResult: typeof url === 'string' && typeof _context === 'object' ? { metric: 42 } : null,
        fullAuditRef,
      });

      // Act
      const audit = new AuditBuilder()
        .withSiteProvider(defaultSiteProvider)
        .withUrlResolver(defaultUrlResolver)
        .withRunner(dummyRunner)
        .withPersister(defaultPersister)
        .withMessageSender(defaultMessageSender)
        .withPostProcessors(postProcessors)
        .build();

      await expect(audit.run(message, context)).to.be.rejectedWith('some nasty error');

      // Assert
      expect(context.dataAccess.Audit.create).to.have.been.calledOnce;

      expect(context.dataAccess.Audit.create).to.have.been.calledWith(auditData);

      const finalUrl = 'space.cat';
      expect(context.sqs.sendMessage).not.to.have.been.calledOnce;

      expect(postProcessors[0]).to.have.been.calledWith(finalUrl, auditData, context, site);
      expect(postProcessors[1]).to.have.been.called;
      expect(postProcessors[2]).to.have.been.calledWith(finalUrl, updatedAuditData1, context, site);
      expect(postProcessors[3]).to.not.have.been.called;

      expect(context.log.error).to.have.been.calledOnceWith(
        `Post processor functionStub failed for dummy audit failed for site site-id. Reason: some nasty error.\nAudit data: ${JSON.stringify(updatedAuditData1)}`,
      );
    });
  });

  it('audit runs as expected when receiving siteId instead of message ', async () => {
    const queueUrl = 'some-queue-url';
    context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
    context.dataAccess.Site.findById.withArgs(message.url).resolves(site);
    context.dataAccess.Organization.findById.withArgs(site.getOrganizationId()).resolves(org);
    context.dataAccess.Configuration.findLatest = sinon.stub().resolves(configuration);
    context.dataAccess.Audit.create.resolves({
      getId: () => 'some-audit-id',
    });
    context.sqs.sendMessage.resolves();

    nock(baseURL)
      .get('/')
      .reply(200);

    const fullAuditRef = 'hebele';
    const dummyRunner = (url, _context) => ({
      auditResult: typeof url === 'string' && typeof _context === 'object' ? { metric: 42 } : null,
      fullAuditRef,
    });

    // Act
    const audit = new AuditBuilder()
      .withSiteProvider(defaultSiteProvider)
      .withUrlResolver(defaultUrlResolver)
      .withRunner(dummyRunner)
      .withPersister(defaultPersister)
      .withMessageSender(defaultMessageSender)
      .build();

    const siteIdMessage = { siteId: message.url, type: message.type };
    const resp = await audit.run(siteIdMessage, context);

    // Assert
    expect(resp.status).to.equal(200);

    expect(context.dataAccess.Audit.create).to.have.been.calledOnce;
    expect(context.dataAccess.Audit.create).to.have.been.calledWith({
      siteId: site.getId(),
      isLive: site.getIsLive(),
      auditedAt: mockDate,
      auditType: message.type,
      auditResult: { metric: 42 },
      fullAuditRef,
    });

    expect(context.sqs.sendMessage).not.to.have.been.calledOnce;
  });

  it('wwwUrlResolver calculates audit urls correctly', async () => {
    expect(wwwUrlResolver({ getBaseURL: () => 'http://spacecat.com' })).to.equal('www.spacecat.com');
    expect(wwwUrlResolver({ getBaseURL: () => 'https://spacecat.com' })).to.equal('www.spacecat.com');
    expect(wwwUrlResolver({ getBaseURL: () => 'http://www.spacecat.com' })).to.equal('www.spacecat.com');
    expect(wwwUrlResolver({ getBaseURL: () => 'https://www.spacecat.com' })).to.equal('www.spacecat.com');
    expect(wwwUrlResolver({ getBaseURL: () => 'http://blog.spacecat.com' })).to.equal('blog.spacecat.com');
    expect(wwwUrlResolver({ getBaseURL: () => 'https://blog.spacecat.com' })).to.equal('blog.spacecat.com');
  });

  it('noop persister', async () => {
    const audit = await noopPersister({
      siteId: 'site-id',
      isLive: true,
      auditedAt: new Date().toISOString(),
      auditType: 'some-type',
      auditResult: { metric: 42 },
      fullAuditRef: 'hmm',
    });
    expect(hasText(audit.getId())).to.be.true;
  });

  /*
  add test for:
   // Abstract method that subclasses must implement
  // eslint-disable-next-line class-methods-use-this,@typescript-eslint/no-unused-vars
  async run(message, context) {
    throw new Error('Subclasses must implement run()');
  }
   */
  it('should throw error when run() is not implemented', async () => {
    class DummyAudit extends BaseAudit {
      constructor() {
        super(
          defaultSiteProvider,
          defaultOrgProvider,
          defaultUrlResolver,
          defaultPersister,
          defaultMessageSender,
          defaultPostProcessors,
        );
      }
    }

    const dummyAudit = new DummyAudit();
    await expect(dummyAudit.run(message, context)).to.be.rejectedWith('Subclasses must implement run()');
  });
});
