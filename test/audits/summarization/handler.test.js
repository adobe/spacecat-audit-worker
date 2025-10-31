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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  importTopPages,
  submitForScraping,
  sendToMystique,
} from '../../../src/summarization/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Summarization Handler', () => {
  let context;
  let sandbox;
  let site;
  let audit;
  let log;
  let sqs;
  let env;
  let dataAccess;
  const topPages = [
    { getUrl: () => 'https://adobe.com/page1' },
    { getUrl: () => 'https://adobe.com/page2' },
    { getUrl: () => 'https://adobe.com/page3' },
  ];

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
      getAuditResult: sandbox.stub(),
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
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
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
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('importTopPages', () => {
    it('should import top pages successfully', async () => {
      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'site-id-123',
        auditResult: {
          success: true,
          topPages: [
            'https://adobe.com/page1',
            'https://adobe.com/page2',
            'https://adobe.com/page3',
          ],
        },
        fullAuditRef: 'https://adobe.com',
      });
      expect(dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        'site-id-123',
        'ahrefs',
        'global',
      );
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Found 3 top pages for site site-id-123');
    });

    it('should handle when no top pages are found', async () => {
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'site-id-123',
        auditResult: {
          success: false,
          topPages: [],
        },
        fullAuditRef: 'https://adobe.com',
      });
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] No top pages found for site');
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(error);

      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'site-id-123',
        auditResult: {
          success: false,
          error: 'Database error',
          topPages: [],
        },
        fullAuditRef: 'https://adobe.com',
      });
      expect(log.error).to.have.been.calledWith(
        '[SUMMARIZATION] Failed to import top pages: Database error',
        error,
      );
    });
  });

  describe('submitForScraping', () => {
    it('should submit top pages for scraping successfully', async () => {
      audit.getAuditResult.returns({ success: true });

      const result = await submitForScraping(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://adobe.com/page1' },
          { url: 'https://adobe.com/page2' },
          { url: 'https://adobe.com/page3' },
        ],
        siteId: 'site-id-123',
        type: 'summarization',
      });
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Submitting 3 pages for scraping');
    });

    it('should limit to 100 pages when submitting for scraping', async () => {
      audit.getAuditResult.returns({ success: true });
      const manyPages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://adobe.com/page${i}`,
      }));
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);

      const result = await submitForScraping(context);

      expect(result.urls).to.have.lengthOf(100);
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Submitting 150 pages for scraping');
    });

    it('should throw error when audit failed', async () => {
      audit.getAuditResult.returns({ success: false });

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'Audit failed, skipping scraping',
      );
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] Audit failed, skipping scraping');
    });

    it('should throw error when no top pages to submit', async () => {
      audit.getAuditResult.returns({ success: true });
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'No top pages to submit for scraping',
      );
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] No top pages to submit for scraping');
    });
  });

  describe('sendToMystique', () => {
    beforeEach(() => {
      audit.getAuditResult.returns({ success: true });
    });

    it('should send message to Mystique successfully', async () => {
      const result = await sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(sqs.sendMessage).to.have.been.calledWithMatch('spacecat-to-mystique', {
        type: 'guidance:summarization',
        siteId: 'site-id-123',
        url: 'https://adobe.com',
        auditId: 'audit-id-456',
        deliveryType: 'aem',
        time: sinon.match.string,
        data: {
          pages: [
            { page_url: 'https://adobe.com/page1', keyword: '', questions: [] },
            { page_url: 'https://adobe.com/page2', keyword: '', questions: [] },
            { page_url: 'https://adobe.com/page3', keyword: '', questions: [] },
          ],
        },
      });
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Sent 3 pages to Mystique for site site-id-123',
      );
    });

    it('should limit to 100 pages when sending to Mystique', async () => {
      const manyPages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://adobe.com/page${i}`,
      }));
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);

      const result = await sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages).to.have.lengthOf(100);
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Sent 100 pages to Mystique for site site-id-123',
      );
    });

    it('should throw error when audit failed', async () => {
      audit.getAuditResult.returns({ success: false });

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'Audit failed, skipping Mystique message',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] Audit failed, skipping Mystique message',
      );
      expect(sqs.sendMessage).not.to.have.been.called;
    });

    it('should throw error when SQS is not configured', async () => {
      context.sqs = null;

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'SQS or Mystique queue not configured',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] SQS or Mystique queue not configured, skipping message',
      );
    });

    it('should throw error when queue is not configured', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'SQS or Mystique queue not configured',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] SQS or Mystique queue not configured, skipping message',
      );
    });

    it('should throw error when no top pages found', async () => {
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(sendToMystique(context)).to.be.rejectedWith('No top pages found');
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] No top pages found, skipping Mystique message',
      );
      expect(sqs.sendMessage).not.to.have.been.called;
    });

    it('should format page URLs correctly', async () => {
      await sendToMystique(context);

      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      sentMessage.data.pages.forEach((page) => {
        expect(page).to.have.all.keys('page_url', 'keyword', 'questions');
        expect(page.keyword).to.equal('');
        expect(page.questions).to.deep.equal([]);
        expect(page.page_url).to.be.a('string');
      });
    });
  });
});
