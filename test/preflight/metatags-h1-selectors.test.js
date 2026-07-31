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
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

// Covers the metatags h1 check's latent "same text on every expanded instance" bug: each H1's own
// text must be paired with its own selector, not a single opportunity-level value shared by all.
describe('preflight/metatags - h1 selector/text pairing', () => {
  const PAGE_URL = 'https://main--example--page.aem.page/page1';

  const buildContext = () => ({
    site: {
      getId: () => 'site-123',
      getConfig: () => ({ getHandlers: () => ({}) }),
    },
    job: { getId: () => 'job-123' },
    step: 'identify',
    log: {
      info: sinon.stub(), warn: sinon.stub(), error: sinon.stub(), debug: sinon.stub(),
    },
    dataAccess: {
      AsyncJob: {
        findById: sinon.stub().resolves({
          setResult: sinon.stub(),
          save: sinon.stub().resolves(),
        }),
      },
    },
  });

  const buildAuditContext = (rawBody) => {
    const auditsResult = [{ pageUrl: PAGE_URL, step: 'identify', audits: [] }];
    const audits = new Map([[PAGE_URL, auditsResult[0]]]);
    return {
      previewUrls: [PAGE_URL],
      step: 'identify',
      audits,
      auditsResult,
      scrapedObjects: [{
        data: {
          finalUrl: PAGE_URL,
          scrapeResult: { rawBody },
        },
      }],
      timeExecutionBreakdown: [],
    };
  };

  it('pairs each H1 with its own text instead of one shared value', async () => {
    const rawBody = '<html><head></head><body><h1>First Heading</h1><h1>Second Heading</h1></body></html>';

    const { default: metatags } = await esmock('../../src/preflight/metatags.js', {
      '../../src/metatags/handler.js': {
        metatagsAutoDetect: sinon.stub().resolves({
          seoChecks: { getFewHealthyTags: () => ({}) },
          extractedTags: {},
          detectedTags: {
            '/page1': {
              h1: {
                issue: 'Multiple H1 tags found',
                seoImpact: 'High',
                seoRecommendation: 'Use exactly one H1 tag per page',
              },
            },
          },
        }),
      },
    });

    const context = buildContext();
    const auditContext = buildAuditContext(rawBody);

    await metatags(context, auditContext);

    const audit = auditContext.audits.get(PAGE_URL).audits.find((a) => a.name === 'metatags');
    const [opportunity] = audit.opportunities;

    expect(opportunity.elements).to.deep.equal([
      { selector: 'body > h1:nth-of-type(1)', textContent: 'First Heading' },
      { selector: 'body > h1:nth-of-type(2)', textContent: 'Second Heading' },
    ]);
  });
});
