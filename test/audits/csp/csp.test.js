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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';

import {
  Audit,
  Opportunity,
  Site,
  Suggestion,
} from '@adobe/spacecat-shared-data-access';
import { isIsoDate } from '@adobe/spacecat-shared-utils';
import createLHSAuditRunner from '../../../src/lhs/lib.js';
import { MockContextBuilder } from '../../shared.js';
import { cspOpportunityAndSuggestions } from '../../../src/csp/csp.js';
import { cspAutoSuggest } from '../../../src/csp/csp-auto-suggest.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

use(sinonChai);
use(chaiAsPromised);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const message = {
  type: 'lhs-mobile',
  url: 'site-id',
};

function assertAuditData(auditData) {
  expect(auditData).to.be.an('object');
  expect(auditData.auditResult).to.be.an('object');
  expect(auditData.auditResult.finalUrl).to.equal('https://adobe.com/');
  expect(isIsoDate(auditData.auditResult.contentLastModified)).to.be.true;
  expect(auditData.auditResult.thirdPartySummary).to.be.an('array').with.lengthOf(0);
  expect(auditData.auditResult.totalBlockingTime).to.be.null;
  expect(auditData.auditResult.scores).to.deep.equal({
    performance: 0.5,
    accessibility: 0.5,
    'best-practices': 0.5,
    seo: 0.5,
  });
}

describe('CSP Post-processor', () => {
  let context;
  let mobileAuditRunner;

  const site = {
    getId: () => 'some-site-id',
  };

  const sandbox = sinon.createSandbox();

  const psiResult = {
    lighthouseResult: {
      finalUrl: 'https://adobe.com/',
      categories: {
        performance: {
          score: 0.5,
        },
        accessibility: {
          score: 0.5,
        },
        'best-practices': {
          score: 0.5,
        },
        seo: {
          score: 0.5,
        },
      },
    },
  };

  const siteUrl = 'https://adobe.com/';

  const findingDetails = [
    {
      type: 'static-content',
      url: 'https://adobe.com/head.html',
      page: 'head.html',
      findings: [
        {
          "type": "csp-nonce-missing"
        },
        {
          "type": "csp-meta-tag-missing"
        }
      ],
    },
    {
      type: 'static-content',
      url: 'https://adobe.com/404.html',
      page: '404.html',
      findings: [
        {
          "type": "csp-nonce-missing"
        },
        {
          "type": "csp-meta-tag-missing"
        }
      ],
    },
  ];

  let cspSite;
  let auditData;
  let opportunityStub;
  let suggestionStub;
  let cspOpportunity;
  let configuration;

  beforeEach(async () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AUDIT_RESULTS_QUEUE_URL: 'some-queue-url',
          PAGESPEED_API_BASE_URL: 'https://psi-audit-service.com',
        },
        func: {
          version: 'v1',
        },
      })
      .build(message);

    mobileAuditRunner = createLHSAuditRunner('mobile');

    nock('https://adobe.com').get('/').reply(200);
    nock('https://adobe.com').head('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
      .reply(200, psiResult);

    cspSite = {
      ...site,
      getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
    };

    auditData = await mobileAuditRunner(siteUrl, context, cspSite);
    assertAuditData(auditData);

    auditData = {
      ...auditData,
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      auditResult: {
        ...auditData.auditResult,
        csp: [
          {
            severity: 'High',
            description: 'No CSP found in enforcement mode',
          },
        ],
      },
    };

    opportunityStub = {
      allBySiteIdAndStatus: sinon.stub().resolves([]),
      create: sinon.stub(),
    };
    context.dataAccess.Opportunity = opportunityStub;

    suggestionStub = {
      bulkUpdateStatus: sinon.stub().resolves([]),
    };
    context.dataAccess.Suggestion = suggestionStub;

    configuration = {
      isHandlerEnabledForSite: sandbox.stub(),
      getHandlers: sandbox.stub().returns({}),
    };
    context.dataAccess.Configuration.findLatest.resolves(configuration);

    cspOpportunity = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setStatus: sinon.stub(),
      save: sinon.stub(),
      getSuggestions: sinon.stub().returns([]),
      addSuggestions: sinon
        .stub()
        .returns({ errorItems: [], createdItems: [1] }),
      getType: () => Audit.AUDIT_TYPES.SECURITY_CSP,
      getSiteId: () => 'test-site-id',
      setUpdatedBy: sinon.stub(),
    };
    opportunityStub.create.resolves(cspOpportunity);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should not create opportunity if no CSP findings in lighthouse report', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [];

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    expect(opportunityStub.create).to.not.have.been.called;
    expect(cspOpportunity.setStatus).to.not.have.been.called;
    expect(cspOpportunity.save).to.not.have.been.called;
    expect(cspOpportunity.addSuggestions).to.not.have.been.called;
    expect(suggestionStub.bulkUpdateStatus).to.not.have.been.called;
  });

  it('should resolve existing opportunity if no CSP findings in lighthouse report', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [];

    sinon.replace(opportunityStub, 'allBySiteIdAndStatus', sinon.stub().resolves([cspOpportunity]));
    sinon.replace(cspOpportunity, 'getSuggestions', sinon.stub().resolves([
      {
        getStatus: () => Suggestion.STATUSES.OUTDATED,
      },
    ]));

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    // Existing opportunity is being updated
    expect(opportunityStub.create).to.not.have.been.called;
    expect(cspOpportunity.setStatus).to.have.been.calledWith(Opportunity.STATUSES.RESOLVED);
    expect(cspOpportunity.save).to.have.been.called;
    expect(cspOpportunity.addSuggestions).to.not.have.been.called;

    // No suggestions are updated as all already resolved
    expect(suggestionStub.bulkUpdateStatus).to.not.have.been.called;
  });

  it('should resolve existing opportunity and all suggestions if no CSP findings in lighthouse report', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [];

    sinon.replace(opportunityStub, 'allBySiteIdAndStatus', sinon.stub().resolves([cspOpportunity]));
    const activeSuggestion = {
      getStatus: () => Suggestion.STATUSES.NEW,
    };
    const outdatedSuggestion = {
      getStatus: () => Suggestion.STATUSES.OUTDATED,
    };
    sinon.replace(cspOpportunity, 'getSuggestions', sinon.stub().resolves([
      ...[activeSuggestion],
      ...[outdatedSuggestion],
      ...[activeSuggestion],
    ]));

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    // Existing opportunity is being updated
    expect(opportunityStub.create).to.not.have.been.called;
    expect(cspOpportunity.setStatus).to.have.been.calledWith(Opportunity.STATUSES.RESOLVED);
    expect(cspOpportunity.save).to.have.been.called;
    expect(cspOpportunity.addSuggestions).to.not.have.been.called;

    // All suggestions are updated
    expect(suggestionStub.bulkUpdateStatus).to.have.been.calledWith([
      ...[activeSuggestion],
      ...[activeSuggestion],
    ], Suggestion.STATUSES.FIXED);
  });

  it('should resolve existing opportunity if no CSP findings in lighthouse report - error case 1', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [];

    sinon.replace(opportunityStub, 'allBySiteIdAndStatus', sinon.stub().throws());
    sinon.replace(cspOpportunity, 'getSuggestions', sinon.stub().resolves([
      {
        getStatus: () => Suggestion.STATUSES.OUTDATED,
      },
    ]));

    try {
      await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);

      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('Failed to fetch opportunities for siteId test-site-id: Error');
    }
  });

  it('should resolve existing opportunity if no CSP findings in lighthouse report - error case 2', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [];

    sinon.replace(opportunityStub, 'allBySiteIdAndStatus', sinon.stub().resolves([cspOpportunity]));
    sinon.replace(cspOpportunity, 'getSuggestions', sinon.stub().throws());

    try {
      await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);

      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('Failed to resolve suggestions for siteId test-site-id: Error');
    }
  });

  it('should extract CSP opportunity', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [
      {
        severity: 'High',
        description: 'No CSP found in enforcement mode',
      },
    ];

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    expect(opportunityStub.create).to.have.been.calledWith(sinon.match({
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
      type: Audit.AUDIT_TYPES.SECURITY_CSP,
      origin: 'AUTOMATION',
      title: 'XSS vulnerabilities on your site have been detected — patch them for stronger security',
      description: 'Unpatched vulnerabilities expose visitors to attacks — fixing them protects users and preserves brand integrity.',
      data: {
        securityScoreImpact: 10,
        howToFix: '### ⚠ **Warning**\nThis solution requires testing before deployment. Customer code and configurations vary, so please validate in a test branch first.\nSee https://www.aem.live/docs/csp-strict-dynamic-cached-nonce for more details.',
        dataSources: [
          'Page',
        ],
        securityType: 'EDS-CSP',
        mainMetric: {
          name: 'Issue',
          value: 1,
        },
      },
      tags: [
        'CSP',
        'Security',
      ],
    }));
    expect(cspOpportunity.addSuggestions).to.have.been.calledOnce;
    expect(cspOpportunity.addSuggestions).to.have.been.calledWith(sinon.match(
      [
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'High',
            directive: undefined,
            description: 'No CSP found in enforcement mode',
          },
        }),
      ],
    ));
  });

  it('should remove reference to hashes', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [
      {
        directive: 'script-src',
        description: 'Host allowlists can frequently be bypassed. Consider using CSP nonces instead, along with `\'strict-dynamic\'` if necessary.',
        severity: 'High',
      },
      {
        directive: 'script-src',
        description: '`\'unsafe-inline\'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces to allow scripts individually.',
        severity: 'High',
      },
      {
        directive: 'object-src',
        description: 'Avoid using plain URL schemes (data:) in this directive. Plain URL schemes allow scripts to be sourced from an unsafe domain.',
        severity: 'High',
      },
    ];

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    expect(opportunityStub.create).to.have.been.calledWith(sinon.match({
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
      type: Audit.AUDIT_TYPES.SECURITY_CSP,
      origin: 'AUTOMATION',
      title: 'XSS vulnerabilities on your site have been detected — patch them for stronger security',
      description: 'Unpatched vulnerabilities expose visitors to attacks — fixing them protects users and preserves brand integrity.',
      data: {
        securityScoreImpact: 10,
        howToFix: '### ⚠ **Warning**\nThis solution requires testing before deployment. Customer code and configurations vary, so please validate in a test branch first.\nSee https://www.aem.live/docs/csp-strict-dynamic-cached-nonce for more details.',
        dataSources: [
          'Page',
        ],
        securityType: 'EDS-CSP',
        mainMetric: {
          name: 'Issues',
          value: 3,
        },
      },
      tags: [
        'CSP',
        'Security',
      ],
    }));
    expect(cspOpportunity.addSuggestions).to.have.been.calledOnce;
    expect(cspOpportunity.addSuggestions).to.have.been.calledWith(sinon.match(
      [
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'High',
            directive: 'script-src',
            description: 'Host allowlists can frequently be bypassed. Consider using CSP nonces instead, along with `\'strict-dynamic\'` if necessary.',
          },
        }),
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'High',
            directive: 'script-src',
            description: '`\'unsafe-inline\'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces to allow scripts individually.',
          },
        }),
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'High',
            directive: 'object-src',
            description: 'Avoid using plain URL schemes (data:) in this directive. Plain URL schemes allow scripts to be sourced from an unsafe domain.',
          },
        }),
      ],
    ));
  });

  it('should extract multiple suggestions with subitems', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [
      {
        severity: 'Syntax',
        description: {
          type: 'code',
          value: 'script-src \'self\' \'unsafe-eval\' \'unsafe-inline\' *.cloudfront.net/js/hapyak.js ...',
        },
        subItems: {
          type: 'subitems',
          items: [
            {
              directive: 'worker-src',
              description: 'unsafe-eval seems to be an invalid keyword.',
            },
            {
              directive: 'worker-src',
              description: 'unsafe-inline seems to be an invalid keyword.',
            },
          ],
        },
      },
      {
        directive: 'script-src',
        description: 'Host allowlists can frequently be bypassed. Consider using CSP nonces or hashes instead, along with `\'strict-dynamic\'` if necessary.',
        severity: 'High',
      },
      {
        directive: 'script-src',
        description: '`\'unsafe-inline\'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces or hashes to allow scripts individually.',
        severity: 'High',
      },
    ];

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    expect(opportunityStub.create).to.have.been.calledWith(sinon.match({
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
      type: Audit.AUDIT_TYPES.SECURITY_CSP,
      origin: 'AUTOMATION',
      title: 'XSS vulnerabilities on your site have been detected — patch them for stronger security',
      description: 'Unpatched vulnerabilities expose visitors to attacks — fixing them protects users and preserves brand integrity.',
      data: {
        securityScoreImpact: 10,
        howToFix: '### ⚠ **Warning**\nThis solution requires testing before deployment. Customer code and configurations vary, so please validate in a test branch first.\nSee https://www.aem.live/docs/csp-strict-dynamic-cached-nonce for more details.',
        dataSources: [
          'Page',
        ],
        securityType: 'EDS-CSP',
        mainMetric: {
          name: 'Issues',
          value: 4,
        },
      },
      tags: [
        'CSP',
        'Security',
      ],
    }));
    expect(cspOpportunity.addSuggestions).to.have.been.calledOnce;
    expect(cspOpportunity.addSuggestions).to.have.been.calledWith(sinon.match(
      [
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'Syntax',
            directive: 'worker-src',
            description: 'unsafe-eval seems to be an invalid keyword.',
          },
        }),
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'Syntax',
            directive: 'worker-src',
            description: 'unsafe-inline seems to be an invalid keyword.',
          },
        }),
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'High',
            directive: 'script-src',
            description: 'Host allowlists can frequently be bypassed. Consider using CSP nonces instead, along with `\'strict-dynamic\'` if necessary.',
          },
        }),
        sinon.match({
          type: 'CODE_CHANGE',
          rank: 0,
          data: {
            severity: 'High',
            directive: 'script-src',
            description: '`\'unsafe-inline\'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces to allow scripts individually.',
          },
        }),
      ],
    ));
  });

  it('should not extract opportunity if audit is disabled', async () => {
    configuration.isHandlerEnabledForSite.returns(false);
    auditData.auditResult.csp = [
      {
        severity: 'High',
        description: 'No CSP found in enforcement mode',
      },
    ];

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    expect(opportunityStub.create).to.not.have.been.called;
    expect(cspOpportunity.addSuggestions).to.not.have.been.called;
  });

  it('should not extract opportunity for other delivery types', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [
      {
        severity: 'High',
        description: 'No CSP found in enforcement mode',
      },
    ];
    cspSite.getDeliveryType = () => Site.DELIVERY_TYPES.OTHER;

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    expect(opportunityStub.create).to.not.have.been.called;
    expect(cspOpportunity.addSuggestions).to.not.have.been.called;
  });

  it('should not extract opportunity if audit failed', async () => {
    sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp');
    auditData.auditResult.csp = [
      {
        severity: 'High',
        description: 'No CSP found in enforcement mode',
      },
    ];
    auditData.auditResult.success = false;

    const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
    assertAuditData(cspAuditData);

    expect(opportunityStub.create).to.not.have.been.called;
    expect(cspOpportunity.addSuggestions).to.not.have.been.called;
  });

  describe('CSP auto-suggest', () => {
    it('should provide suggestions for missing CSP', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: findingDetails,
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/missing-csp.patch'), 'utf8'),
          }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head.html'), 'utf8'));
      nock('https://adobe.com').get('/404.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/404.html'), 'utf8'));

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.warn).not.to.have.been.calledWithMatch(sinon.match('no place found to insert CSP meta tag'));
      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('should provide suggestions for multi-line script tags', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: [...findingDetails.slice(0, 1)],
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/multiline-script.patch'), 'utf8'),
          }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head-multiline.html')));
      nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.warn).not.to.have.been.calledWithMatch(sinon.match('no place found to insert CSP meta tag'));
      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('should provide suggestions for content without meta tags', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: [...findingDetails.slice(1, 2)],
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/nometa.patch'), 'utf8'),
          }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, '');
      nock('https://adobe.com').get('/404.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/404-nometa.html')));

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.warn).not.to.have.been.calledWithMatch(sinon.match('no place found to insert CSP meta tag'));
      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('should warn for content without meta and head tags', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: [...findingDetails.slice(0, 1)],
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/nometa-head.patch'), 'utf8'),
          }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head-nometa.html')));
      nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.warn).to.have.been.calledWithMatch(sinon.match('no place found to insert CSP meta tag'));
      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('should provide suggestions for script tags with existing nonce attribute', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: [
            {
              findings: [
                {
                  type: "csp-meta-tag-missing",
                }
              ],
              page: "head.html",
              type: "static-content",
              url: "https://adobe.com/head.html"
            }
          ],
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/meta-only.patch'), 'utf8'),
          }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head-nonce.html')));
      nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('should provide suggestion to update existing meta element without move-to-http-header', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: [
            {
              findings: [
                {
                  "type": "csp-meta-tag-move-to-header",
                }
              ],
              page: "head.html",
              type: "static-content",
              url: "https://adobe.com/head.html"
            }
          ],
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/meta-noheader.patch'), 'utf8'),
          }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head-meta-noheader.html')));
      nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('should provide suggestion to update existing meta element with incomplete content', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: [
            {
              findings: [
                {
                  "type": "csp-meta-tag-missing",
                }
              ],
              page: "head.html",
              type: "static-content",
              url: "https://adobe.com/head.html"
            }
          ],
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/meta-content.patch'), 'utf8'),
          }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head-meta-content.html')));
      nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('auto-identify info is returned if no details found', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          "findings": [],
          "issues": []
        }
      ];

      const scopeHead = nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head-ok.html')));
      const scope404 = nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(scopeHead.isDone()).to.equal(true);
      expect(scope404.isDone()).to.equal(true);

      expect(context.log.debug).to.have.been.calledWithMatch(sinon.match('[security-csp] [Site: some-site-id] [Url: https://adobe.com/head.html]: no CSP findings found'));
    });

    it('auto-suggest info is returned for nonce CSP findings', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          directive: 'script-src',
          description: 'Host allowlists can frequently be bypassed. Consider using CSP nonces instead, along with `\'strict-dynamic\'` if necessary.',
          severity: 'High',
        },
        {
          directive: 'script-src',
          description: '`\'unsafe-inline\'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces to allow scripts individually.',
          severity: 'High',
        },
        {
          directive: 'object-src',
          description: 'Avoid using plain URL schemes (data:) in this directive. Plain URL schemes allow scripts to be sourced from an unsafe domain.',
          severity: 'High',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0],
          findings: findingDetails,
          issues: [{
            content: fs.readFileSync(path.join(__dirname, 'testdata/missing-csp.patch'), 'utf8'),
          }],
        },
        {
          ...csp[1]
        },
        {
          ...csp[2]
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/head.html')));
      nock('https://adobe.com').get('/404.html').reply(200, fs.readFileSync(path.join(__dirname, 'testdata/404.html')));

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.debug).not.to.have.been.calledWithMatch(sinon.match('Skipping CSP auto-suggest.'));
    });

    it('auto-identify info is returned for unexpected CSP findings', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          directive: 'script-src',
          description: '`\'unsafe-inline\'` allows the execution of unsafe in-page scripts and event handlers.',
          severity: 'High',
        },
      ];
      const expectedCsp = [
          {
            ...csp[0]
          }
      ];

      const scopeHead = nock('https://adobe.com').get('/head.html').reply(200);
      const scope404 = nock('https://adobe.com').get('/404.html').reply(200);

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(scopeHead.isDone()).to.equal(false);
      expect(scope404.isDone()).to.equal(false);

      expect(context.log.debug).to.have.been.calledWithMatch(sinon.match('Skipping CSP auto-suggest.'));
    });

    it('auto-identify info is returned if auto-suggestion fails', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      const expectedCsp = [
        {
          ...csp[0]
        }
      ];

      const scopeHead = nock('https://adobe.com').get('/head.html').reply(404);
      const scope404 = nock('https://adobe.com').get('/404.html').reply(404);

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(scopeHead.isDone()).to.equal(true);
      expect(scope404.isDone()).to.equal(true);

      expect(context.log.error).to.have.been.calledWithMatch(sinon.match('[security-csp] [Site: some-site-id]: Error downloading page head.html'));
      expect(context.log.error).to.have.been.calledWithMatch(sinon.match('[security-csp] [Site: some-site-id]: Error downloading page 404.html'));
      expect(context.log.error).to.have.been.calledWithMatch(sinon.match('[security-csp] [Site: some-site-id]: Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('should not provide suggestions if audit is disabled', async () => {
      configuration.isHandlerEnabledForSite.returns(false);
      const csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];

      const scopeHead = nock('https://adobe.com').get('/head.html').reply(404);
      const scope404 = nock('https://adobe.com').get('/404.html').reply(404);

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(csp);

      expect(scopeHead.isDone()).to.equal(false);
      expect(scope404.isDone()).to.equal(false);

      expect(context.log.info).to.have.been.calledWithMatch(sinon.match('auto-suggest is disabled for site'));
    });
  });
});
