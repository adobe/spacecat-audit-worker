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
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('Preflight Links - Insecure Links Coverage Tests', () => {
  let context;
  let site;
  let job;
  let s3Client;
  let preflightAuditFunction;
  let configuration;
  let mockDomSelector;

  beforeEach(async () => {
    mockDomSelector = {
      getDomElementSelector: sinon.stub().returns('a[href]'),
      toElementTargets: sinon.stub().returns([{ selector: 'a[href]' }]),
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
                rawBody: '<body><a href="http://example.com">Link</a></body>',
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
        'links-preflight': { productCodes: ['aem-sites'] },
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
      .withArgs('links-preflight', site)
      .returns(true);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Insecure Links - URL normalization fallback (lines 218-219)', () => {
    it('should handle valid HTTP URLs and normalize them correctly', async () => {
      const mockScrapeJson = {
        scrapeResult: {
          // Valid HTTP URL that can be normalized
          rawBody: '<body><a href="http://example.com/path?query=1">Insecure Link</a></body>',
        },
        finalUrl: 'https://main--example--page.aem.page/page1',
      };

      s3Client.send.callsFake((command) => {
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
            transformToString: sinon.stub().resolves(JSON.stringify(mockScrapeJson)),
          },
        });
      });

      mockDomSelector.getDomElementSelector.returns('body > a');
      mockDomSelector.toElementTargets.returns([{ selector: 'body > a' }]);

      const mockLinksChecks = {
        runLinksChecks: sinon.stub().resolves({
          auditResult: {
            brokenInternalLinks: [],
            brokenExternalLinks: [],
          },
        }),
      };

      const module = await esmock('../../src/preflight/handler.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/preflight/links-checks.js': mockLinksChecks,
      });

      preflightAuditFunction = module.preflightAudit;

      await preflightAuditFunction(context);

      const result = job.setResult.getCall(0).args[0];
      const linksAudit = result[0].audits.find((a) => a.name === 'links');

      expect(linksAudit).to.exist;
      // Find the bad-links opportunity specifically (there may be other opportunities)
      const badLinksOpportunity = linksAudit.opportunities.find((o) => o.check === 'bad-links');
      expect(badLinksOpportunity).to.exist;
      expect(badLinksOpportunity.issue).to.have.lengthOf(1);
      // Verify the URL was normalized correctly
      expect(badLinksOpportunity.issue[0].url).to.equal('http://example.com/path?query=1');
    });

    it('should fallback to original href when URL normalization fails', async () => {
      const mockScrapeJson = {
        scrapeResult: {
          // Invalid URL that will throw when constructing URL object
          rawBody: '<body><a href="http://[invalid-url">Invalid HTTP Link</a></body>',
        },
        finalUrl: 'https://main--example--page.aem.page/page1',
      };

      s3Client.send.callsFake((command) => {
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
            transformToString: sinon.stub().resolves(JSON.stringify(mockScrapeJson)),
          },
        });
      });

      mockDomSelector.getDomElementSelector.returns('body > a');
      mockDomSelector.toElementTargets.returns([{ selector: 'body > a' }]);

      const mockLinksChecks = {
        runLinksChecks: sinon.stub().resolves({
          auditResult: {
            brokenInternalLinks: [],
            brokenExternalLinks: [],
          },
        }),
      };

      const module = await esmock('../../src/preflight/handler.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/preflight/links-checks.js': mockLinksChecks,
      });

      preflightAuditFunction = module.preflightAudit;

      await preflightAuditFunction(context);

      const result = job.setResult.getCall(0).args[0];
      const linksAudit = result[0].audits.find((a) => a.name === 'links');

      expect(linksAudit).to.exist;
      // Find the bad-links opportunity specifically
      const badLinksOpportunity = linksAudit.opportunities.find((o) => o.check === 'bad-links');
      expect(badLinksOpportunity).to.exist;
      expect(badLinksOpportunity.issue).to.have.lengthOf(1);
      // Verify the URL fallback to original href when normalization fails
      expect(badLinksOpportunity.issue[0].url).to.equal('http://[invalid-url');
    });

    it('should detect multiple insecure HTTP links on a page', async () => {
      const mockScrapeJson = {
        scrapeResult: {
          rawBody: `
            <body>
              <a href="http://example.com">Link 1</a>
              <a href="http://test.com">Link 2</a>
              <a href="http://invalid[url">Link 3</a>
            </body>
          `,
        },
        finalUrl: 'https://main--example--page.aem.page/page1',
      };

      s3Client.send.callsFake((command) => {
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
            transformToString: sinon.stub().resolves(JSON.stringify(mockScrapeJson)),
          },
        });
      });

      mockDomSelector.getDomElementSelector.returns('a');
      mockDomSelector.toElementTargets.returns([{ selector: 'a' }]);

      const mockLinksChecks = {
        runLinksChecks: sinon.stub().resolves({
          auditResult: {
            brokenInternalLinks: [],
            brokenExternalLinks: [],
          },
        }),
      };

      const module = await esmock('../../src/preflight/handler.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/preflight/links-checks.js': mockLinksChecks,
      });

      preflightAuditFunction = module.preflightAudit;

      await preflightAuditFunction(context);

      const result = job.setResult.getCall(0).args[0];
      const linksAudit = result[0].audits.find((a) => a.name === 'links');

      expect(linksAudit).to.exist;
      // Find the bad-links opportunity specifically
      const badLinksOpportunity = linksAudit.opportunities.find((o) => o.check === 'bad-links');
      expect(badLinksOpportunity).to.exist;
      expect(badLinksOpportunity.issue).to.have.lengthOf(3);

      // Verify all three links are reported
      const urls = badLinksOpportunity.issue.map((i) => i.url);
      expect(urls).to.include('http://example.com/');
      expect(urls).to.include('http://test.com/');
      expect(urls).to.include('http://invalid[url');
    });

    it('should not report HTTPS links as insecure', async () => {
      const mockScrapeJson = {
        scrapeResult: {
          rawBody: '<body><a href="https://example.com">Secure Link</a></body>',
        },
        finalUrl: 'https://main--example--page.aem.page/page1',
      };

      s3Client.send.callsFake((command) => {
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
            transformToString: sinon.stub().resolves(JSON.stringify(mockScrapeJson)),
          },
        });
      });

      const mockLinksChecks = {
        runLinksChecks: sinon.stub().resolves({
          auditResult: {
            brokenInternalLinks: [],
            brokenExternalLinks: [],
          },
        }),
      };

      const module = await esmock('../../src/preflight/handler.js', {
        '../../src/utils/dom-selector.js': mockDomSelector,
        '../../src/preflight/links-checks.js': mockLinksChecks,
      });

      preflightAuditFunction = module.preflightAudit;

      await preflightAuditFunction(context);

      const result = job.setResult.getCall(0).args[0];
      const linksAudit = result[0].audits.find((a) => a.name === 'links');

      expect(linksAudit).to.exist;
      // Should not have any bad-links opportunities for HTTPS links
      const badLinksOpportunity = linksAudit.opportunities.find((o) => o.check === 'bad-links');
      expect(badLinksOpportunity).to.be.undefined;
    });
  });
});
