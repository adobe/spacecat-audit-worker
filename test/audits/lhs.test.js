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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { isIsoDate } from '@adobe/spacecat-shared-utils';
import createLHSAuditRunner, {
  extractAuditScores,
  extractCSP,
  extractThirdPartySummary,
  extractTotalBlockingTime,
  getContentLastModified,
} from '../../src/lhs/lib.js';
import { MockContextBuilder } from '../shared.js';
import { cspOpportunityAndSuggestions } from '../../src/lhs/csp.js';

use(sinonChai);
use(chaiAsPromised);

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

describe('LHS Audit', () => {
  let context;
  let mobileAuditRunner;
  let desktopAuditRunner;

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

  beforeEach(() => {
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
    desktopAuditRunner = createLHSAuditRunner('desktop');

    nock('https://adobe.com').get('/').reply(200);
    nock('https://adobe.com').head('/').reply(200);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should successfully perform an audit for mobile strategy', async () => {
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
      .reply(200, psiResult);

    const auditData = await mobileAuditRunner('https://adobe.com/', context, site);
    assertAuditData(auditData);
  });

  it('logs and saves error on lighthouse error', async () => {
    const errorPSIResult = {
      ...psiResult,
    };
    errorPSIResult.lighthouseResult.runtimeError = { code: 'error-code', message: 'error-message' };

    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
      .reply(200, errorPSIResult);

    const auditData = await mobileAuditRunner('https://adobe.com/', context, site);

    expect(context.log.error).to.have.been.calledWith(
      'Audit error for site https://adobe.com/: error-message',
      { code: 'error-code', strategy: 'mobile' },
    );
    expect(auditData.auditResult.runtimeError).to.be.an('object');
  });

  it('successfully performs an audit for desktop strategy on dev', async () => {
    context.func = {
      version: 'ci',
    };

    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=desktop&serviceId=some-site-id')
      .reply(200, psiResult);

    const auditData = await desktopAuditRunner('https://adobe.com/', context, site);
    assertAuditData(auditData);
  });

  it('throws error when psi api fetch fails', async () => {
    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
      .reply(405, 'Method Not Allowed');

    await expect(mobileAuditRunner('https://adobe.com/', context, site))
      .to.be.rejectedWith('HTTP error! Status: 405');
  });

  it('throws error when context is incomplete', async () => {
    context.env = {};

    await expect(mobileAuditRunner('https://adobe.com/', context, site))
      .to.be.rejectedWith('Invalid PageSpeed API base URL');
  });

  describe('CSP post-processor', () => {
    const siteUrl = 'https://adobe.com/';

    let cspSite;
    let auditData;
    let opportunityStub;
    let cspOpportunity;
    let configuration;

    beforeEach(async () => {
      nock('https://psi-audit-service.com')
        .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
        .reply(200, psiResult);

      cspSite = {
        ...site,
        getDeliveryType: () => 'aem_edge',
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

      configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      cspOpportunity = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        setData: sinon.stub(),
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

    it('should not create opportunity if no CSP findings in lighthouse report', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      auditData.auditResult.csp = [];

      const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
      assertAuditData(cspAuditData);

      expect(opportunityStub.create).to.not.have.been.called;
      expect(cspOpportunity.addSuggestions).to.not.have.been.called;
    });

    it('should not create suggestion for backwards-compatible finding', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      auditData.auditResult.csp = [
        {
          directive: 'script-src',
          description: 'Consider adding \'unsafe-inline\' (ignored by browsers supporting nonces/hashes) to be backward compatible with older browsers.',
          severity: 'Medium',
        },
      ];

      const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
      assertAuditData(cspAuditData);

      expect(opportunityStub.create).to.not.have.been.called;
      expect(cspOpportunity.addSuggestions).to.not.have.been.called;
    });

    it('should extract CSP opportunity', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
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
        title: 'The Content Security Policy configuration is ineffective against Cross Site Scripting (XSS) attacks',
        description: 'Content Security Policy can help protect applications from Cross Site Scripting (XSS) attacks, but in order for it to be effective one needs to define a secure policy. The recommended CSP setup is "Strict CSP with (cached) nonce + strict-dynamic".',
        data: {
          securityScoreImpact: 10,
          howToFix: '**Warning:** This solution requires testing before deployment. Customer code and configurations vary, so please validate in a test branch first.  \nSee https://www.aem.live/docs/csp-strict-dynamic-cached-nonce for more details.',
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

    it('should extract multiple suggestions with subitems', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
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
        title: 'The Content Security Policy configuration is ineffective against Cross Site Scripting (XSS) attacks',
        description: 'Content Security Policy can help protect applications from Cross Site Scripting (XSS) attacks, but in order for it to be effective one needs to define a secure policy. The recommended CSP setup is "Strict CSP with (cached) nonce + strict-dynamic".',
        data: {
          securityScoreImpact: 10,
          howToFix: '**Warning:** This solution requires testing before deployment. Customer code and configurations vary, so please validate in a test branch first.  \nSee https://www.aem.live/docs/csp-strict-dynamic-cached-nonce for more details.',
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
              description: 'Host allowlists can frequently be bypassed. Consider using CSP nonces or hashes instead, along with `\'strict-dynamic\'` if necessary.',
            },
          }),
          sinon.match({
            type: 'CODE_CHANGE',
            rank: 0,
            data: {
              severity: 'High',
              directive: 'script-src',
              description: '`\'unsafe-inline\'` allows the execution of unsafe in-page scripts and event handlers. Consider using CSP nonces or hashes to allow scripts individually.',
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
      configuration.isHandlerEnabledForSite.returns(true);
      auditData.auditResult.csp = [
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ];
      cspSite.getDeliveryType = () => 'other';

      const cspAuditData = await cspOpportunityAndSuggestions(siteUrl, auditData, context, cspSite);
      assertAuditData(cspAuditData);

      expect(opportunityStub.create).to.not.have.been.called;
      expect(cspOpportunity.addSuggestions).to.not.have.been.called;
    });

    it('should not extract opportunity if audit failed', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
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
  });
});

describe('LHS Data Utils', () => {
  describe('extractAuditScores', () => {
    it('extracts audit scores correctly', () => {
      const categories = {
        performance: { score: 0.8 },
        seo: { score: 0.9 },
        accessibility: { score: 0.7 },
        'best-practices': { score: 0.6 },
      };

      const scores = extractAuditScores(categories);

      expect(scores).to.deep.equal({
        performance: 0.8,
        seo: 0.9,
        accessibility: 0.7,
        'best-practices': 0.6,
      });
    });
  });

  describe('extractTotalBlockingTime', () => {
    it('extracts total blocking time if present', () => {
      const psiAudit = {
        'total-blocking-time': { numericValue: 1234 },
      };

      const tbt = extractTotalBlockingTime(psiAudit);

      expect(tbt).to.equal(1234);
    });

    it('returns null if total blocking time is absent', () => {
      const psiAudit = {};

      const tbt = extractTotalBlockingTime(psiAudit);

      expect(tbt).to.be.null;
    });
  });

  describe('extractThirdPartySummary', () => {
    it('extracts third party summary correctly', () => {
      const psiAudit = {
        'third-party-summary': {
          details: {
            items: [
              {
                entity: 'ExampleEntity',
                blockingTime: 200,
                mainThreadTime: 1000,
                transferSize: 1024,
              },
            ],
          },
        },
      };

      const summary = extractThirdPartySummary(psiAudit);

      expect(summary).to.deep.equal([
        {
          entity: 'ExampleEntity',
          blockingTime: 200,
          mainThreadTime: 1000,
          transferSize: 1024,
        },
      ]);
    });

    it('returns an empty array if third party summary details are absent', () => {
      const psiAudit = {};

      const summary = extractThirdPartySummary(psiAudit);

      expect(summary).to.be.an('array').that.is.empty;
    });
  });

  describe('extractCSP', () => {
    it('extracts CSP correctly', () => {
      const psiAudit = {
        'csp-xss': {
          id: 'csp-xss',
          title: 'Ensure CSP is effective against XSS attacks',
          description: 'A strong Content Security Policy (CSP) significantly reduces the risk of cross-site scripting (XSS) attacks. [Learn how to use a CSP to prevent XSS](https://developer.chrome.com/docs/lighthouse/best-practices/csp-xss/)',
          details: {
            type: 'table',
            items: [
              {
                severity: 'High',
                description: 'No CSP found in enforcement mode',
              },
            ],
          },
        },
      };

      const csp = extractCSP(psiAudit);

      expect(csp).to.deep.equal([
        {
          severity: 'High',
          description: 'No CSP found in enforcement mode',
        },
      ]);
    });

    it('extracts CSP with subitems correctly', () => {
      const psiAudit = {
        'csp-xss': {
          details: {
            items: [
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
            ],
          },
        },
      };

      const csp = extractCSP(psiAudit);

      expect(csp).to.deep.equal([
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
      ]);
    });

    it('returns an empty array if csp-xss details are absent', () => {
      const psiAudit = {};

      const csp = extractCSP(psiAudit);

      expect(csp).to.be.an('array').that.is.empty;
    });
  });

  describe('getContentLastModified', () => {
    const lastModifiedDate = 'Tue, 05 Dec 2023 20:08:48 GMT';
    const expectedDate = new Date(lastModifiedDate).toISOString();
    let logSpy;

    beforeEach(() => {
      logSpy = { error: sinon.spy() };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('returns last modified date on successful fetch', async () => {
      nock('https://www.site1.com')
        .head('/')
        .reply(200, '', { 'last-modified': lastModifiedDate });

      const result = await getContentLastModified('https://www.site1.com', logSpy);

      expect(result).to.equal(expectedDate);
    });

    it('returns current date when last modified date is not present', async () => {
      nock('https://www.site2.com')
        .head('/')
        .reply(200, '', { 'last-modified': null });

      const result = await getContentLastModified('https://www.site2.com', logSpy);

      expect(result).to.not.equal(expectedDate);
    });

    it('returns current date and logs error on fetch failure', async () => {
      nock('https://www.site3.com')
        .head('/')
        .replyWithError('Network error');

      const result = await getContentLastModified('https://www.site3.com', logSpy);

      expect(result).to.not.equal(expectedDate);
      expect(isIsoDate(result)).to.be.true;
      expect(logSpy.error.calledOnce).to.be.true;
    });

    it('returns current date and logs error on non-OK response', async () => {
      nock('https://www.site4.com')
        .head('/')
        .reply(404);

      const result = await getContentLastModified('https://www.site4.com', logSpy);

      expect(result).to.not.equal(expectedDate);
      expect(isIsoDate(result)).to.be.true;
      expect(logSpy.error.calledOnce).to.be.true;
    });
  });
});
