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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import wikipediaAnalysisHandler, { extractBrandFromUrl } from '../../../src/wikipedia-analysis/handler.js';
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

    it('should use baseURL as-is when it cannot be parsed as a URL', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(''),
        getWikipediaUrl: sandbox.stub().returns(''),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
      });
      mockSite.getBaseURL.returns('invalid-url');

      const result = await wikipediaAnalysisHandler.runner('invalid-url', context, mockSite);

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

    it('should extract brand from URL when company name is not configured', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(null),
        getWikipediaUrl: sandbox.stub().returns(''),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
      });
      mockSite.getBaseURL.returns('https://bmw.com');

      const result = await wikipediaAnalysisHandler.runner('https://bmw.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('bmw');
    });

    it('should handle missing config gracefully and extract brand from URL', async () => {
      mockSite.getConfig.returns(null);
      mockSite.getBaseURL.returns('https://test-company.com');

      const result = await wikipediaAnalysisHandler.runner('https://test-company.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('test-company');
    });

    it('should extract brand from subdomain URL when company name is not configured', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(null),
        getWikipediaUrl: sandbox.stub().returns(''),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
      });
      mockSite.getBaseURL.returns('https://corporate.walmart.com');

      const result = await wikipediaAnalysisHandler.runner('https://corporate.walmart.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('walmart');
    });

    it('should handle errors during execution', async () => {
      mockSite.getConfig.throws(new Error('Config error'));

      const result = await wikipediaAnalysisHandler.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Config error');
      expect(context.log.error).to.have.been.called;
    });

    it('should override wikipediaUrl from auditContext.messageData.wikiUrl', async () => {
      const override = 'https://en.wikipedia.org/wiki/Override_Article';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: override } },
      );

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.wikipediaUrl).to.equal(override);
      expect(context.log.info).to.have.been.calledWith(
        `[Wikipedia] Using Wikipedia URL override from audit message: ${override}`,
      );
    });

    it('should unwrap Slack mrkdwn wikiUrl <url> from messageData', async () => {
      const override = 'https://en.wikipedia.org/wiki/Slack_Wrapped';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: `  <${override}>  ` } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(override);
    });

    it('should unwrap Slack mrkdwn <url|label> from messageData', async () => {
      const override = 'https://en.wikipedia.org/wiki/Labeled';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikipediaUrl: `<${override}|Wikipedia page>` } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(override);
    });

    it('should unwrap outer ASCII double quotes around wikiUrl', async () => {
      const override = 'https://en.wikipedia.org/wiki/Quoted_Wrap';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: `  "${override}"  ` } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(override);
    });

    it('should unwrap outer escaped double quotes (\\") around wikiUrl', async () => {
      const override = 'https://en.wikipedia.org/wiki/Escaped_Quote_Wrap';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: `\\"${override}\\"` } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(override);
    });

    it('should unwrap quotes outside Slack mrkdwn link', async () => {
      const override = 'https://en.wikipedia.org/wiki/Both_Wrappers';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: `"<${override}|label>"` } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(override);
    });

    it('should reject Slack-style empty brackets for wikiUrl', async () => {
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: '<>' } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/Example_Corp');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/after Slack\/mrkdwn normalization/),
      );
    });

    it('should use wikipediaUrl from messageData when wikiUrl is absent', async () => {
      const override = 'https://en.wikipedia.org/wiki/Other';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikipediaUrl: override } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(override);
    });

    it('should prefer wikiUrl over wikipediaUrl in messageData', async () => {
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        {
          messageData: {
            wikiUrl: 'https://en.wikipedia.org/wiki/First',
            wikipediaUrl: 'https://en.wikipedia.org/wiki/Second',
          },
        },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/First');
    });

    it('should not use top-level wikiUrl without messageData (Slack/API use message.data only)', async () => {
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { urlLimit: 10 }, wikiUrl: 'https://en.wikipedia.org/wiki/Top' },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/Example_Corp');
    });

    it('should ignore invalid override and keep site config', async () => {
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: 'not-a-valid-url' } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/Example_Corp');
      expect(context.log.warn).to.have.been.calledWith(
        '[Wikipedia] Ignoring invalid wikipedia URL override: not-a-valid-url',
      );
    });

    it('should trim wikiUrl override', async () => {
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: '  https://en.wikipedia.org/wiki/Trimmed  ' } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/Trimmed');
    });

    it('should treat null auditContext like no override', async () => {
      const result = await wikipediaAnalysisHandler.runner(baseURL, context, mockSite, null);

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/Example_Corp');
    });

    it('should ignore whitespace-only override', async () => {
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: '   ' } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/Example_Corp');
    });

    it('should ignore non-string wikiUrl in messageData', async () => {
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: 12345 } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal('https://en.wikipedia.org/wiki/Example_Corp');
    });

    it('should use wikipediaUrl when wikiUrl is null in messageData', async () => {
      const fallback = 'https://en.wikipedia.org/wiki/Fallback_From_Null_Wiki';
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: null, wikipediaUrl: fallback } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(fallback);
    });

    it('should accept a long valid wikiUrl override and log messageData fields', async () => {
      const path = `https://en.wikipedia.org/wiki/${'x'.repeat(100)}`;
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { wikiUrl: path } },
      );

      expect(result.auditResult.config.wikipediaUrl).to.equal(path);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(
          (msg) => typeof msg === 'string'
            && msg.includes('Wikipedia URL override: messageData fields wikiUrl=')
            && msg.includes(path)
            && msg.includes('wikipediaUrl='),
        ),
      );
    });

    it('should include slackContext in auditResult when provided in auditContext', async () => {
      const slackContext = { channelId: 'C-test', threadTs: '1700000000.123456' };
      const result = await wikipediaAnalysisHandler.runner(
        baseURL,
        context,
        mockSite,
        { slackContext },
      );

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.slackContext).to.deep.equal(slackContext);
    });

    it('should not include slackContext in auditResult when not provided', async () => {
      const result = await wikipediaAnalysisHandler.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.slackContext).to.be.undefined;
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
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Queued Wikipedia analysis request to Mystique for companyName=Example Corp wikipediaUrl=https:\/\/en\.wikipedia\.org\/wiki\/Example_Corp/),
      );
    });

    it('should log auto-detect when wikipediaUrl is blank in queued Mystique log', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: true,
          status: 'pending_analysis',
          config: {
            companyName: 'Example Corp',
            companyWebsite: baseURL,
            wikipediaUrl: '   ',
            competitors: [],
            competitorRegion: null,
          },
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/wikipediaUrl=\(empty → auto-detect\)/),
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

    it('should throw error when SQS send fails', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
        },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('SQS Error');
      expect(context.log.error).to.have.been.calledWith('[Wikipedia] Failed to send Mystique message: SQS Error');
    });

    // Helper: fresh PostgREST chain mock — limit() is the terminal call (org, status, site_id, order, limit)
    function makeQueryChain(data) {
      return {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        order: sandbox.stub().returnsThis(),
        limit: sandbox.stub().resolves({ data, error: null }),
      };
    }

    const wikiConfig = {
      companyName: 'Example Corp',
      companyWebsite: baseURL,
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Example_Corp',
      competitors: [],
      competitorRegion: null,
    };

    it('should include scope fields when brand is resolved via brand_sites join', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub()
            .onFirstCall().returns(makeQueryChain([]))
            .onSecondCall().returns(makeQueryChain([{ id: 'brand-1' }])),
        },
      };

      const auditData = {
        siteId,
        auditResult: { success: true, status: 'pending_analysis', config: wikiConfig },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.scopeType).to.equal('brand');
      expect(sentMessage.brandId).to.equal('brand-1');
      expect(sentMessage.siteId).to.equal(siteId);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/brandId=brand-1/).and(sinon.match((v) => !/siteId=/.test(v))),
      );
    });

    it('should include scope fields when brand is resolved via direct baseSiteId match', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub().returns(makeQueryChain([{ id: 'brand-8' }])),
        },
      };

      const auditData = {
        siteId,
        auditResult: { success: true, status: 'pending_analysis', config: wikiConfig },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.scopeType).to.equal('brand');
      expect(sentMessage.brandId).to.equal('brand-8');
      expect(sentMessage.siteId).to.equal(siteId);
    });

    it('should omit scope fields and preserve siteId when no brand is resolved', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub()
            .onFirstCall().returns(makeQueryChain([]))
            .onSecondCall().returns(makeQueryChain([])),
        },
      };

      const auditData = {
        siteId,
        auditResult: { success: true, status: 'pending_analysis', config: wikiConfig },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage).to.not.have.property('scopeType');
      expect(sentMessage).to.not.have.property('brandId');
      expect(sentMessage.siteId).to.equal(siteId);
    });

    it('should still send message without scope if brand resolution throws unexpectedly', async () => {
      const faultySite = {
        getId: sandbox.stub().returns(siteId),
        getBaseURL: sandbox.stub().returns(baseURL),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
        getOrganizationId: sandbox.stub().throws(new Error('getter failed')),
      };
      context.dataAccess.Site.findById.resolves(faultySite);

      const auditData = {
        siteId,
        auditResult: { success: true, status: 'pending_analysis', config: wikiConfig },
      };

      const postProcessor = wikipediaAnalysisHandler.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage).to.not.have.property('scopeType');
      expect(sentMessage).to.not.have.property('brandId');
      expect(sentMessage.siteId).to.equal(siteId);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Brand resolution failed unexpectedly/),
      );
    });
  });

  describe('extractBrandFromUrl', () => {
    it('should strip protocol, www, and TLD from a full URL', () => {
      expect(extractBrandFromUrl('https://www.landroverusa.com')).to.equal('landrover');
    });

    it('should strip TLD from a bare domain', () => {
      expect(extractBrandFromUrl('allianz.fr')).to.equal('allianz');
    });

    it('should strip regional suffix "usa"', () => {
      expect(extractBrandFromUrl('https://www.landroverusa.com')).to.equal('landrover');
    });

    it('should strip regional suffix "global"', () => {
      expect(extractBrandFromUrl('https://www.toyotaglobal.com')).to.equal('toyota');
    });

    it('should strip regional suffix "international"', () => {
      expect(extractBrandFromUrl('https://brandinternational.com')).to.equal('brand');
    });

    it('should strip regional suffix "worldwide"', () => {
      expect(extractBrandFromUrl('https://brandworldwide.com')).to.equal('brand');
    });

    it('should strip country code suffixes', () => {
      expect(extractBrandFromUrl('https://www.branduk.com')).to.equal('brand');
      expect(extractBrandFromUrl('https://www.brandfr.com')).to.equal('brand');
      expect(extractBrandFromUrl('https://www.brandde.com')).to.equal('brand');
      expect(extractBrandFromUrl('https://www.brandau.com')).to.equal('brand');
      expect(extractBrandFromUrl('https://www.brandca.com')).to.equal('brand');
      expect(extractBrandFromUrl('https://www.brandjp.com')).to.equal('brand');
    });

    it('should preserve hyphens in brand names', () => {
      expect(extractBrandFromUrl('https://www.mercedes-benz.ca')).to.equal('mercedes-benz');
    });

    it('should handle ccTLD-only domains', () => {
      expect(extractBrandFromUrl('https://www.bmw.de')).to.equal('bmw');
      expect(extractBrandFromUrl('https://allianz.fr')).to.equal('allianz');
    });

    it('should handle multi-part TLDs like .co.uk', () => {
      expect(extractBrandFromUrl('https://www.brand.co.uk')).to.equal('brand');
    });

    it('should handle simple .com domains', () => {
      expect(extractBrandFromUrl('https://nespresso.com')).to.equal('nespresso');
      expect(extractBrandFromUrl('https://www.salesforce.com')).to.equal('salesforce');
    });

    it('should handle plain brand names as input', () => {
      expect(extractBrandFromUrl('Nespresso')).to.equal('nespresso');
      expect(extractBrandFromUrl('toyota')).to.equal('toyota');
    });

    it('should return original string for unparseable input', () => {
      expect(extractBrandFromUrl('')).to.equal('');
    });

    it('should handle domains without www', () => {
      expect(extractBrandFromUrl('https://landroverusa.com')).to.equal('landrover');
    });

    it('should handle domain-only input without protocol', () => {
      expect(extractBrandFromUrl('landroverusa.com')).to.equal('landrover');
    });

    it('should keep the full name when stripping the region suffix would leave nothing', () => {
      expect(extractBrandFromUrl('https://usa.com')).to.equal('usa');
    });

    it('should be case-insensitive for region suffixes', () => {
      expect(extractBrandFromUrl('https://www.brandUSA.com')).to.equal('brand');
      expect(extractBrandFromUrl('https://www.brandGlobal.com')).to.equal('brand');
    });

    it('should extract brand from subdomain URLs instead of subdomain name', () => {
      expect(extractBrandFromUrl('https://corporate.walmart.com')).to.equal('walmart');
      expect(extractBrandFromUrl('https://blog.google.com')).to.equal('google');
      expect(extractBrandFromUrl('https://investor.apple.com')).to.equal('apple');
      expect(extractBrandFromUrl('https://ir.company.com')).to.equal('company');
      expect(extractBrandFromUrl('https://news.example.com')).to.equal('example');
      expect(extractBrandFromUrl('https://shop.nespresso.com')).to.equal('nespresso');
      expect(extractBrandFromUrl('https://press.bmw.de')).to.equal('bmw');
    });

    it('should extract brand from subdomain URLs with regional suffixes', () => {
      expect(extractBrandFromUrl('https://corporate.landroverusa.com')).to.equal('landrover');
      expect(extractBrandFromUrl('https://news.toyotaglobal.com')).to.equal('toyota');
    });

    it('should extract brand from subdomain URLs with multi-part TLDs', () => {
      expect(extractBrandFromUrl('https://shop.brand.co.uk')).to.equal('brand');
      expect(extractBrandFromUrl('https://investor.company.com.au')).to.equal('company');
      expect(extractBrandFromUrl('https://news.brand.co.jp')).to.equal('brand');
    });

    it('should handle deeply nested subdomains by extracting the SLD', () => {
      expect(extractBrandFromUrl('https://a.b.walmart.com')).to.equal('walmart');
      expect(extractBrandFromUrl('https://dev.blog.google.com')).to.equal('google');
    });
  });
});
