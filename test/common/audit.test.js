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
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import {
  defaultMessageSender,
  defaultPersister,
  defaultSiteProvider,
  defaultUrlResolver, noopUrlResolver,
} from '../../src/common/audit.js';
import { AuditBuilder } from '../../src/common/audit-builder.js';
import { MockContextBuilder } from '../shared.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

const baseURL = 'https://space.cat';
const message = {
  type: 'dummy',
  url: 'site-id',
  auditContext: { someField: 431 },
};
const mockDate = '2023-03-12T15:24:51.231Z';
const site = createSite({ baseURL });
const sandbox = sinon.createSandbox();
describe('Audit tests', () => {
  let context;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(message);
  });

  before('setup', function () {
    this.clock = sandbox.useFakeTimers({
      now: new Date(mockDate).getTime(),
    });
  });

  after('clean', function () {
    this.clock.uninstall();
  });

  describe('default components', () => {
    it('default site provider throws error when site is not found', async () => {
      context.dataAccess.getSiteByID.withArgs(message.url).resolves(null);

      await expect(defaultSiteProvider(message.url, context))
        .to.be.rejectedWith(`Site with id ${message.url} not found`);
    });

    it('default site provider returns site', async () => {
      context.dataAccess.getSiteByID.withArgs(message.url).resolves(site);

      const result = await defaultSiteProvider(message.url, context);
      expect(result.getBaseURL()).to.equal(baseURL);

      expect(context.dataAccess.getSiteByID).to.have.been.calledOnce;
    });

    it('default persister saves the audit result to data access', async () => {
      context.dataAccess.addAudit.resolves();
      const auditData = { result: 'hebele' };

      await defaultPersister(auditData, context);

      expect(context.dataAccess.addAudit).to.have.been.calledOnce;
      expect(context.dataAccess.addAudit).to.have.been.calledWith(auditData);
    });

    it('default message sender sends the audit to sqs', async () => {
      const queueUrl = 'some-queue-url';
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.sqs.sendMessage.resolves();

      const resultMessage = { result: 'hebele' };

      await defaultMessageSender(resultMessage, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(queueUrl, resultMessage);
    });

    it('default url resolves gets the base url and follows redirects', async () => {
      const finalUrl = 'www.space.cat';

      nock(baseURL)
        .get('/')
        .reply(301, undefined, { Location: `https://${finalUrl}/` });

      nock('https://www.space.cat')
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
      expect(() => new AuditBuilder().build()).to.throw('"runner" must be a function');
    });

    it('audit run fails when error', async () => {
      const audit = new AuditBuilder()
        .withRunner(() => 123)
        .build();

      await expect(audit.run(message, context))
        .to.be.rejectedWith(`${message.type} audit failed for site ${message.url}. Reason: Site with id ${message.url} not found`);
    });

    it('audit runs as expected', async () => {
      const queueUrl = 'some-queue-url';
      context.env = { AUDIT_RESULTS_QUEUE_URL: queueUrl };
      context.dataAccess.getSiteByID.withArgs(message.url).resolves(site);
      context.dataAccess.addAudit.resolves();
      context.sqs.sendMessage.resolves();

      nock(baseURL)
        .get('/')
        .reply(200);

      const fullAuditRef = 'hebele';
      const dummyRunner = (url, _context) => ({
        auditResult: typeof url === 'string' && typeof _context === 'object' ? 42 : null,
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

      await audit.run(message, context);

      // Assert
      expect(context.dataAccess.addAudit).to.have.been.calledOnce;
      expect(context.dataAccess.addAudit).to.have.been.calledWith({
        siteId: site.getId(),
        isLive: site.isLive(),
        auditedAt: mockDate,
        auditType: message.type,
        auditResult: 42,
        fullAuditRef,
      });

      const expectedMessage = {
        type: message.type,
        url: 'https://space.cat',
        auditContext: { someField: 431, finalUrl: 'space.cat' },
        auditResult: 42,
      };
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(queueUrl, expectedMessage);
    });
  });
});
