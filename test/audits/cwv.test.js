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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { Audit } from '@adobe/spacecat-shared-data-access';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { collectCWVDataAndImportCode, syncOpportunityAndSuggestionsStep } from '../../src/cwv/handler.js';
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

describe('collectCWVDataAndImportCode Tests', () => {
  const groupedURLs = [{ name: 'test', pattern: 'test/*' }];
  const siteConfig = {
    getGroupedURLs: sandbox.stub().returns(groupedURLs),
  };
  const site = {
    getId: () => 'site-id',
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
          isHandlerEnabledForSite: (handler) => handler !== 'summit-plg',
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
    const result = await collectCWVDataAndImportCode({ site, finalUrl: auditUrl, log: context.log, ...context });

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

    const result = await collectCWVDataAndImportCode({ site, finalUrl: auditUrl, log: context.log, ...context });

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
    const result = await collectCWVDataAndImportCode({ site, finalUrl: auditUrl, log: context.log, ...context });

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

    const result = await collectCWVDataAndImportCode({ site, finalUrl: auditUrl, log: context.log, ...context });

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

    const result = await collectCWVDataAndImportCode({ site, finalUrl: auditUrl, log: context.log, ...context });

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

    const result = await collectCWVDataAndImportCode({ site, finalUrl: auditUrl, log: context.log, ...context });
    // Should only have top 15 (grouped entry excluded: type !== 'url')
    expect(result.auditResult.cwv).to.have.lengthOf(15);
  });

  describe('CWV audit to oppty conversion', () => {
    let addSuggestionsResponse;
    let oppty;
    const opptyData = { 0: 'existed-data' };
    let auditData;
    let mockAudit;

    beforeEach(() => {
      context.log = {
        debug: sandbox.stub(),
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };

      context.dataAccess.Configuration = {
        findLatest: sandbox.stub().resolves({
          getHandlers: () => ({
            'cwv-auto-suggest': {
              productCodes: ['aem-sites'],
            },
          }),
          isHandlerEnabledForSite: (handler) => handler !== 'summit-plg',
        }),
      };

      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: sandbox.stub(),
        create: sandbox.stub(),
      };

      context.dataAccess.Suggestion = {
        bulkUpdateStatus: sandbox.stub(),
        saveMany: sinon.stub().resolves(),
      };

      context.sqs = {
        sendMessage: sandbox.stub().resolves(),
      };

      context.env = {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      };
      
      // Mock TierClient for entitlement checks
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: {} }),
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
        setLastAuditedAt: sandbox.stub(),
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

      // Mock audit object for syncOpportunityAndSuggestionsStep
      mockAudit = {
        getSiteId: () => 'site-id',
        getId: () => 'audit-id',
        getAuditType: () => Audit.AUDIT_TYPES.CWV,
        getAuditResult: () => auditData.auditResult,
        getFullAuditRef: () => auditUrl,
        getAuditedAt: () => '2023-11-27T12:34:56.789Z',
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('creates a new opportunity object', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      const stepContext = { ...context, site, audit: mockAudit, finalUrl: auditUrl };
      await syncOpportunityAndSuggestionsStep(stepContext);

      expect(siteConfig.getGroupedURLs).to.have.been.calledWith(Audit.AUDIT_TYPES.CWV);

      expect(GoogleClient.createFrom).to.have.been.calledWith(stepContext, auditUrl);
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);

      // make sure that newly oppty has 2 new suggestions (only failing-metric pages)
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(2);
      // CWV suggestions include jiraLink (null until user saves URL in UI; schema
      // rejects empty string so we default to null).
      suggestionsArg.forEach((s) => expect(s.data).to.have.property('jiraLink', null));
    });

    it('handles audit result with only group entries for maxConfidenceForUrls coverage', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      const auditResultWithGroupsOnly = {
        cwv: [
          {
            type: 'group',
            pattern: 'https://example.com/*',
            name: 'Some pages',
            pageviews: 5000,
            organic: 3000,
            metrics: [{
              deviceType: 'mobile',
              lcp: 3000, // > 2500 threshold — ensures group passes hasFailingMetrics
              cls: null,
              inp: null,
            }],
          },
        ],
        auditContext: { interval: 7 },
      };
      const mockAuditGroupsOnly = {
        getSiteId: () => 'site-id',
        getId: () => 'audit-id',
        getAuditType: () => Audit.AUDIT_TYPES.CWV,
        getAuditResult: () => auditResultWithGroupsOnly,
        getFullAuditRef: () => auditUrl,
        getAuditedAt: () => '2023-11-27T12:34:56.789Z',
      };

      const stepContext = { ...context, site, audit: mockAuditGroupsOnly, finalUrl: auditUrl };
      await syncOpportunityAndSuggestionsStep(stepContext);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.have.lengthOf(1);
      expect(suggestionsArg[0].data.type).to.equal('group');
      expect(suggestionsArg[0].data).to.have.property('jiraLink', null);
    });
    it('creating a new opportunity object fails', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.rejects(new Error('big error happened'));
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      const stepContext = { ...context, site, audit: mockAudit, finalUrl: auditUrl };
      await expect(syncOpportunityAndSuggestionsStep(stepContext)).to.be.rejectedWith('big error happened');
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
        // Return old data (different from new) so deepEqual detects change
        getData: () => ({ ...suggestion.data, oldField: 'old value' }),
        setData: sinon.stub(),
        getStatus: sinon.stub().returns('NEW'),
        setUpdatedBy: sinon.stub().returnsThis(),
      }));
      oppty.getSuggestions.resolves(existingSuggestions);

      const stepContext = { ...context, site, audit: mockAudit, finalUrl: auditUrl };
      await syncOpportunityAndSuggestionsStep(stepContext);

      expect(siteConfig.getGroupedURLs).to.have.been.calledWith(Audit.AUDIT_TYPES.CWV);

      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(oppty.setAuditId).to.have.been.calledOnceWith('audit-id');
      expect(oppty.setData).to.have.been.calledOnceWith({ ...opptyData, ...expectedOppty.data });
      expect(oppty.setLastAuditedAt).to.have.been.calledOnce;
      expect(oppty.save).to.have.been.calledTwice;

      // make sure that 1 old suggestion is removed
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been
        .calledOnceWith([existingSuggestions[0]], 'OUTDATED');

      // make sure that 1 existing suggestion is updated
      expect(existingSuggestions[1].setData).to.have.been.calledOnce;
      expect(existingSuggestions[1].setData.firstCall.args[0]).to.deep.equal(suggestions[1].data);
      expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;

      // make sure that 1 new suggestion is created (/docs/ — the only new failing-metric page)
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(1);
    });

    it('creates a new opportunity object when GSC connection returns null', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);

      // Mock GoogleClient to return null/undefined
      sinon.stub(GoogleClient, 'createFrom').resolves(null);

      const stepContext = { ...context, site, audit: mockAudit, finalUrl: auditUrl };
      await syncOpportunityAndSuggestionsStep(stepContext);

      expect(GoogleClient.createFrom).to.have.been.calledWith(stepContext, auditUrl);
      expect(context.dataAccess.Opportunity.create)
        .to.have.been.calledOnceWith(expectedOpptyWithoutGSC);

      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(2);
    });

    it('creates a new opportunity object without GSC if not connected', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);

      sinon.stub(GoogleClient, 'createFrom').rejects(new Error('GSC not connected'));

      const stepContext = { ...context, site, audit: mockAudit, finalUrl: auditUrl };
      await syncOpportunityAndSuggestionsStep(stepContext);

      expect(GoogleClient.createFrom).to.have.been.calledWith(stepContext, auditUrl);
      expect(context.dataAccess.Opportunity.create)
        .to.have.been.calledOnceWith(expectedOpptyWithoutGSC);

      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(2);
    });

    it('calls processAutoSuggest when suggestions have no guidance', async () => {
      // Mock suggestions without guidance (empty issues array). Include a failing metric
      // on each so the auto-suggest skip ("no failing CWV metrics") doesn't drop them.
      const failingMetrics = [{ deviceType: 'mobile', lcp: 3500, cls: 0.05, inp: 100 }];
      const mockSuggestions = [
        { getId: () => 'sugg-1', getData: () => ({ type: 'url', url: 'test1', issues: [], metrics: failingMetrics }), getStatus: () => 'NEW' },
        { getId: () => 'sugg-2', getData: () => ({ type: 'url', url: 'test2', issues: [], metrics: failingMetrics }), getStatus: () => 'NEW' }
      ];
      
      // Setup opportunity with mock suggestions before the function call
      oppty.getSuggestions = sandbox.stub().resolves(mockSuggestions);
      
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      await syncOpportunityAndSuggestionsStep({ site, audit: mockAudit, finalUrl: auditUrl, log: context.log, ...context });

      // Verify that SQS sendMessage was called twice (once per suggestion)
      expect(context.sqs.sendMessage).to.have.been.calledTwice;
      const message = context.sqs.sendMessage.firstCall.args[1];
      expect(message.type).to.equal('guidance:cwv');
      expect(message.siteId).to.equal('site-id');
    });

    it('does not call processAutoSuggest when all suggestions have guidance', async () => {
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

      await syncOpportunityAndSuggestionsStep({ site, audit: mockAudit, finalUrl: auditUrl, log: context.log, ...context });

      // Verify that SQS sendMessage was NOT called
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('filters CWV suggestions to only failing-metric pages for all sites', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      const stepContext = { ...context, site, audit: mockAudit, finalUrl: auditUrl };
      await syncOpportunityAndSuggestionsStep(stepContext);

      // Of the 4 CWV entries (pageviews >= 7000):
      //   - Group: mobile cls=0.27 > 0.1   → FAILS
      //   - /developer/block-collection:    → PASSES (all below threshold)
      //   - /docs/: mobile lcp=26276 > 2500 → FAILS
      //   - /tools/rum/explorer.html:       → PASSES (all below threshold)
      // Global filter should yield 2 suggestions
      expect(oppty.addSuggestions).to.have.been.calledOnce;
      const suggestionsArg = oppty.addSuggestions.getCall(0).args[0];
      expect(suggestionsArg).to.be.an('array').with.lengthOf(2);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/2 of 4 CWV entries have failing metrics/),
      );

      // Both failing entries (group + /docs/) each had an all-green desktop row alongside
      // a failing mobile row. filterToFailingDeviceMetrics must have stripped the desktop
      // row from each — only the failing mobile row should survive in the suggestion data.
      suggestionsArg.forEach((s) => {
        expect(s.data.metrics).to.have.lengthOf(1);
        expect(s.data.metrics[0].deviceType).to.equal('mobile');
      });
    });

    it('stores no suggestions when all pages have passing metrics', async () => {
      const allPassingCwvData = [
        {
          type: 'url',
          url: 'https://www.aem.live/docs/',
          pageviews: 9000,
          organic: 500,
          metrics: [{
            deviceType: 'desktop',
            pageviews: 9000,
            organic: 500,
            lcp: 1200,
            cls: 0.05,
            inp: 150,
          }],
        },
      ];

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      const allPassingAudit = {
        ...mockAudit,
        getAuditResult: () => ({ cwv: allPassingCwvData, auditContext: { interval: 7 } }),
      };
      const stepContext = { ...context, site, audit: allPassingAudit, finalUrl: auditUrl };
      await syncOpportunityAndSuggestionsStep(stepContext);

      expect(oppty.addSuggestions).to.not.have.been.called;
    });

    it('calls processAutoSuggest only for suggestions without a code change available', async () => {
      // Dispatch decision is driven by data.isCodeChangeAvailable: suggestions
      // where a code patch already landed are skipped; everything else is
      // dispatched (regardless of whether text guidance already exists, which is
      // not proof that a code patch ran successfully).
      const failingMetrics = [{ deviceType: 'mobile', lcp: 3500, cls: 0.05, inp: 100 }];
      const mockSuggestions = [
        {
          getId: () => 'sugg-1',
          getData: () => ({
            type: 'url',
            url: 'test1',
            isCodeChangeAvailable: true,
            issues: [
              { type: 'lcp', value: '# LCP Optimization...' }
            ],
            metrics: failingMetrics,
          }),
          getStatus: () => 'NEW'
        },
        {
          getId: () => 'sugg-2',
          getData: () => ({
            type: 'url',
            url: 'test2',
            // no isCodeChangeAvailable — patch hasn't landed yet
            issues: [],
            metrics: failingMetrics,
          }),
          getStatus: () => 'NEW'
        }
      ];

      // Setup opportunity with mock suggestions before the function call
      oppty.getSuggestions = sandbox.stub().resolves(mockSuggestions);

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(oppty);
      sinon.stub(GoogleClient, 'createFrom').resolves({});

      await syncOpportunityAndSuggestionsStep({ site, audit: mockAudit, finalUrl: auditUrl, log: context.log, ...context });

      // Only sugg-2 (no code change yet) should be dispatched.
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage.firstCall.args[1].data.suggestionId).to.equal('sugg-2');
    });
  });
});

describe('shouldSendAutoSuggestForSuggestion — codefix dispatch gating', () => {
  let shouldSendAutoSuggestForSuggestion;

  before(async () => {
    ({ shouldSendAutoSuggestForSuggestion } = await import('../../src/cwv/auto-suggest.js'));
  });

  const stub = (suggestionStatus, data = {}) => ({
    getStatus: () => suggestionStatus,
    getData: () => data,
  });

  it('returns false when suggestion status is not NEW', () => {
    expect(shouldSendAutoSuggestForSuggestion(stub('APPROVED'))).to.be.false;
    expect(shouldSendAutoSuggestForSuggestion(stub('OUTDATED'))).to.be.false;
    expect(shouldSendAutoSuggestForSuggestion(stub('FIXED'))).to.be.false;
    expect(shouldSendAutoSuggestForSuggestion(stub('ERROR'))).to.be.false;
    expect(shouldSendAutoSuggestForSuggestion(stub('REJECTED'))).to.be.false;
  });

  it('returns true when suggestion is NEW and no code change has landed', () => {
    expect(shouldSendAutoSuggestForSuggestion(stub('NEW'))).to.be.true;
    expect(shouldSendAutoSuggestForSuggestion(stub('NEW', { issues: [] }))).to.be.true;
    expect(shouldSendAutoSuggestForSuggestion(stub('NEW', { isCodeChangeAvailable: false }))).to.be.true;
  });

  it('returns false when isCodeChangeAvailable is true', () => {
    expect(shouldSendAutoSuggestForSuggestion(stub('NEW', { isCodeChangeAvailable: true }))).to.be.false;
  });

  it('dispatches NEW suggestions whose issues already have guidance text but no code change yet (Bug 2 regression)', () => {
    // Previously, populated issues[*].value blocked re-dispatch and silently
    // killed codefix retries. The done-signal is now isCodeChangeAvailable.
    expect(shouldSendAutoSuggestForSuggestion(stub('NEW', {
      issues: [
        { type: 'lcp', status: 'NEW', value: '# LCP guidance...' },
        { type: 'cls', status: 'NEW', value: '# CLS guidance...' },
      ],
    }))).to.be.true;
  });

  it('dispatches NEW suggestions regardless of per-issue status when isCodeChangeAvailable is not true', () => {
    ['APPROVED', 'REJECTED', 'SKIPPED', 'FIXED', 'IN_PROGRESS', 'ERROR', 'OUTDATED'].forEach((status) => {
      const result = shouldSendAutoSuggestForSuggestion(stub('NEW', {
        issues: [{ type: 'lcp', status, value: '# guidance...' }],
      }));
      expect(result, `expected true for issue.status=${status}`).to.be.true;
    });
  });
});

describe('Per-issue OUTDATED merge helpers', () => {
  // Imported lazily to keep the existing top-level imports unchanged.
  let isMetricFailing;
  let applyPerIssueOutdated;
  let mergeCwvData;

  before(async () => {
    ({ isMetricFailing, applyPerIssueOutdated, mergeCwvData } = await import('../../src/cwv/opportunity-sync.js'));
  });

  // LCP threshold is 2500ms, CLS 0.1, INP 200ms (see kpi-metrics.js).
  const entryFailingLcp = {
    metrics: [{ deviceType: 'mobile', lcp: 4500, cls: 0.05, inp: 100 }],
  };
  const entryAllPassing = {
    metrics: [{ deviceType: 'mobile', lcp: 1800, cls: 0.05, inp: 100 }],
  };
  const entryFailingClsAndInp = {
    metrics: [{ deviceType: 'mobile', lcp: 1800, cls: 0.3, inp: 350 }],
  };

  describe('isMetricFailing', () => {
    it('returns true when metric exceeds threshold on any device', () => {
      expect(isMetricFailing(entryFailingLcp, 'lcp')).to.be.true;
    });

    it('returns false when metric is below threshold on every device', () => {
      expect(isMetricFailing(entryAllPassing, 'lcp')).to.be.false;
    });

    it('returns false when metric values are null/undefined (no data = passing)', () => {
      const entry = { metrics: [{ deviceType: 'mobile', lcp: null, cls: undefined }] };
      expect(isMetricFailing(entry, 'lcp')).to.be.false;
      expect(isMetricFailing(entry, 'cls')).to.be.false;
    });

    it('returns false on malformed input (no metrics array)', () => {
      expect(isMetricFailing(null, 'lcp')).to.be.false;
      expect(isMetricFailing({}, 'lcp')).to.be.false;
      expect(isMetricFailing({ metrics: 'not-an-array' }, 'lcp')).to.be.false;
    });
  });

  describe('applyPerIssueOutdated', () => {
    it('marks issue OUTDATED when its metric type no longer fails', () => {
      const existing = [
        { id: 'a', type: 'lcp', status: 'NEW', value: 'lcp guidance' },
      ];
      const result = applyPerIssueOutdated(existing, entryAllPassing);
      expect(result[0].status).to.equal('OUTDATED');
      // Other fields preserved
      expect(result[0].id).to.equal('a');
      expect(result[0].value).to.equal('lcp guidance');
    });

    it('keeps issue NEW when its metric type still fails', () => {
      const existing = [
        { id: 'a', type: 'lcp', status: 'NEW', value: 'lcp guidance' },
      ];
      const result = applyPerIssueOutdated(existing, entryFailingLcp);
      expect(result[0].status).to.equal('NEW');
    });

    it('marks only the resolved metric OUTDATED; others stay NEW', () => {
      const existing = [
        { id: 'a', type: 'lcp', status: 'NEW' },
        { id: 'b', type: 'cls', status: 'NEW' },
        { id: 'c', type: 'inp', status: 'NEW' },
      ];
      // Only CLS and INP fail now — LCP resolved
      const result = applyPerIssueOutdated(existing, entryFailingClsAndInp);
      expect(result[0].status).to.equal('OUTDATED'); // lcp resolved
      expect(result[1].status).to.equal('NEW'); // cls still failing
      expect(result[2].status).to.equal('NEW'); // inp still failing
    });

    it('preserves APPROVED status when metric resolves (skip list)', () => {
      const existing = [{ id: 'a', type: 'lcp', status: 'APPROVED' }];
      const result = applyPerIssueOutdated(existing, entryAllPassing);
      expect(result[0].status).to.equal('APPROVED');
    });

    it('preserves FIXED, REJECTED, SKIPPED, IN_PROGRESS, ERROR, OUTDATED in skip list', () => {
      const statuses = ['FIXED', 'REJECTED', 'SKIPPED', 'IN_PROGRESS', 'ERROR', 'OUTDATED'];
      statuses.forEach((status) => {
        const existing = [{ id: 'a', type: 'lcp', status }];
        const result = applyPerIssueOutdated(existing, entryAllPassing);
        expect(result[0].status, `expected ${status} preserved`).to.equal(status);
      });
    });

    it('leaves legacy issues without a type field untouched', () => {
      const existing = [{ value: 'markdown only, no type', status: 'NEW' }];
      const result = applyPerIssueOutdated(existing, entryAllPassing);
      expect(result[0]).to.deep.equal({ value: 'markdown only, no type', status: 'NEW' });
    });

    it('marks NEW issue OUTDATED even when status field is missing (defaults to OUTDATED on resolve)', () => {
      const existing = [{ id: 'a', type: 'lcp' }]; // no status field
      const result = applyPerIssueOutdated(existing, entryAllPassing);
      expect(result[0].status).to.equal('OUTDATED');
    });

    it('returns empty array for empty input', () => {
      expect(applyPerIssueOutdated([], entryAllPassing)).to.deep.equal([]);
    });

    it('returns the input unchanged when not an array', () => {
      expect(applyPerIssueOutdated(undefined, entryAllPassing)).to.deep.equal([]);
      expect(applyPerIssueOutdated(null, entryAllPassing)).to.deep.equal([]);
    });

    it('does not mutate the input array or its issues', () => {
      const existing = [{ id: 'a', type: 'lcp', status: 'NEW' }];
      const before = JSON.stringify(existing);
      applyPerIssueOutdated(existing, entryAllPassing);
      expect(JSON.stringify(existing)).to.equal(before);
    });
  });

  describe('mergeCwvData', () => {
    it('shallow-merges new data over existing (default behaviour preserved when no issues)', () => {
      const existing = { url: 'x', metrics: [{ deviceType: 'mobile', lcp: 5000 }], pageviews: 100 };
      const newItem = { url: 'x', metrics: [{ deviceType: 'mobile', lcp: 3000 }], pageviews: 200 };
      const result = mergeCwvData(existing, newItem);
      expect(result).to.deep.equal({
        url: 'x',
        metrics: [{ deviceType: 'mobile', lcp: 3000 }],
        pageviews: 200,
      });
      // No `issues` key introduced when existing didn't have one
      expect(result).to.not.have.property('issues');
    });

    it('does not add an `issues` key when existing has an empty issues array', () => {
      const existing = { url: 'x', metrics: [{ lcp: 5000 }], issues: [] };
      const newItem = { url: 'x', metrics: [{ lcp: 3000 }] };
      const result = mergeCwvData(existing, newItem);
      // issues comes from the spread of existing (empty array), and we don't re-write it
      expect(result.issues).to.deep.equal([]);
    });

    it('self-heals legacy jiraLink="" to null (stops the schema validation warning)', () => {
      const existing = {
        url: 'x',
        metrics: [{ deviceType: 'mobile', lcp: 5000 }],
        jiraLink: '', // legacy bad value
      };
      const newItem = { url: 'x', metrics: [{ deviceType: 'mobile', lcp: 5000 }] };
      const result = mergeCwvData(existing, newItem);
      expect(result.jiraLink).to.equal(null);
    });

    it('preserves a valid jiraLink URI on re-merge', () => {
      const existing = {
        url: 'x',
        metrics: [{ deviceType: 'mobile', lcp: 5000 }],
        jiraLink: 'https://jira.example.com/browse/CWV-123',
      };
      const newItem = { url: 'x', metrics: [{ deviceType: 'mobile', lcp: 5000 }] };
      const result = mergeCwvData(existing, newItem);
      expect(result.jiraLink).to.equal('https://jira.example.com/browse/CWV-123');
    });

    it('preserves an already-null jiraLink on re-merge', () => {
      const existing = {
        url: 'x',
        metrics: [{ deviceType: 'mobile', lcp: 5000 }],
        jiraLink: null,
      };
      const newItem = { url: 'x', metrics: [{ deviceType: 'mobile', lcp: 5000 }] };
      const result = mergeCwvData(existing, newItem);
      expect(result.jiraLink).to.equal(null);
    });

    it('marks resolved-metric issues OUTDATED on re-merge', () => {
      const existing = {
        url: 'x',
        metrics: [{ deviceType: 'mobile', lcp: 4500, cls: 0.3 }],
        issues: [
          { id: 'a', type: 'lcp', status: 'NEW' },
          { id: 'b', type: 'cls', status: 'NEW' },
        ],
      };
      const newItem = {
        url: 'x',
        metrics: [{ deviceType: 'mobile', lcp: 1800, cls: 0.3 }], // lcp resolved, cls still failing
      };
      const result = mergeCwvData(existing, newItem);
      expect(result.issues[0].status).to.equal('OUTDATED'); // lcp
      expect(result.issues[1].status).to.equal('NEW'); // cls
      // metrics overwritten by new data
      expect(result.metrics[0].lcp).to.equal(1800);
    });
  });
});
