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

// eslint-disable-next-line max-classes-per-file
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('Preflight Headings - Selector Coverage Tests', () => {
  let context;
  let site;
  let job;
  let s3Client;
  let configuration;
  let mockDomSelector;
  let mockHeadingsHandler;

  beforeEach(async () => {
    mockDomSelector = {
      getDomElementSelector: sinon.stub(),
      toElementTargets: sinon.stub(),
    };

    // Mock headings handler to return checks with transformRules
    mockHeadingsHandler = {
      validatePageHeadingFromScrapeJson: sinon.stub(),
      getBrandGuidelines: sinon.stub().resolves({}),
      getH1HeadingASuggestion: sinon.stub().resolves('AI suggestion'),
      HEADINGS_CHECKS: {
        HEADING_MISSING_H1: { check: 'heading-missing-h1' },
        HEADING_MULTIPLE_H1: { check: 'heading-multiple-h1' },
        HEADING_H1_LENGTH: { check: 'heading-h1-length' },
        HEADING_EMPTY: { check: 'heading-empty' },
      },
    };

    s3Client = {
      send: sinon.stub().callsFake((command) => {
        if (command.input?.Prefix) {
          return Promise.resolve({
            Contents: [
              { Key: 'scrapes/site-123/page1/scrape.json' },
            ],
            IsTruncated: false,
          });
        }
        return Promise.resolve({
          ContentType: 'application/json',
          Body: {
            transformToString: sinon.stub().resolves(JSON.stringify({
              scrapeResult: {
                rawBody: '<body><h1>Test</h1></body>',
              },
              finalUrl: 'https://main--example--page.aem.page/page1',
            })),
          },
        });
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sinon.createSandbox())
      .withOverrides({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.stub(),
        },
        s3Client,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          AUDIT_JOBS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
          CONTENT_SCRAPER_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/scraper-queue',
        },
        sqs: {
          sendMessage: sinon.stub().resolves(),
        },
      })
      .build();

    site = context.site;
    job = context.dataAccess.AsyncJob();

    job.getId = sinon.stub().returns('job-123');
    job.getStatus = sinon.stub().returns('IN_PROGRESS');
    job.getMetadata = sinon.stub().returns({
      payload: {
        urls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        enableAuthentication: false,
      },
    });
    job.setResult = sinon.stub();
    job.setStatus = sinon.stub();
    job.setEndedAt = sinon.stub();
    job.setMetadata = sinon.stub();
    job.setResultType = sinon.stub();
    job.save = sinon.stub().resolves();

    context.job = job;
    context.dataAccess.AsyncJob.findById = sinon.stub().resolves(job);

    configuration = {
      isHandlerEnabledForSite: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'headings-preflight': { productCodes: ['aem-sites'] },
      }),
    };
    context.dataAccess.Configuration.findLatest.resolves(configuration);

    const mockTierClient = {
      checkValidEntitlement: sinon.stub().resolves({ entitlement: true }),
    };
    if (TierClient.createForSite && TierClient.createForSite.restore) {
      TierClient.createForSite.restore();
    }
    sinon.stub(TierClient, 'createForSite').resolves(mockTierClient);

    configuration.isHandlerEnabledForSite
      .withArgs('headings-preflight', site)
      .returns(true);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getElementsFromCheck - selector generation from HTML', () => {
    it('should return empty object when scrapeJsonObject has no rawBody', async () => {
      // Setup check without rawBody in scrapeJsonObject
      const checkWithoutRawBody = {
        success: false,
        check: 'heading-missing-h1',
        checkTitle: 'Missing H1',
        description: 'No H1 found',
        explanation: 'Add an H1',
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithoutRawBody],
      });

      mockDomSelector.toElementTargets.returns({});

      const headingsModule = await esmock('../../src/preflight/headings.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/headings/handler.js': mockHeadingsHandler,
        '../../src/metatags/seo-checks.js': {
          default: class {
            // eslint-disable-next-line class-methods-use-this
            getFewHealthyTags() {
              return { title: [], description: [], h1: [] };
            }
          },
        },
      });

      const auditContext = {
        previewUrls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        audits: new Map([
          ['https://main--example--page.aem.page/page1', {
            audits: [],
          }],
        ]),
        auditsResult: [{
          pageUrl: 'https://main--example--page.aem.page/page1',
          audits: [],
        }],
        scrapedObjects: [{
          data: {
            scrapeResult: {
              // No rawBody
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      const testAudit = auditContext.audits.get('https://main--example--page.aem.page/page1')
        .audits.find((a) => a.name === 'headings');
      expect(testAudit.opportunities).to.have.lengthOf(1);
      expect(testAudit.opportunities[0]).to.not.have.property('elements');
      expect(testAudit.opportunities[0]).to.not.have.property('selector');
    });

    it('should generate selectors from HTML for heading-multiple-h1 check', async () => {
      // Setup check without transformRules - should generate selectors from HTML
      const checkWithoutSelectors = {
        success: false,
        check: 'heading-multiple-h1',
        checkTitle: 'Multiple H1 Tags',
        description: 'Found multiple H1 tags',
        explanation: 'Use only one H1 per page',
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithoutSelectors],
      });

      mockDomSelector.getDomElementSelector.onFirstCall().returns('body > h1:nth-of-type(1)');
      mockDomSelector.getDomElementSelector.onSecondCall().returns('body > h1:nth-of-type(2)');
      mockDomSelector.toElementTargets.returns({
        elements: [
          { selector: 'body > h1:nth-of-type(1)' },
          { selector: 'body > h1:nth-of-type(2)' },
        ],
      });

      const headingsModule = await esmock('../../src/preflight/headings.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/headings/handler.js': mockHeadingsHandler,
        '../../src/metatags/seo-checks.js': {
          default: class {
            // eslint-disable-next-line class-methods-use-this
            getFewHealthyTags() {
              return { title: [], description: [], h1: [] };
            }
          },
        },
      });

      const auditContext = {
        previewUrls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        audits: new Map([
          ['https://main--example--page.aem.page/page1', {
            audits: [],
          }],
        ]),
        auditsResult: [{
          pageUrl: 'https://main--example--page.aem.page/page1',
          audits: [],
        }],
        scrapedObjects: [{
          data: {
            scrapeResult: {
              rawBody: '<body><h1>First H1</h1><h1>Second H1</h1></body>',
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      // Verify getDomElementSelector was called for each H1
      expect(mockDomSelector.getDomElementSelector).to.have.been.called;
      // Verify toElementTargets was called with generated selectors
      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(
        ['body > h1:nth-of-type(1)', 'body > h1:nth-of-type(2)'],
      );
    });

    it('should generate selectors for heading-empty check when tagName is provided', async () => {
      // Setup heading-empty check with tagName
      const checkWithTagName = {
        success: false,
        check: 'heading-empty',
        checkTitle: 'Empty Heading',
        description: 'Heading is empty',
        explanation: 'Add content to heading',
        tagName: 'h1',
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithTagName],
      });

      // Mock getDomElementSelector to return a selector for the empty h1
      mockDomSelector.getDomElementSelector.returns('body > h1');
      mockDomSelector.toElementTargets.returns({
        elements: [{ selector: 'body > h1' }],
      });

      const headingsModule = await esmock('../../src/preflight/headings.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/headings/handler.js': mockHeadingsHandler,
        '../../src/metatags/seo-checks.js': {
          default: class {
            // eslint-disable-next-line class-methods-use-this
            getFewHealthyTags() {
              return { title: [], description: [], h1: [] };
            }
          },
        },
      });

      const auditContext = {
        previewUrls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        audits: new Map([
          ['https://main--example--page.aem.page/page1', {
            audits: [],
          }],
        ]),
        auditsResult: [{
          pageUrl: 'https://main--example--page.aem.page/page1',
          audits: [],
        }],
        scrapedObjects: [{
          data: {
            scrapeResult: {
              rawBody: '<body><h1></h1></body>',
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      // Verify getDomElementSelector was called for the empty heading
      expect(mockDomSelector.getDomElementSelector).to.have.been.called;
      // Verify toElementTargets was called with the generated selector
      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(['body > h1']);
    });

    it('should use transformRules.selector for unknown check types as fallback', async () => {
      // Setup check with an unknown check type that has transformRules
      const checkWithTransformRules = {
        success: false,
        check: 'heading-custom-check', // Unknown check type
        checkTitle: 'Custom Heading Issue',
        description: 'Custom heading validation failed',
        explanation: 'Fix the custom issue',
        transformRules: {
          selector: 'h2.custom-heading',
          action: 'replace',
        },
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithTransformRules],
      });

      // Return mock elements
      mockDomSelector.toElementTargets.returns({
        elements: [{ selector: 'h2.custom-heading' }],
      });

      const headingsModule = await esmock('../../src/preflight/headings.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/headings/handler.js': mockHeadingsHandler,
        '../../src/metatags/seo-checks.js': {
          default: class {
            // eslint-disable-next-line class-methods-use-this
            getFewHealthyTags() {
              return { title: [], description: [], h1: [] };
            }
          },
        },
      });

      const auditContext = {
        previewUrls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        audits: new Map([
          ['https://main--example--page.aem.page/page1', {
            audits: [],
          }],
        ]),
        auditsResult: [{
          pageUrl: 'https://main--example--page.aem.page/page1',
          audits: [],
        }],
        scrapedObjects: [{
          data: {
            scrapeResult: {
              rawBody: '<body><h2 class="custom-heading">Custom Heading</h2></body>',
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      // Verify toElementTargets was called with [transformRules.selector] for unknown check types
      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(['h2.custom-heading']);
    });

    it('should generate selectors for heading-h1-length check', async () => {
      // Setup heading-h1-length check
      const checkH1Length = {
        success: false,
        check: 'heading-h1-length',
        checkTitle: 'H1 Length Issue',
        description: 'H1 is too long',
        explanation: 'Shorten the H1',
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkH1Length],
      });

      mockDomSelector.getDomElementSelector.returns('body > h1');
      mockDomSelector.toElementTargets.returns({
        elements: [{ selector: 'body > h1' }],
      });

      const headingsModule = await esmock('../../src/preflight/headings.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/headings/handler.js': mockHeadingsHandler,
        '../../src/metatags/seo-checks.js': {
          default: class {
            // eslint-disable-next-line class-methods-use-this
            getFewHealthyTags() {
              return { title: [], description: [], h1: [] };
            }
          },
        },
      });

      const auditContext = {
        previewUrls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        audits: new Map([
          ['https://main--example--page.aem.page/page1', {
            audits: [],
          }],
        ]),
        auditsResult: [{
          pageUrl: 'https://main--example--page.aem.page/page1',
          audits: [],
        }],
        scrapedObjects: [{
          data: {
            scrapeResult: {
              rawBody: '<body><h1>This is a very long H1 heading that exceeds the recommended length</h1></body>',
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      expect(mockDomSelector.getDomElementSelector).to.have.been.called;
      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(['body > h1']);
    });

    it('should use transformRules.selector for heading-order-invalid check', async () => {
      // Setup heading-order-invalid check with transformRules
      const checkOrderInvalid = {
        success: false,
        check: 'heading-order-invalid',
        checkTitle: 'Invalid Heading Order',
        description: 'Heading order is invalid',
        explanation: 'Fix heading order',
        transformRules: {
          selector: 'h3.skipped-level',
          action: 'replaceWith',
        },
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkOrderInvalid],
      });

      mockDomSelector.toElementTargets.returns({
        elements: [{ selector: 'h3.skipped-level' }],
      });

      const headingsModule = await esmock('../../src/preflight/headings.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/headings/handler.js': mockHeadingsHandler,
        '../../src/metatags/seo-checks.js': {
          default: class {
            // eslint-disable-next-line class-methods-use-this
            getFewHealthyTags() {
              return { title: [], description: [], h1: [] };
            }
          },
        },
      });

      const auditContext = {
        previewUrls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        audits: new Map([
          ['https://main--example--page.aem.page/page1', {
            audits: [],
          }],
        ]),
        auditsResult: [{
          pageUrl: 'https://main--example--page.aem.page/page1',
          audits: [],
        }],
        scrapedObjects: [{
          data: {
            scrapeResult: {
              rawBody: '<body><h1>Title</h1><h3 class="skipped-level">Skipped H2</h3></body>',
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(['h3.skipped-level']);
    });

    it('should use check.selectors for unknown check types with selectors array', async () => {
      // Setup unknown check type with selectors array
      const checkWithSelectorsArray = {
        success: false,
        check: 'heading-unknown-check',
        checkTitle: 'Unknown Check',
        description: 'Unknown issue',
        explanation: 'Fix unknown issue',
        selectors: ['h2:nth-of-type(1)', 'h2:nth-of-type(2)'],
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithSelectorsArray],
      });

      mockDomSelector.toElementTargets.returns({
        elements: [
          { selector: 'h2:nth-of-type(1)' },
          { selector: 'h2:nth-of-type(2)' },
        ],
      });

      const headingsModule = await esmock('../../src/preflight/headings.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/headings/handler.js': mockHeadingsHandler,
        '../../src/metatags/seo-checks.js': {
          default: class {
            // eslint-disable-next-line class-methods-use-this
            getFewHealthyTags() {
              return { title: [], description: [], h1: [] };
            }
          },
        },
      });

      const auditContext = {
        previewUrls: ['https://main--example--page.aem.page/page1'],
        step: 'identify',
        audits: new Map([
          ['https://main--example--page.aem.page/page1', {
            audits: [],
          }],
        ]),
        auditsResult: [{
          pageUrl: 'https://main--example--page.aem.page/page1',
          audits: [],
        }],
        scrapedObjects: [{
          data: {
            scrapeResult: {
              rawBody: '<body><h2>First H2</h2><h2>Second H2</h2></body>',
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(['h2:nth-of-type(1)', 'h2:nth-of-type(2)']);
    });
  });
});
