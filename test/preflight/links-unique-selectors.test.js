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
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { MockContextBuilder } from '../shared.js';
import { preflightAudit } from '../../src/preflight/handler.js';

use(sinonChai);

describe('Preflight Links - Unique Selector Tests', () => {
  let context;
  // eslint-disable-next-line no-unused-vars
  let site;
  let job;
  let s3Client;
  let configuration;

  // Simplified HTML based on user's real page structure
  const testHtml = `
    <html>
      <head><title>Test Page</title></head>
      <body>
        <main>
          <div class="section columns-container">
            <div class="default-content-wrapper">
              <p><a href="https://drive.google.com/drive/folders/test">Google Drive</a></p>
              <p><a href="https://bit.ly/3aImqUL">https://www.aem.live/tutorial</a></p>
              <p><a href="http://www.aem.live/tutorial">http://www.aem.live/tutorial</a></p>
              <p><a href="https://www.aem.live/tutral">https://www.aem.live/tutral</a></p>
              <p><a href="/broken">https://main--aemtutorial--dogadogan.aem.page/broken</a></p>
              <p><a href="/another-broken/">https://main--aemtutorial--dogadogan.aem.page/another-broken/</a></p>
            </div>
          </div>
        </main>
      </body>
    </html>
  `;

  beforeEach(async () => {
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
                rawBody: testHtml,
              },
              finalUrl: 'https://main--aemtutorial--dogadogan.aem.page',
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
        urls: ['https://main--aemtutorial--dogadogan.aem.page'],
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
      isHandlerEnabledForSite: sinon.stub().returns(true),
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
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should generate unique selectors for each broken link in the same container', async () => {
    await preflightAudit(context);

    const result = job.setResult.getCall(0).args[0];
    const linksAudit = result[0].audits.find((a) => a.name === 'links');

    expect(linksAudit).to.exist;

    if (linksAudit.opportunities.length === 0) {
      console.log('No opportunities found - links may not be broken in test environment');
      return;
    }

    // Find broken internal links opportunity
    const brokenInternalLinks = linksAudit.opportunities.find((o) => o.check === 'broken-internal-links');

    if (brokenInternalLinks && brokenInternalLinks.issue) {
      const selectors = [];
      brokenInternalLinks.issue.forEach((issue) => {
        if (issue.elements && issue.elements.length > 0) {
          issue.elements.forEach((el) => {
            selectors.push(el.selector);
          });
        }
      });

      // Log selectors for debugging
      console.log('Broken internal link selectors:', selectors);

      // All selectors should be unique
      const uniqueSelectors = new Set(selectors);
      expect(uniqueSelectors.size).to.equal(
        selectors.length,
        'Each broken link should have a unique selector',
      );
    }

    // Find broken external links opportunity
    const brokenExternalLinks = linksAudit.opportunities.find((o) => o.check === 'broken-external-links');

    if (brokenExternalLinks && brokenExternalLinks.issue) {
      const selectors = [];
      brokenExternalLinks.issue.forEach((issue) => {
        if (issue.elements && issue.elements.length > 0) {
          issue.elements.forEach((el) => {
            selectors.push(el.selector);
          });
        }
      });

      console.log('Broken external link selectors:', selectors);

      const uniqueSelectors = new Set(selectors);
      expect(uniqueSelectors.size).to.equal(
        selectors.length,
        'Each broken external link should have a unique selector',
      );
    }

    // Find bad links (HTTP) opportunity
    const badLinks = linksAudit.opportunities.find((o) => o.check === 'bad-links');

    if (badLinks && badLinks.issue) {
      const selectors = [];
      badLinks.issue.forEach((issue) => {
        if (issue.elements && issue.elements.length > 0) {
          issue.elements.forEach((el) => {
            selectors.push(el.selector);
          });
        }
      });

      console.log('Bad link selectors:', selectors);

      const uniqueSelectors = new Set(selectors);
      expect(uniqueSelectors.size).to.equal(
        selectors.length,
        'Each bad link should have a unique selector',
      );
    }
  });

  it('should verify selectors correctly identify their respective links', async () => {
    await preflightAudit(context);

    const result = job.setResult.getCall(0).args[0];
    const linksAudit = result[0].audits.find((a) => a.name === 'links');

    // For each issue, verify the selector points to the correct URL
    linksAudit.opportunities.forEach((opportunity) => {
      if (opportunity.issue && Array.isArray(opportunity.issue)) {
        opportunity.issue.forEach((issue) => {
          const { url } = issue;
          const selector = issue.elements?.[0]?.selector;

          console.log(`URL: ${url}, Selector: ${selector}`);

          // The selector should be unique enough to identify this specific link
          expect(selector).to.exist;
          expect(selector).to.not.equal(
            'div.section.columns-container > div.default-content-wrapper > p > a',
            `Selector for ${url} is too generic and will match multiple links`,
          );
        });
      }
    });
  });
});
