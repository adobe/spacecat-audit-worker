/*
 * Copyright 2023 Adobe. All rights reserved.
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
import { Audit } from '@adobe/spacecat-shared-data-access';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { collectCWVDataStep, opportunityAndSuggestions } from '../../src/cwv/handler.js';
import expectedOppty from '../fixtures/cwv/oppty.json' with { type: 'json' };
import expectedOpptyWithoutGSC from '../fixtures/cwv/opptyWithoutGSC.json' with { type: 'json' };
import suggestions from '../fixtures/cwv/suggestions.json' with { type: 'json' };
import rumData from '../fixtures/cwv/cwv.json' with { type: 'json' };

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

const baseURL = 'https://spacecat.com';
const auditUrl = 'www.spacecat.com';
const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  domain: auditUrl,
  interval: 7,
  granularity: 'hourly',
};

describe('collectCWVDataStep Tests', () => {
  const groupedURLs = [{ name: 'test', pattern: 'test/*' }];
  const siteConfig = {
    getGroupedURLs: sandbox.stub().returns(groupedURLs),
  };
  const site = {
    getId: () => 'test-site-id',
    getBaseURL: sandbox.stub().returns(baseURL),
    getConfig: () => siteConfig,
    getDeliveryType: sandbox.stub().returns('aem_cs'),
    getDeliveryConfig: sandbox.stub().returns({}),
    hasProductEntitlement: sandbox.stub().resolves(true),
    getCode: sandbox.stub().returns(null),
  };

  const context = {
    runtime: { name: 'aws-lambda', region: 'us-east-1' },
    func: { package: 'spacecat-services', version: 'ci', name: 'test' },
    rumApiClient: {
      query: sandbox.stub().resolves(rumData),
    },
    dataAccess: {
      Configuration: {
        findLatest: sandbox.stub().resolves({
          getHandlers: () => ({
            'cwv-auto-suggest': {
              productCodes: ['aem-sites'],
            },
          }),
          isHandlerEnabledForSite: () => true,
        }),
      },
    },
    env: {},
    log: {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
    },
  };

  beforeEach(() => {
    context.rumApiClient.query = sandbox.stub().resolves(rumData);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    site.getDeliveryConfig.reset();
  });

  it('cwv audit runs rum api client cwv query', async () => {
    site.getDeliveryConfig.returns({});
    const result = await collectCWVDataStep({ site, finalUrl: auditUrl, log: context.log, ...context });

    expect(siteConfig.getGroupedURLs.calledWith(Audit.AUDIT_TYPES.CWV)).to.be.true;
    expect(
      context.rumApiClient.query.calledWith(
        Audit.AUDIT_TYPES.CWV,
        {
          ...DOMAIN_REQUEST_DEFAULT_PARAMS,
          groupedURLs,
        },
      ),
    ).to.be.true;

    // With new logic: top 15 pages by pageviews are always included
    // rumData has 31 entries, top 15 will be selected (first 15 when sorted by pageviews desc)
    const sortedData = [...rumData].sort((a, b) => b.pageviews - a.pageviews);
    const expectedData = sortedData.slice(0, 15);

    expect(result.auditResult.cwv).to.have.lengthOf(15);
    expect(result.auditResult.cwv).to.deep.equal(expectedData);
    expect(result.auditResult.auditContext.interval).to.equal(7);
    expect(result.fullAuditRef).to.equal(auditUrl);
  });

  it('uses default values when delivery config is null', async () => {
    site.getDeliveryConfig.returns(null);

    const result = await collectCWVDataStep({ site, finalUrl: auditUrl, log: context.log, ...context });

    expect(context.rumApiClient.query).to.have.been.calledWith(
      Audit.AUDIT_TYPES.CWV,
      {
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        interval: 7,
        groupedURLs,
      },
    );

    // With default threshold (1000 * 7 = 7000), 4 entries meet threshold
    // But top 15 are always included, so result should have 15 entries
    const sortedData = [...rumData].sort((a, b) => b.pageviews - a.pageviews);
    const expectedData = sortedData.slice(0, 15);
    
    expect(result.auditResult.cwv).to.have.lengthOf(15);
    expect(result.auditResult.cwv).to.deep.equal(expectedData);
    expect(result.auditResult.auditContext.interval).to.equal(7);
  });

  it('includes pages beyond top 15 if they meet threshold', async () => {
    // With default threshold (1000 * 7 = 7000), check pages that meet threshold
    const result = await collectCWVDataStep({ site, finalUrl: auditUrl, log: context.log, ...context });

    // At least top 15 should be included
    expect(result.auditResult.cwv.length).to.be.at.least(15);
    
    // Verify sorted by pageviews descending
    for (let i = 1; i < result.auditResult.cwv.length; i++) {
      expect(result.auditResult.cwv[i - 1].pageviews).to.be.at.least(result.auditResult.cwv[i].pageviews);
    }
    
    // Verify that pages beyond top 15 meet the threshold
    if (result.auditResult.cwv.length > 15) {
      for (let i = 15; i < result.auditResult.cwv.length; i++) {
        expect(result.auditResult.cwv[i].pageviews).to.be.at.least(7000);
      }
    }
  });

  it('adds pages to threshold group beyond top 15', async () => {
    // Create custom data: 15 pages with high pageviews + 3 pages with threshold pageviews
    const customData = [
      // Top 15 pages (pageviews 20000-10000)
      ...Array.from({ length: 15 }, (_, i) => ({
        type: 'url',
        url: `https://example.com/page${i}`,
        pageviews: 20000 - (i * 500),
        organic: 1000,
        metrics: [{
          deviceType: 'desktop',
          pageviews: 20000 - (i * 500),
          lcp: 2000,
          lcpCount: 1,
          cls: 0.1,
          clsCount: 1,
          inp: 200,
          inpCount: 1,
        }],
      })),
      // 3 more pages that meet threshold (7000+)
      {
        type: 'url',
        url: 'https://example.com/threshold1',
        pageviews: 8000,
        organic: 800,
        metrics: [{
          deviceType: 'mobile',
          pageviews: 8000,
          lcp: 2500,
          lcpCount: 1,
          cls: 0.15,
          clsCount: 1,
          inp: 250,
          inpCount: 1,
        }],
      },
      {
        type: 'url',
        url: 'https://example.com/threshold2',
        pageviews: 7500,
        organic: 750,
        metrics: [{
          deviceType: 'desktop',
          pageviews: 7500,
          lcp: 2200,
          lcpCount: 1,
          cls: 0.12,
          clsCount: 1,
          inp: 220,
          inpCount: 1,
        }],
      },
      {
        type: 'url',
        url: 'https://example.com/threshold3',
        pageviews: 7100,
        organic: 710,
        metrics: [{
          deviceType: 'mobile',
          pageviews: 7100,
          lcp: 2300,
          lcpCount: 1,
          cls: 0.13,
          clsCount: 1,
          inp: 230,
          inpCount: 1,
        }],
      },
    ];

    context.rumApiClient.query.resolves(customData);

    const result = await collectCWVDataStep({ site, finalUrl: auditUrl, log: context.log, ...context });

    // Should have 15 (top) + 3 (threshold) = 18 pages
    expect(result.auditResult.cwv).to.have.lengthOf(18);

    // Verify the last 3 are the threshold pages
    const thresholdPages = result.auditResult.cwv.slice(15);
    expect(thresholdPages).to.have.lengthOf(3);
    expect(thresholdPages[0].url).to.equal('https://example.com/threshold1');
    expect(thresholdPages[1].url).to.equal('https://example.com/threshold2');
    expect(thresholdPages[2].url).to.equal('https://example.com/threshold3');
  });

  it('always includes homepage even if not in top 15 or meeting threshold', async () => {
    // Add homepage to rumData with low pageviews (below default threshold 7000 and not in top 15)
    const homepageData = {
      type: 'url',
      url: baseURL,
      pageviews: 50, // Very low pageviews (below threshold and below top 15)
      organic: 10,
      metrics: [
        {
          deviceType: 'desktop',
          pageviews: 50,
          organic: 10,
          lcp: 2000,
          lcpCount: 1,
          cls: 0.01,
          clsCount: 1,
          inp: 100,
          inpCount: 1,
          ttfb: 500,
          ttfbCount: 1,
        },
      ],
    };

    const dataWithHomepage = [...rumData, homepageData];
    context.rumApiClient.query.resolves(dataWithHomepage);

    const result = await collectCWVDataStep({ site, finalUrl: auditUrl, log: context.log, ...context });

    // Should have top 15 + homepage (16 total)
    expect(result.auditResult.cwv).to.have.lengthOf(16);
    
    // Verify homepage is included
    const homepageInResult = result.auditResult.cwv.find((entry) => entry.url === baseURL);
    expect(homepageInResult).to.exist;
    expect(homepageInResult.pageviews).to.equal(50);
  });

  it('does not treat grouped URLs as homepage', async () => {
    const groupedData = {
      type: 'group', // Not 'url' - should not match homepage logic
      // url field is absent for grouped entries (they have pattern instead)
      pageviews: 50, // Low pageviews - not in top 15, below threshold
      organic: 10,
      metrics: [
        {
          deviceType: 'desktop',
          pageviews: 50,
          organic: 10,
          lcp: 2000,
          lcpCount: 1,
          cls: 0.01,
          clsCount: 1,
          inp: 100,
          inpCount: 1,
          ttfb: 500,
          ttfbCount: 1,
        },
      ],
    };

    const dataWithGrouped = [...rumData, groupedData];
    context.rumApiClient.query.resolves(dataWithGrouped);

    const result = await collectCWVDataStep({ site, finalUrl: auditUrl, log: context.log, ...context });
    // Should only have top 15 (grouped entry excluded: type !== 'url')
    expect(result.auditResult.cwv).to.have.lengthOf(15);
  });

  describe('CWV audit to oppty conversion', () => {
    let addSuggestionsResponse;
    let oppty;
    const opptyData = { 0: 'existed-data' };
    let auditData;

    beforeEach(() => {
      context.log = {
        debug: sandbox.stub(),
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };

      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub(),
        create: sandbox.stub(),
      };

      context.dataAccess.Suggestion = {
        bulkUpdateStatus: sandbox.stub(),
      };

      context.sqs = {
        sendMessage: sandbox.stub().resolves(),
      };

      context.env = {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      };
      
      // Mock TierClient for entitlement checks
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ entitlement: true }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      addSuggestionsResponse = {
        createdItems: [],
        errorItems: [],
      };

      oppty = {
        getType: () => Audit.AUDIT_TYPES.CWV,
        getId: () => 'oppty-id',
        getSiteId: () => 'site-id',
        getAuditId: () => 'audit-id',
        addSuggestions: sandbox.stub().resolves(addSuggestionsResponse),
        getSuggestions: sandbox.stub().resolves([]),
        setAuditId: sandbox.stub(),
        getData: sandbox.stub().returns(opptyData),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub().returnsThis(),
        siteId: 'site-id',
        auditId: 'audit-id',
        opportunityId: 'oppty-id',
      };

      auditData = {
        siteId: 'site-id',
        id: 'audit-id',
        isLive: true,
        auditedAt: new Date().toISOString(),
        auditType: Audit.AUDIT_TYPES.CWV,
        auditResult: {
          cwv: rumData.filter((data) => data.pageviews >= 7000),
          auditContext: {
            interval: 7,
          },
        },
        fullAuditRef: auditUrl,
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('creates a new opportunity object', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      expect(siteConfig.getGroupedURLs).to.have.been.calledWith(Audit.AUDIT_TYPES.CWV);

      expect(GoogleClient.createFrom).to.have.been.calledWith(context, auditUrl);
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);

      // make sure that newly oppty has all 4 new suggestions
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(4);
    });

    it('creating a new opportunity object fails', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.rejects(new Error('big error happened'));
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      await expect(opportunityAndSuggestions(auditUrl, auditData, context, site)).to.be.rejectedWith('big error happened');
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);
      expect(context.log.error).to.have.been.calledOnceWith('Failed to create new opportunity for siteId site-id and auditId audit-id: big error happened');

      // make sure that no new suggestions are added
      expect(oppty.addSuggestions).to.have.been.to.not.have.been.called;
    });

    it('updates the existing opportunity object', async () => {
      sinon.stub(GoogleClient, 'createFrom').resolves({});
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([oppty]);
      const existingSuggestions = suggestions.map((suggestion, index) => ({
        ...suggestion,
        opportunityId: oppty.getId(),
        getId: () => `sugg-${index}`,
        remove: sinon.stub(),
        save: sinon.stub(),
        getData: () => (suggestion.data),
        setData: sinon.stub(),
        getStatus: sinon.stub().returns('NEW'),
        setUpdatedBy: sinon.stub().returnsThis(),
      }));
      oppty.getSuggestions.resolves(existingSuggestions);

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      expect(siteConfig.getGroupedURLs).to.have.been.calledWith(Audit.AUDIT_TYPES.CWV);

      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(oppty.setAuditId).to.have.been.calledOnceWith('audit-id');
      expect(oppty.setData).to.have.been.calledOnceWith({ ...opptyData, ...expectedOppty.data });
      expect(oppty.save).to.have.been.calledOnce;

      // make sure that 1 old suggestion is removed
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been
        .calledOnceWith([existingSuggestions[0]], 'OUTDATED');

      // make sure that 1 existing suggestion is updated
      expect(existingSuggestions[1].setData).to.have.been.calledOnce;
      expect(existingSuggestions[1].setData.firstCall.args[0]).to.deep.equal(suggestions[1].data);
      expect(existingSuggestions[1].save).to.have.been.calledOnce;

      // make sure that 3 new suggestions are created
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(3);
    });

    it('creates a new opportunity object when GSC connection returns null', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);

      // Mock GoogleClient to return null/undefined
      sinon.stub(GoogleClient, 'createFrom').resolves(null);

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      expect(GoogleClient.createFrom).to.have.been.calledWith(context, auditUrl);
      expect(context.dataAccess.Opportunity.create)
        .to.have.been.calledOnceWith(expectedOpptyWithoutGSC);

      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(4);
    });

    it('creates a new opportunity object without GSC if not connected', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);

      sinon.stub(GoogleClient, 'createFrom').rejects(new Error('GSC not connected'));

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      expect(GoogleClient.createFrom).to.have.been.calledWith(context, auditUrl);
      expect(context.dataAccess.Opportunity.create)
        .to.have.been.calledOnceWith(expectedOpptyWithoutGSC);

      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(4);
    });

    it('calls sendSQSMessageForAutoSuggest when suggestions have no guidance', async () => {
      // Mock suggestions without guidance (empty issues array)
      const mockSuggestions = [
        { getId: () => 'sugg-1', getData: () => ({ type: 'url', url: 'test1', issues: [] }), getStatus: () => 'NEW' },
        { getId: () => 'sugg-2', getData: () => ({ type: 'url', url: 'test2', issues: [] }), getStatus: () => 'NEW' }
      ];
      
      // Setup opportunity with mock suggestions before the function call
      oppty.getSuggestions = sandbox.stub().resolves(mockSuggestions);
      
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      // Verify that SQS sendMessage was called twice (once per suggestion)
      expect(context.sqs.sendMessage).to.have.been.calledTwice;
      const message = context.sqs.sendMessage.firstCall.args[1];
      expect(message.type).to.equal('guidance:cwv-analysis');
      expect(message.siteId).to.equal('site-id');
    });

    it('does not call sendSQSMessageForAutoSuggest when all suggestions have guidance', async () => {
      // Mock suggestions with existing guidance
      const mockSuggestions = [
        {
          getId: () => 'sugg-1',
          getData: () => ({ 
            type: 'url', 
            url: 'test1',
            issues: [
              { type: 'lcp', value: '# LCP Optimization\n\nYour LCP is too slow...' }
            ]
          }),
          getStatus: () => 'NEW'
        }
      ];
      
      // Setup opportunity with mock suggestions before the function call
      oppty.getSuggestions = sandbox.stub().resolves(mockSuggestions);
      
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      // Verify that SQS sendMessage was NOT called
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('calls sendSQSMessageForAutoSuggest when some suggestions have guidance and some do not', async () => {
      // Mock mixed suggestions - some with guidance, some without
      const mockSuggestions = [
        {
          getId: () => 'sugg-1',
          getData: () => ({ 
            type: 'url', 
            url: 'test1',
            issues: [
              { type: 'lcp', value: '# LCP Optimization...' }
            ]
          }),
          getStatus: () => 'NEW'
        },
        {
          getId: () => 'sugg-2',
          getData: () => ({ 
            type: 'url', 
            url: 'test2',
            issues: [] // No guidance (empty issues array)
          }),
          getStatus: () => 'NEW'
        }
      ];
      
      // Setup opportunity with mock suggestions before the function call
      oppty.getSuggestions = sandbox.stub().resolves(mockSuggestions);
      
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      await opportunityAndSuggestions(auditUrl, auditData, context, site);

      // Verify that SQS sendMessage was called once (only for the suggestion without guidance)
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
    });
  });
});
