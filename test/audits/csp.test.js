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
import { load as cheerioLoad } from 'cheerio';

import { Audit } from '@adobe/spacecat-shared-data-access';
import { isIsoDate } from '@adobe/spacecat-shared-utils';
import createLHSAuditRunner from '../../src/lhs/lib.js';
import { MockContextBuilder } from '../shared.js';
import { cspOpportunityAndSuggestions } from '../../src/csp/csp.js';
import { cspAutoSuggest } from '../../src/csp/csp-auto-suggest.js';

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

function normalizeTag(html) {
  const $ = cheerioLoad(html);
  return $.html($('script')[0]);
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

  // Sample page content (extracted from aem.live)
  const htmlContentHead = '<!-- v7 -->\n'
      + '\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n'
      + '<script src="/scripts/lib-franklin.js" type="module"></script>\n'
      + '<script src="/scripts/scripts.js" type="module"></script>\n'
      + '<script src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>\n'
      + '<link rel="stylesheet" href="/styles/styles.css"/>\n';
  const htmlContent404 = '<!DOCTYPE html>\n'
      + '<html>\n'
      + '\n'
      + '<head>\n'
      + '  \n'
      + '  <title>Page not found</title>\n'
      + '  <script type="text/javascript">\n'
      + '    window.isErrorPage = true;\n'
      + '    window.errorCode = \'404\';\n'
      + '  </script>\n'
      + '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + '  <meta property="og:title" content="Page not found">\n'
      + '  <script src="/scripts/scripts.js" type="module" crossorigin="use-credentials"></script>\n'
      + '  <script type="module">\n'
      + '    window.addEventListener(\'load\', () => {\n'
      + '      if (document.referrer) {\n'
      + '        const { origin, pathname } = new URL(document.referrer);\n'
      + '        if (origin === window.location.origin) {\n'
      + '          const backBtn = document.createElement(\'a\');\n'
      + '          backBtn.classList.add(\'button\', \'error-button-back\');\n'
      + '          backBtn.href = pathname;\n'
      + '          backBtn.textContent = \'Go back\';\n'
      + '          backBtn.title = \'Go back\';\n'
      + '          const btnContainer = document.querySelector(\'.button-container\');\n'
      + '          btnContainer.append(backBtn);\n'
      + '        }\n'
      + '      }\n'
      + '    });\n'
      + '  </script>\n'
      + '  <script type="module">\n'
      + '    import { sampleRUM } from \'/scripts/lib-franklin.js\';\n'
      + '    import { applyRedirects } from \'/scripts/redirects.js\';\n'
      + '    await applyRedirects();\n'
      + '    sampleRUM(\'404\', { source: document.referrer });\n'
      + '  </script>\n'
      + '  <link rel="stylesheet" href="/styles/styles.css">\n'
      + '  <style>\n'
      + '    main.error {\n'
      + '      min-height: calc(100vh - var(--nav-height));\n'
      + '      display: flex;\n'
      + '      align-items: center;\n'
      + '    }\n'
      + '\n'
      + '    main.error .error-number {\n'
      + '      width: 100%;\n'
      + '    }\n'
      + '\n'
      + '    main.error .error-number text {\n'
      + '      font-family: monospace;\n'
      + '    }\n'
      + '  </style>\n'
      + '  <link rel="stylesheet" href="/styles/lazy-styles.css">\n'
      + '</head>\n'
      + '\n'
      + '<body>\n'
      + '  <header></header>\n'
      + '  <main class="error">\n'
      + '    <div class="section">\n'
      + '      <svg viewBox="1 0 38 18" class="error-number">\n'
      + '        <text x="0" y="17">404</text>\n'
      + '      </svg>\n'
      + '      <h2 class="error-message">Page Not Found</h2>\n'
      + '      <p class="button-container">\n'
      + '        <a href="/" class="button secondary error-button-home">Go home</a>\n'
      + '      </p>\n'
      + '    </div>\n'
      + '  </main>\n'
      + '  <footer></footer>\n'
      + '</body>\n'
      + '\n'
      + '</html>';

  const htmlContentHeadWithMultilineScript = '<!-- v7 -->\n'
      + '\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n'
      + '<script \n '
      + '  src="/scripts/lib-franklin.js" \n'
      + '  type="module">\n'
      + '</script>\n'
      + '<script src="/scripts/scripts.js" type="module"></script>\n'
      + '<script src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>\n'
      + '<link rel="stylesheet" href="/styles/styles.css"/>\n';
  const htmlContentHeadWithExistingNonce = '<!-- v7 -->\n'
      + '\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n'
      + '<script nonce="aem" src="/scripts/lib-franklin.js" type="module"></script>\n'
      + '<script nonce="aem" src="/scripts/scripts.js" type="module"></script>\n'
      + '<script \n'
      + '  nonce="aem" \n'
      + '  src="/scripts/indexing-test.js?date=2024-08-16" \n'
      + '  type="module"></script>\n'
      + '<link rel="stylesheet" href="/styles/styles.css"/>\n';

  let cspSite;
  let auditData;
  let opportunityStub;
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
    expect(cspOpportunity.addSuggestions).to.not.have.been.called;
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
    cspSite.getDeliveryType = () => 'other';

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
          findings: [
            {
              type: 'csp-header',
            },
            {
              type: 'static-content',
              url: 'https://adobe.com/head.html',
              findings: [
                {
                  scriptContent: '<script src="/scripts/lib-franklin.js" type="module"></script>',
                  suggestedContent: '<script nonce="aem" src="/scripts/lib-franklin.js" type="module"></script>',
                  lineNumber: 4,
                },
                {
                  scriptContent: '<script src="/scripts/scripts.js" type="module"></script>',
                  suggestedContent: '<script nonce="aem" src="/scripts/scripts.js" type="module"></script>',
                  lineNumber: 5,
                },
                {
                  scriptContent: '<script src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>',
                  suggestedContent: '<script nonce="aem" src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>',
                  lineNumber: 6,
                },
              ],
              suggestedBody: '<!-- v7 -->\n\n<meta name="viewport" content="width=device-width, initial-scale=1"/>\n<script nonce="aem" src="/scripts/lib-franklin.js" type="module"></script>\n<script nonce="aem" src="/scripts/scripts.js" type="module"></script>\n<script nonce="aem" src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>\n<link rel="stylesheet" href="/styles/styles.css"/>\n',
            },
            {
              type: 'static-content',
              url: 'https://adobe.com/404.html',
              findings: [
                {
                  scriptContent: "<script type=\"text/javascript\">\n    window.isErrorPage = true;\n    window.errorCode = '404';\n  </script>",
                  suggestedContent: "<script nonce=\"aem\" type=\"text/javascript\">\n    window.isErrorPage = true;\n    window.errorCode = '404';\n  </script>",
                  lineNumber: 7,
                },
                {
                  scriptContent: '<script src="/scripts/scripts.js" type="module" crossorigin="use-credentials"></script>',
                  suggestedContent: '<script nonce="aem" src="/scripts/scripts.js" type="module" crossorigin="use-credentials"></script>',
                  lineNumber: 13,
                },
                {
                  scriptContent: "<script type=\"module\">\n    window.addEventListener('load', () => {\n      if (document.referrer) {\n        const { origin, pathname } = new URL(document.referrer);\n        if (origin === window.location.origin) {\n          const backBtn = document.createElement('a');\n          backBtn.classList.add('button', 'error-button-back');\n          backBtn.href = pathname;\n          backBtn.textContent = 'Go back';\n          backBtn.title = 'Go back';\n          const btnContainer = document.querySelector('.button-container');\n          btnContainer.append(backBtn);\n        }\n      }\n    });\n  </script>",
                  suggestedContent: "<script nonce=\"aem\" type=\"module\">\n    window.addEventListener('load', () => {\n      if (document.referrer) {\n        const { origin, pathname } = new URL(document.referrer);\n        if (origin === window.location.origin) {\n          const backBtn = document.createElement('a');\n          backBtn.classList.add('button', 'error-button-back');\n          backBtn.href = pathname;\n          backBtn.textContent = 'Go back';\n          backBtn.title = 'Go back';\n          const btnContainer = document.querySelector('.button-container');\n          btnContainer.append(backBtn);\n        }\n      }\n    });\n  </script>",
                  lineNumber: 14,
                },
                {
                  scriptContent: "<script type=\"module\">\n    import { sampleRUM } from '/scripts/lib-franklin.js';\n    import { applyRedirects } from '/scripts/redirects.js';\n    await applyRedirects();\n    sampleRUM('404', { source: document.referrer });\n  </script>",
                  suggestedContent: "<script nonce=\"aem\" type=\"module\">\n    import { sampleRUM } from '/scripts/lib-franklin.js';\n    import { applyRedirects } from '/scripts/redirects.js';\n    await applyRedirects();\n    sampleRUM('404', { source: document.referrer });\n  </script>",
                  lineNumber: 30,
                },
              ],
              suggestedBody: "<!DOCTYPE html>\n<html>\n\n<head>\n  \n  <title>Page not found</title>\n  <script nonce=\"aem\" type=\"text/javascript\">\n    window.isErrorPage = true;\n    window.errorCode = '404';\n  </script>\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta property=\"og:title\" content=\"Page not found\">\n  <script nonce=\"aem\" src=\"/scripts/scripts.js\" type=\"module\" crossorigin=\"use-credentials\"></script>\n  <script nonce=\"aem\" type=\"module\">\n    window.addEventListener('load', () => {\n      if (document.referrer) {\n        const { origin, pathname } = new URL(document.referrer);\n        if (origin === window.location.origin) {\n          const backBtn = document.createElement('a');\n          backBtn.classList.add('button', 'error-button-back');\n          backBtn.href = pathname;\n          backBtn.textContent = 'Go back';\n          backBtn.title = 'Go back';\n          const btnContainer = document.querySelector('.button-container');\n          btnContainer.append(backBtn);\n        }\n      }\n    });\n  </script>\n  <script nonce=\"aem\" type=\"module\">\n    import { sampleRUM } from '/scripts/lib-franklin.js';\n    import { applyRedirects } from '/scripts/redirects.js';\n    await applyRedirects();\n    sampleRUM('404', { source: document.referrer });\n  </script>\n  <link rel=\"stylesheet\" href=\"/styles/styles.css\">\n  <style>\n    main.error {\n      min-height: calc(100vh - var(--nav-height));\n      display: flex;\n      align-items: center;\n    }\n\n    main.error .error-number {\n      width: 100%;\n    }\n\n    main.error .error-number text {\n      font-family: monospace;\n    }\n  </style>\n  <link rel=\"stylesheet\" href=\"/styles/lazy-styles.css\">\n</head>\n\n<body>\n  <header></header>\n  <main class=\"error\">\n    <div class=\"section\">\n      <svg viewBox=\"1 0 38 18\" class=\"error-number\">\n        <text x=\"0\" y=\"17\">404</text>\n      </svg>\n      <h2 class=\"error-message\">Page Not Found</h2>\n      <p class=\"button-container\">\n        <a href=\"/\" class=\"button secondary error-button-home\">Go home</a>\n      </p>\n    </div>\n  </main>\n  <footer></footer>\n</body>\n\n</html>",
            }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, htmlContentHead);
      nock('https://adobe.com').get('/404.html').reply(200, htmlContent404);

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(normalizeTag(cspResult)).to.deep.equal(normalizeTag(expectedCsp));

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
          findings: [
            {
              type: 'csp-header',
            },
            {
              type: 'static-content',
              url: 'https://adobe.com/head.html',
              findings: [
                {
                  scriptContent: '<script \n   src="/scripts/lib-franklin.js" \n  type="module">\n</script>',
                  suggestedContent: '<script nonce="aem" \n   src="/scripts/lib-franklin.js" \n  type="module">\n</script>',
                  lineNumber: 4,
                },
                {
                  scriptContent: '<script src="/scripts/scripts.js" type="module"></script>',
                  suggestedContent: '<script nonce="aem" src="/scripts/scripts.js" type="module"></script>',
                  lineNumber: 8,
                },
                {
                  scriptContent: '<script src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>',
                  suggestedContent: '<script nonce="aem" src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>',
                  lineNumber: 9,
                },
              ],
              suggestedBody: '<!-- v7 -->\n\n<meta name="viewport" content="width=device-width, initial-scale=1"/>\n<script nonce="aem" \n   src="/scripts/lib-franklin.js" \n  type="module">\n</script>\n<script nonce="aem" src="/scripts/scripts.js" type="module"></script>\n<script nonce="aem" src="/scripts/indexing-test.js?date=2024-08-16" type="module"></script>\n<link rel="stylesheet" href="/styles/styles.css"/>\n',
            }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, htmlContentHeadWithMultilineScript);
      nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(normalizeTag(cspResult)).to.deep.equal(normalizeTag(expectedCsp));

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
          findings: [{ type: 'csp-header' }],
        },
      ];

      nock('https://adobe.com').get('/head.html').reply(200, htmlContentHeadWithExistingNonce);
      nock('https://adobe.com').get('/404.html').reply(200, '');

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(context.log.error).not.to.have.been.calledWithMatch(sinon.match('Error fetching one or more pages. Skipping CSP auto-suggest.'));
    });

    it('auto-identify info is returned for complex CSP findings', async () => {
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
      const expectedCsp = csp;

      const scopeHead = nock('https://adobe.com').get('/head.html').reply(200);
      const scope404 = nock('https://adobe.com').get('/404.html').reply(200);

      const cspResult = await cspAutoSuggest(siteUrl, csp, context, cspSite);
      expect(cspResult).to.deep.equal(expectedCsp);

      expect(scopeHead.isDone()).to.equal(false);
      expect(scope404.isDone()).to.equal(false);

      expect(context.log.info).to.have.been.calledWithMatch(sinon.match('Complex CSP finding. Skipping CSP auto-suggest.'));
    });

    it('auto-identify info is returned if auto-suggestion fails', async () => {
      sinon.replace(configuration, 'isHandlerEnabledForSite', (toggle) => toggle === 'security-csp-auto-suggest');
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

      expect(scopeHead.isDone()).to.equal(true);
      expect(scope404.isDone()).to.equal(true);

      expect(context.log.error).to.have.been.calledWithMatch(sinon.match('[security-csp] [Site: some-site-id]: Error downloading page /head.html'));
      expect(context.log.error).to.have.been.calledWithMatch(sinon.match('[security-csp] [Site: some-site-id]: Error downloading page /404.html'));
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
