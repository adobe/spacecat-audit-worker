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

  describe('getElementsFromCheck - transformRules.selector branch (line 43)', () => {
    it('should use check.selectors when transformRules.selector is not present', async () => {
      // Setup check without transformRules but with selectors to test the selectors branch
      const checkWithSelectors = {
        success: false,
        check: 'heading-multiple-h1',
        checkTitle: 'Multiple H1 Tags',
        description: 'Found multiple H1 tags',
        explanation: 'Use only one H1 per page',
        selectors: ['h1:nth-of-type(1)', 'h1:nth-of-type(2)'],
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithSelectors],
      });

      mockDomSelector.toElementTargets.returns([
        { selector: 'h1:nth-of-type(1)' },
        { selector: 'h1:nth-of-type(2)' },
      ]);

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

      // Verify toElementTargets was called with check.selectors
      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(
        ['h1:nth-of-type(1)', 'h1:nth-of-type(2)'],
      );
    });

    it('should return undefined when neither selectors nor transformRules are present', async () => {
      // Setup check without selectors or transformRules
      const checkWithoutSelectors = {
        success: false,
        check: 'heading-empty',
        checkTitle: 'Empty Heading',
        description: 'Heading is empty',
        explanation: 'Add content to heading',
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithoutSelectors],
      });

      // Return empty array to indicate no elements
      mockDomSelector.toElementTargets.returns([]);

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

      // Verify toElementTargets was called with []
      expect(mockDomSelector.toElementTargets).to.have.been.calledWith([]);
    });

    it('should use transformRules.selector when check.selectors is not present', async () => {
      // Setup check with transformRules but no selectors
      const checkWithTransformRules = {
        success: false,
        check: 'heading-h1-length',
        checkTitle: 'H1 Too Long',
        description: 'H1 exceeds recommended length',
        explanation: 'Shorten the H1',
        transformRules: {
          selector: 'h1.long-heading',
          action: 'replace',
        },
      };

      mockHeadingsHandler.validatePageHeadingFromScrapeJson.resolves({
        url: 'https://main--example--page.aem.page/page1',
        checks: [checkWithTransformRules],
      });

      // Return mock elements
      mockDomSelector.toElementTargets.returns([{ selector: 'h1.long-heading' }]);

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
              rawBody: '<body><h1 class="long-heading">Very Long H1 Heading Text</h1></body>',
            },
            finalUrl: 'https://main--example--page.aem.page/page1',
          },
        }],
        timeExecutionBreakdown: [],
      };

      await headingsModule.default(context, auditContext);

      // Verify toElementTargets was called with [transformRules.selector]
      expect(mockDomSelector.toElementTargets).to.have.been.calledWith(['h1.long-heading']);
    });
  });
});
