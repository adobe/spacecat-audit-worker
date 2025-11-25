/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable */
/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';

import {
  runAuditAndImportTopPagesStep,
  sendToMystiqueForGeneration,
} from '../../../src/high-value-pages/handler.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

const AUDIT_TYPE = 'high-value-pages';

const sandbox = sinon.createSandbox();

const baseURL = 'https://example.com';
const site = {
  getBaseURL: () => baseURL,
  getId: () => 'site-id-1',
  getConfig: sinon.stub(),
  getDeliveryType: sinon.stub().returns('aem_edge'),
};

// Mock top pages data
const mockTopPages = [
  {
    getUrl: () => 'https://example.com/page1',
    getTraffic: () => 5000,
    getTopKeyword: () => 'keyword1',
  },
  {
    getUrl: () => 'https://example.com/page2',
    getTraffic: () => 3000,
    getTopKeyword: () => 'keyword2',
  },
  {
    getUrl: () => 'https://example.com/page3',
    getTraffic: () => 1500,
    getTopKeyword: () => 'keyword3',
  },
];

describe('High value pages audit', () => {
  let context;

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        site,
        finalUrl: 'www.example.com',
        log: {
          debug: sandbox.stub(),
          info: sandbox.stub(),
          error: sandbox.stub(),
          warn: sandbox.stub(),
        },
      })
      .build();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('runAuditAndImportTopPagesStep', () => {
    it('should run audit and import top pages', async () => {
      const result = await runAuditAndImportTopPagesStep(context);
      
      expect(result).to.have.property('type', 'top-pages');
      expect(result).to.have.property('siteId', site.getId());
      expect(result).to.have.property('fullAuditRef', 'www.example.com');
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.deep.equal({});
    });

    it('should return proper structure with empty auditResult', async () => {
      const result = await runAuditAndImportTopPagesStep(context);
      
      expect(result).to.deep.equal({
        auditResult: {},
        fullAuditRef: 'www.example.com',
        type: 'top-pages',
        siteId: 'site-id-1',
      });
    });
  });

  describe('sendToMystiqueForGeneration', () => {
    let mockConfiguration;
    let mockSiteTopPage;
    let mockSqs;
    let mockAudit;

    beforeEach(() => {
      // Mock Configuration
      mockConfiguration = {
        isHandlerEnabledForSite: sandbox.stub().returns(true),
      };

      // Mock SiteTopPage
      mockSiteTopPage = {
        allBySiteId: sandbox.stub().resolves(mockTopPages),
      };

      // Mock SQS
      mockSqs = {
        sendMessage: sandbox.stub().resolves({ MessageId: 'test-message-id' }),
      };

      // Mock Audit
      mockAudit = {
        getId: () => 'audit-id-1',
      };

      // Update context with mocks
      context.dataAccess = {
        Configuration: {
          findLatest: sandbox.stub().resolves(mockConfiguration),
        },
        SiteTopPage: mockSiteTopPage,
      };
      context.sqs = mockSqs;
      context.audit = mockAudit;
      context.env = {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url',
      };
    });

    it('should successfully send message to Mystique with all top pages when no existing high value pages', async () => {
      const result = await sendToMystiqueForGeneration(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(mockSiteTopPage.allBySiteId).to.have.been.calledOnceWith('site-id-1');
      expect(mockSqs.sendMessage).to.have.been.calledOnce;

      const messageArg = mockSqs.sendMessage.getCall(0).args[1];
      expect(messageArg).to.have.property('type', 'detect:high-value-pages');
      expect(messageArg).to.have.property('siteId', 'site-id-1');
      expect(messageArg).to.have.property('auditId', 'audit-id-1');
      expect(messageArg).to.have.property('deliveryType', 'aem_edge');
      expect(messageArg.data).to.have.property('site_url', 'www.example.com');
      expect(messageArg.data).to.have.property('top_pages').that.is.an('array').with.lengthOf(3);
      
      // Verify top pages format
      expect(messageArg.data.top_pages[0]).to.deep.equal({
        url: 'https://example.com/page1',
        traffic: 5000,
        topKeyword: 'keyword1',
      });
    });

    it('should send message when no top pages are found', async () => {
      mockSiteTopPage.allBySiteId.resolves([]);

      const result = await sendToMystiqueForGeneration(context);

      expect(result).to.deep.equal({ status: 'complete' });
      
      const messageArg = mockSqs.sendMessage.getCall(0).args[1];
      expect(messageArg.data.top_pages).to.be.an('array').that.is.empty;
      expect(messageArg.data.top_pages).to.be.an('array').that.is.empty;
    });

    it('should throw error when SQS message sending fails', async () => {
      mockSqs.sendMessage.rejects(new Error('SQS error'));

      await expect(sendToMystiqueForGeneration(context))
        .to.be.rejectedWith('SQS error');

      expect(mockSiteTopPage.allBySiteId).to.have.been.calledOnce;
      expect(context.log.info).to.not.have.been.called;
      expect(context.log.error).to.have.been.calledWith(
        sinon.match('Failed to send message to Mystique')
      );
    });

    it('should throw error when SiteTopPage fetch fails', async () => {
      mockSiteTopPage.allBySiteId.rejects(new Error('Database error'));

      await expect(sendToMystiqueForGeneration(context))
        .to.be.rejectedWith('Error occurred: Database error');

      expect(mockSqs.sendMessage).to.not.have.been.called;
      expect(context.log.error).to.have.been.calledWith(
        sinon.match('Error occurred')
      );
    });

    it('should correctly map top page fields to message format', async () => {
      const singlePage = [{
        getUrl: () => 'https://example.com/test',
        getTraffic: () => 9999,
        getTopKeyword: () => 'test-keyword',
      }];
      mockSiteTopPage.allBySiteId.resolves(singlePage);

      await sendToMystiqueForGeneration(context);

      const messageArg = mockSqs.sendMessage.getCall(0).args[1];
      expect(messageArg.data.top_pages).to.have.lengthOf(1);
      expect(messageArg.data.top_pages[0]).to.deep.equal({
        url: 'https://example.com/test',
        traffic: 9999,
        topKeyword: 'test-keyword',
      });
    });
  });
});