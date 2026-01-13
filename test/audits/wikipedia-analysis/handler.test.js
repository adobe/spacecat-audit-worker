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
import chaiAsPromised from 'chai-as-promised';
import wikipediaAnalysisHandler from '../../../src/wikipedia-analysis/handler.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Wikipedia Analysis Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockConfiguration;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockConfiguration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
      getHandlers: sandbox.stub().returns({}),
    };

    mockSite = {
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().returns(baseURL),
      getOrganizationId: sandbox.stub().returns('org-123'),
      getDeliveryType: sandbox.stub().returns('aem_edge'),
      getConfig: sandbox.stub().returns({
        getCompanyName: sandbox.stub().returns('Example Corp'),
        getWikipediaUrl: sandbox.stub().returns('https://en.wikipedia.org/wiki/Example_Corp'),
        getCompetitors: sandbox.stub().returns(['Competitor A', 'Competitor B']),
        getCompetitorRegion: sandbox.stub().returns('US'),
      }),
    };

    mockAudit = {
      getId: sandbox.stub().returns(auditId),
      getFullAuditRef: sandbox.stub().returns(`${baseURL}/audit-ref`),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        audit: mockAudit,
        finalUrl: baseURL,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves(mockSite),
          },
          Configuration: {
            findLatest: sandbox.stub().resolves(mockConfiguration),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Handler Export', () => {
    it('should export a valid audit handler', () => {
      expect(wikipediaAnalysisHandler).to.be.an('object');
      expect(wikipediaAnalysisHandler).to.have.property('runner');
      expect(wikipediaAnalysisHandler.runner).to.be.a('function');
    });

    it('should have URL resolver configured', () => {
      expect(wikipediaAnalysisHandler).to.have.property('urlResolver');
      expect(wikipediaAnalysisHandler.urlResolver).to.be.a('function');
    });

    it('should have post processors configured', () => {
      expect(wikipediaAnalysisHandler).to.have.property('postProcessors');
      expect(wikipediaAnalysisHandler.postProcessors).to.be.an('array');
      expect(wikipediaAnalysisHandler.postProcessors).to.have.lengthOf(1);
    });
  });

  describe('runWikipediaAnalysisAudit (via runner)', () => {
    it('should return pending_analysis status with config when company name is present', async () => {
      const result = await wikipediaAnalysisHandler.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.status).to.equal('pending_analysis');
      expect(result.auditResult.config).to.deep.include({
        companyName: 'Example Corp',
        companyWebsite: baseURL,
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Example_Corp',
      });
      expect(result.auditResult.config.competitors).to.deep.equal(['Competitor A', 'Competitor B']);
      expect(result.auditResult.config.competitorRegion).to.equal('US');
      expect(result.fullAuditRef).to.equal(baseURL);
    });

    it('should use baseURL even if it looks invalid', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(''),
        getWikipediaUrl: sandbox.stub().returns(''),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
      });
      mockSite.getBaseURL.returns('invalid-url');

      const result = await wikipediaAnalysisHandler.runner('invalid-url', context, mockSite);

      // Should succeed and use whatever baseURL is provided
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('invalid-url');
    });

    it('should return error when both company name and baseURL are empty', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(''),
        getWikipediaUrl: sandbox.stub().returns(''),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
      });
      mockSite.getBaseURL.returns('');

      const result = await wikipediaAnalysisHandler.runner('', context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('No company name configured for this site');
      expect(context.log.warn).to.have.been.called;
    });

    it('should use baseURL as companyName when company name is not configured', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(null),
        getWikipediaUrl: sandbox.stub().returns(''),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
      });
      mockSite.getBaseURL.returns('https://bmw.com');

      const result = await wikipediaAnalysisHandler.runner('https://bmw.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('https://bmw.com');
    });

    it('should handle missing config gracefully and use baseURL', async () => {
      mockSite.getConfig.returns(null);
      mockSite.getBaseURL.returns('https://test-company.com');

      const result = await wikipediaAnalysisHandler.runner('https://test-company.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('https://test-company.com');
    });

    it('should handle errors during execution', async () => {
      mockSite.getConfig.throws(new Error('Config error'));

      const result = await wikipediaAnalysisHandler.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Config error');
      expect(context.log.error).to.have.been.called;
    });
  });

  describe('Post Processor - sendMystiqueMessagePostProcessor', () => {
    it('should send message to Mystique queue when audit is successful', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: true,
          status: 'pending_analysis',
          config: {
            companyName: 'Example Corp',
            companyWebsite: baseURL,
            wikipediaUrl: 'https://en.wikipedia.org/wiki/Example_Corp',
            competitors: ['Competitor A'],
            competitorRegion: 'US',
          },
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique',
        sinon.match({
          type: 'guidance:wikipedia-analysis',
          siteId,
          url: baseURL,
          auditId,
          deliveryType: 'aem_edge',
          data: sinon.match({
            companyName: 'Example Corp',
            companyWebsite: baseURL,
          }),
        }),
      );
    });

    it('should skip sending message when audit failed', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: false,
          error: 'No company name configured',
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith('[Wikipedia] Audit failed, skipping Mystique message');
    });

    it('should skip sending message when SQS is not configured', async () => {
      context.sqs = null;

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[Wikipedia] SQS or Mystique queue not configured, skipping message');
    });

    it('should skip sending message when queue env is not set', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
    });

    it('should skip sending message when site not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const auditData = {
        siteId: 'non-existent-site',
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[Wikipedia] Site not found, skipping Mystique message');
    });

    it('should handle SQS send errors gracefully', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(context.log.error).to.have.been.calledWith('[Wikipedia] Failed to send Mystique message: SQS Error');
    });
  });
});
