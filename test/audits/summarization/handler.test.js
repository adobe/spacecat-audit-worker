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

/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { summarizationAudit, sendMystiqueMessagePostProcessor } from '../../../src/summarization/handler.js';

use(sinonChai);

describe('Summarization Handler', () => {
  let context;
  let sandbox;
  let site;
  let audit;
  let log;
  let sqs;
  let env;
  let dataAccess;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    site = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-id-123',
      getDeliveryType: () => 'aem',
    };

    audit = {
      getId: () => 'audit-id-456',
      getAuditType: () => 'summarization',
      getFullAuditRef: () => 'https://adobe.com',
    };

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    sqs = {
      sendMessage: sandbox.stub().resolves({}),
    };

    env = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
    };

    dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sandbox.stub(),
      },
      Site: {
        findById: sandbox.stub(),
      },
    };

    context = {
      log,
      sqs,
      env,
      site,
      audit,
      dataAccess,
    };

    // Functions are imported directly, no need for esmock
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('summarizationAudit', () => {
    it('should return audit result with top pages when pages are found', async () => {
      const mockTopPages = [
        { getUrl: () => 'https://adobe.com/page1' },
        { getUrl: () => 'https://adobe.com/page2' },
        { getUrl: () => 'https://adobe.com/page3' },
      ];

      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);

      const result = await summarizationAudit('https://adobe.com', context, site);

      expect(result).to.deep.equal({
        auditResult: {
          topPages: ['https://adobe.com/page1', 'https://adobe.com/page2', 'https://adobe.com/page3'],
          success: true,
        },
        fullAuditRef: 'https://adobe.com',
      });

      expect(dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        site.getId(),
        'ahrefs',
        'global',
      );
    });

    it('should throw error when no top pages are found', async () => {
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      try {
        await summarizationAudit('https://adobe.com', context, site);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.equal('No top pages found for site');
      }

      expect(dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        site.getId(),
        'ahrefs',
        'global',
      );
    });

    it('should handle single top page', async () => {
      const mockTopPages = [
        { getUrl: () => 'https://adobe.com/single-page' },
      ];

      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);

      const result = await summarizationAudit('https://adobe.com', context, site);

      expect(result).to.deep.equal({
        auditResult: {
          topPages: ['https://adobe.com/single-page'],
          success: true,
        },
        fullAuditRef: 'https://adobe.com',
      });
    });
  });

  describe('sendMystiqueMessagePostProcessor', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        siteId: site.getId(),
        auditResult: {
          success: true,
          topPages: [
            'https://adobe.com/page1',
            'https://adobe.com/page2',
            'https://adobe.com/page3',
          ],
        },
      };

      // Mock Site.findById to return the site
      dataAccess.Site.findById.resolves(site);
    });

    it('should send message to Mystique when audit is successful', async () => {
      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [queue, message] = sqs.sendMessage.firstCall.args;

      expect(queue).to.equal(env.QUEUE_SPACECAT_TO_MYSTIQUE);
      expect(message).to.include({
        type: 'guidance:summarization',
        siteId: site.getId(),
        url: site.getBaseURL(),
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
      });
      expect(message.data).to.have.property('pages');
      expect(message.data.pages).to.have.length(3); // All pages included
      expect(result).to.equal(auditData);
    });

    it('should skip sending message when audit failed', async () => {
      auditData.auditResult.success = false;

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('Audit failed, skipping Mystique message');
      expect(result).to.equal(auditData);
    });

    it('should skip sending message when no top pages found', async () => {
      auditData.auditResult.topPages = [];

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('No top pages found, skipping Mystique message');
      expect(result).to.equal(auditData);
    });

    it('should skip sending message when SQS is not configured', async () => {
      context.sqs = null;

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(log.warn).to.have.been.calledWith('SQS or Mystique queue not configured, skipping message');
      expect(result).to.equal(auditData);
    });

    it('should skip sending message when queue environment variable is not set', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(log.warn).to.have.been.calledWith('SQS or Mystique queue not configured, skipping message');
      expect(result).to.equal(auditData);
    });

    it('should limit pages to 10 when more than 10 pages are available', async () => {
      auditData.auditResult.topPages = Array.from({ length: 25 }, (_, i) => `https://adobe.com/page${i + 1}`);

      await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [, message] = sqs.sendMessage.firstCall.args;
      expect(message.data.pages).to.have.length(10);
      expect(message.data.pages[0]).to.deep.equal({ page_url: 'https://adobe.com/page1', keyword: '', questions: [] });
      expect(message.data.pages[9]).to.deep.equal({ page_url: 'https://adobe.com/page10', keyword: '', questions: [] });
    });

    it('should handle exactly 10 pages', async () => {
      auditData.auditResult.topPages = Array.from({ length: 10 }, (_, i) => `https://adobe.com/page${i + 1}`);

      await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [, message] = sqs.sendMessage.firstCall.args;
      expect(message.data.pages).to.have.length(10);
    });

    it('should handle fewer than 10 pages', async () => {
      auditData.auditResult.topPages = [
        'https://adobe.com/page1',
        'https://adobe.com/page2',
      ];

      await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [, message] = sqs.sendMessage.firstCall.args;
      expect(message.data.pages).to.have.length(2);
      expect(message.data.pages).to.deep.equal([
        { page_url: 'https://adobe.com/page1', keyword: '', questions: [] },
        { page_url: 'https://adobe.com/page2', keyword: '', questions: [] },
      ]);
    });

    it('should log successful message sending', async () => {
      await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(log.info).to.have.been.calledWith(
        'SUMMARIZATION: %s Message sent to Mystique for site id %s:',
        'summarization',
        site.getId(),
      );
    });

    it('should handle SQS sendMessage failure', async () => {
      const error = new Error('SQS send failed');
      sqs.sendMessage.rejects(error);

      try {
        await sendMystiqueMessagePostProcessor('https://adobe.com', auditData, context);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('SQS send failed');
      }

      expect(sqs.sendMessage).to.have.been.calledOnce;
    });

    it('should skip sending message when site is not found', async () => {
      // Mock Site.findById to return null (site not found)
      dataAccess.Site.findById.resolves(null);

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.equal(auditData);
      expect(log.warn).to.have.been.calledWith('Site not found, skipping Mystique message');
      expect(sqs.sendMessage).not.to.have.been.called;
    });
  });
});
