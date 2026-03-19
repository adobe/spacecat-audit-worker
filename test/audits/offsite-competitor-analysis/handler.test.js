/*
 * Copyright 2026 Adobe. All rights reserved.
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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Offsite Competitor Analysis Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockConfiguration;
  let handler;
  let mockReadConfig;

  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';
  const baseURL = 'https://example.com';

  const mockS3Config = {
    brands: {
      aliases: [
        { brand: 'Example', aliases: ['ExCo', 'Ex Corp'] },
        { brand: 'Example Alt', aliases: ['ExCo', 'Example Alternative'] },
      ],
    },
    competitors: {
      competitors: [
        { name: 'Rival Inc' },
        { name: 'Contender LLC' },
      ],
    },
  };

  const mockBrandProfile = {
    competitive_context: {
      industry: 'Technology',
      contrasting_brands: [
        { name: 'Contrast Corp' },
        { name: 'Rival Inc' },
      ],
      similar_brands: [
        { name: 'Similar Co' },
        { name: 'Contrast Corp' },
      ],
    },
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockReadConfig = sandbox.stub().resolves({
      exists: true,
      config: mockS3Config,
    });

    handler = await esmock('../../../src/offsite-competitor-analysis/handler.js', {
      '@adobe/spacecat-shared-utils': {
        llmoConfig: { readConfig: mockReadConfig },
      },
    });

    mockConfiguration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
      getHandlers: sandbox.stub().returns({}),
    };

    mockSite = {
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().returns(baseURL),
      getOrganizationId: sandbox.stub().returns('org-123'),
      getConfig: sandbox.stub().returns({
        getLlmoBrand: sandbox.stub().returns('Example Corp'),
        getBrandProfile: sandbox.stub().returns(mockBrandProfile),
      }),
    };

    mockAudit = {
      getId: sandbox.stub().returns(auditId),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        audit: mockAudit,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        },
        s3Client: { getObject: sandbox.stub() },
        dataAccess: {
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

  describe('Runner - offsiteCompetitorAnalysisRunner', () => {
    it('should extract and deduplicate all data from site config and S3', async () => {
      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.companyName).to.equal('Example Corp');
      expect(result.auditResult.companyWebsite).to.equal(baseURL);
      expect(result.auditResult.industry).to.equal('Technology');
      expect(result.fullAuditRef).to.equal(baseURL);

      expect(result.auditResult.competitors).to.have.lengthOf(4);
      expect(result.auditResult.competitors).to.include.members([
        'Contrast Corp', 'Rival Inc', 'Similar Co', 'Contender LLC',
      ]);

      expect(result.auditResult.aliases).to.have.lengthOf(3);
      expect(result.auditResult.aliases).to.include.members([
        'ExCo', 'Ex Corp', 'Example Alternative',
      ]);
    });

    it('should fall back to baseURL when getLlmoBrand is null or empty', async () => {
      for (const falsy of [null, '']) {
        mockSite.getConfig.returns({
          getLlmoBrand: sandbox.stub().returns(falsy),
          getBrandProfile: sandbox.stub().returns(null),
        });

        // eslint-disable-next-line no-await-in-loop
        const result = await handler.default.runner(baseURL, context, mockSite);
        expect(result.auditResult.companyName).to.equal(baseURL);
      }
    });

    it('should handle missing brand profile gracefully', async () => {
      mockSite.getConfig.returns({
        getLlmoBrand: sandbox.stub().returns('Brand'),
        getBrandProfile: sandbox.stub().returns(null),
      });

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.industry).to.be.null;
      expect(result.auditResult.competitors).to.deep.equal(['Rival Inc', 'Contender LLC']);
    });

    it('should handle missing site config gracefully', async () => {
      mockSite.getConfig.returns(null);

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.companyName).to.equal(baseURL);
      expect(result.auditResult.industry).to.be.null;
    });

    it('should handle S3 config read failure gracefully', async () => {
      mockReadConfig.rejects(new Error('S3 access denied'));

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to read S3 LLMO config/),
      );
      expect(result.auditResult.competitors).to.include.members([
        'Contrast Corp', 'Similar Co',
      ]);
      expect(result.auditResult.aliases).to.deep.equal([]);
    });

    it('should skip S3 read when s3Client or bucket is not available', async () => {
      context.s3Client = null;
      let result = await handler.default.runner(baseURL, context, mockSite);
      expect(result.auditResult.success).to.be.true;
      expect(mockReadConfig).to.not.have.been.called;
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/S3 client or bucket not configured/),
      );

      mockReadConfig.resetHistory();
      context.s3Client = { getObject: sandbox.stub() };
      context.env.S3_IMPORTER_BUCKET_NAME = undefined;
      result = await handler.default.runner(baseURL, context, mockSite);
      expect(result.auditResult.success).to.be.true;
      expect(mockReadConfig).to.not.have.been.called;
    });

    it('should call readConfig with correct parameters', async () => {
      await handler.default.runner(baseURL, context, mockSite);

      expect(mockReadConfig).to.have.been.calledWith(
        siteId,
        context.s3Client,
        { s3Bucket: 'test-bucket' },
      );
    });

    it('should handle empty competitor sources', async () => {
      mockSite.getConfig.returns({
        getLlmoBrand: sandbox.stub().returns('Brand'),
        getBrandProfile: sandbox.stub().returns({
          competitive_context: {
            industry: 'Tech',
            contrasting_brands: [],
            similar_brands: [],
          },
        }),
      });
      mockReadConfig.resolves({
        exists: true,
        config: { competitors: { competitors: [] } },
      });

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.competitors).to.deep.equal([]);
    });

    it('should handle null entries in competitor arrays', async () => {
      mockSite.getConfig.returns({
        getLlmoBrand: sandbox.stub().returns('Brand'),
        getBrandProfile: sandbox.stub().returns({
          competitive_context: {
            contrasting_brands: [null, { name: 'Valid' }, { wrongField: 'no name' }],
          },
        }),
      });
      mockReadConfig.resolves({ exists: true, config: {} });

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.competitors).to.deep.equal(['Valid']);
    });

    it('should handle null entries in aliases arrays', async () => {
      mockReadConfig.resolves({
        exists: true,
        config: {
          brands: {
            aliases: [null, { aliases: null }, { aliases: ['Alias1'] }],
          },
        },
      });

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.aliases).to.deep.equal(['Alias1']);
    });

    it('should return empty competitors and aliases when both brandProfile and s3Config are null', async () => {
      mockSite.getConfig.returns({
        getLlmoBrand: sandbox.stub().returns('Brand'),
        getBrandProfile: sandbox.stub().returns(null),
      });
      mockReadConfig.rejects(new Error('not found'));

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.competitors).to.deep.equal([]);
      expect(result.auditResult.aliases).to.deep.equal([]);
    });

    it('should handle sparse S3 config gracefully', async () => {
      mockReadConfig.resolves({ exists: false, config: undefined });
      let result = await handler.default.runner(baseURL, context, mockSite);
      expect(result.auditResult.aliases).to.deep.equal([]);
      expect(result.auditResult.competitors).to.include.members(['Contrast Corp', 'Similar Co']);

      mockReadConfig.resolves({ exists: true, config: { brands: {} } });
      result = await handler.default.runner(baseURL, context, mockSite);
      expect(result.auditResult.aliases).to.deep.equal([]);
    });

    it('should extract competitors only from brand profile when S3 has no competitors section', async () => {
      mockReadConfig.resolves({
        exists: true,
        config: { brands: { aliases: [] } },
      });

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.competitors).to.include.members(['Contrast Corp', 'Rival Inc', 'Similar Co']);
      expect(result.auditResult.competitors).to.not.include('Contender LLC');
    });

    it('should extract competitors only from S3 when brand profile has no competitive_context', async () => {
      mockSite.getConfig.returns({
        getLlmoBrand: sandbox.stub().returns('Brand'),
        getBrandProfile: sandbox.stub().returns({ main_profile: {} }),
      });

      const result = await handler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.competitors).to.deep.equal(['Rival Inc', 'Contender LLC']);
    });
  });

  describe('Post Processor - sendMystiqueMessagePostProcessor', () => {
    const makeAuditData = (overrides = {}) => ({
      siteId,
      auditResult: {
        success: true,
        companyName: 'Example Corp',
        companyWebsite: baseURL,
        industry: 'Technology',
        aliases: ['ExCo'],
        competitors: ['Rival Inc'],
        ...overrides,
      },
    });

    it('should send correct message to Mystique and return auditData', async () => {
      const auditData = makeAuditData();
      const postProcessor = handler.default.postProcessors[0];

      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique',
        sinon.match({
          type: 'guidance:offsite-competitor-analysis',
          siteId,
          auditId,
          data: sinon.match({
            companyName: 'Example Corp',
            companyWebsite: baseURL,
            aliases: ['ExCo'],
            competitors: ['Rival Inc'],
          }),
        }),
      );

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(new Date(sentMessage.time).toISOString()).to.equal(sentMessage.time);
    });

    it('should skip sending when audit failed', async () => {
      const auditData = makeAuditData({ success: false });
      const postProcessor = handler.default.postProcessors[0];

      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith(
        '[OffsiteCompetitorAnalysis] Audit failed, skipping Mystique message',
      );
    });

    it('should skip sending when SQS or queue env is missing', async () => {
      const postProcessor = handler.default.postProcessors[0];

      context.sqs = null;
      let result = await postProcessor(baseURL, makeAuditData(), context);
      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[OffsiteCompetitorAnalysis] SQS or Mystique queue not configured, skipping message',
      );

      context.sqs = { sendMessage: sandbox.stub().resolves() };
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;
      await postProcessor(baseURL, makeAuditData(), context);
      expect(context.sqs.sendMessage).to.not.have.been.called;

      context.env = undefined;
      result = await postProcessor(baseURL, makeAuditData(), context);
      expect(result.auditResult.success).to.be.true;
    });

    it('should throw when sqs.sendMessage fails', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS send failed'));
      const auditData = makeAuditData();
      const postProcessor = handler.default.postProcessors[0];

      await expect(postProcessor(baseURL, auditData, context))
        .to.be.rejectedWith('SQS send failed');
      expect(context.log.error).to.have.been.calledWith(
        '[OffsiteCompetitorAnalysis] Failed to send Mystique message: SQS send failed',
      );
    });

    it('should use the audit ID from context.audit', async () => {
      mockAudit.getId.returns('custom-audit-id');
      const postProcessor = handler.default.postProcessors[0];

      await postProcessor(baseURL, makeAuditData(), context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.auditId).to.equal('custom-audit-id');
    });
  });
});
