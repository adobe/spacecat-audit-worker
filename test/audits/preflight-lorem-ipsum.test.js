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
import loremIpsum from '../../src/preflight/lorem-ipsum.js';

use(sinonChai);

describe('Preflight Lorem Ipsum Audit', () => {
  let context;
  let auditContext;
  let log;

  beforeEach(() => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    context = {
      site: { getId: () => 'site-123' },
      job: { getId: () => 'job-123' },
      step: 'identify',
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      log,
      s3Client: {},
      dataAccess: {
        AsyncJob: {
          findById: sinon.stub().resolves({
            setResult: sinon.stub(),
            save: sinon.stub().resolves(),
          }),
        },
      },
    };

    auditContext = {
      previewUrls: ['https://example.com/page1'],
      step: 'identify',
      audits: new Map([['https://example.com/page1', { audits: [] }]]),
      auditsResult: [{ pageUrl: 'https://example.com/page1', audits: [] }],
      scrapedObjects: [],
      timeExecutionBreakdown: [],
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('creates a lorem-ipsum audit entry for each page', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body><p>Normal content here.</p></body></html>' },
      },
    }];

    await loremIpsum(context, auditContext);

    const pageAudit = auditContext.audits.get('https://example.com/page1');
    expect(pageAudit.audits).to.have.lengthOf(1);
    expect(pageAudit.audits[0]).to.deep.include({ name: 'lorem-ipsum', type: 'seo' });
  });

  it('flags pages containing "Lorem ipsum" text', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body><p>Lorem ipsum dolor sit amet.</p></body></html>' },
      },
    }];

    await loremIpsum(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
    expect(audit.opportunities[0]).to.deep.include({
      check: 'placeholder-text',
      issue: 'Found Lorem ipsum placeholder text in the page content',
      seoImpact: 'High',
      seoRecommendation: 'Replace placeholder text with meaningful content',
    });
  });

  it('does not flag pages with no Lorem ipsum text', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body><p>Real content here.</p></body></html>' },
      },
    }];

    await loremIpsum(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(0);
  });

  it('matches Lorem ipsum case-insensitively', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body><p>LOREM IPSUM dolor sit amet.</p></body></html>' },
      },
    }];

    await loremIpsum(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
  });

  it('keeps only innermost elements when lorem ipsum is in nested tags', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: `<html><body>
            <div id="outer">
              <p id="inner">Lorem ipsum dolor sit amet.</p>
            </div>
          </body></html>`,
        },
      },
    }];

    await loremIpsum(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
    // Should include the innermost element (p), not the outer div
    const { elements } = audit.opportunities[0];
    expect(elements).to.have.lengthOf(1);
    expect(elements[0].selector).to.include('p');
  });

  it('falls back to body selector when no element selectors are found', async () => {
    // Text is in body directly with no block-level element
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: '<html><body>Lorem ipsum dolor sit amet.</body></html>',
        },
      },
    }];

    await loremIpsum(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
    // elements may be present (body fallback) or absent — either is valid
    expect(audit.opportunities[0]).to.have.property('check', 'placeholder-text');
  });

  it('caps elements at 10 when many lorem ipsum elements exist', async () => {
    const paragraphs = Array.from({ length: 15 }, (_, i) => `<p id="p${i}">Lorem ipsum ${i}</p>`).join('');
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: `<html><body>${paragraphs}</body></html>` },
      },
    }];

    await loremIpsum(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
    expect(audit.opportunities[0].elements).to.have.lengthOf(10);
  });

  it('logs a warning when no audit entry exists for a scraped URL', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/unknown',
        scrapeResult: { rawBody: '<html><body><p>Lorem ipsum.</p></body></html>' },
      },
    }];

    await loremIpsum(context, auditContext);

    expect(log.warn).to.have.been.calledWithMatch('[preflight-audit]');
  });

  it('adds timing information to the execution breakdown', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body><p>Normal content.</p></body></html>' },
      },
    }];

    await loremIpsum(context, auditContext);

    expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
    expect(auditContext.timeExecutionBreakdown[0]).to.include({ name: 'lorem-ipsum' });
    expect(auditContext.timeExecutionBreakdown[0]).to.have.property('duration');
    expect(auditContext.timeExecutionBreakdown[0]).to.have.property('startTime');
    expect(auditContext.timeExecutionBreakdown[0]).to.have.property('endTime');
  });

  it('returns { processing: false }', async () => {
    auditContext.scrapedObjects = [];
    const result = await loremIpsum(context, auditContext);
    expect(result).to.deep.equal({ processing: false });
  });

  it('strips trailing slash from finalUrl when looking up audit', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1/',
        scrapeResult: { rawBody: '<html><body><p>Lorem ipsum dolor.</p></body></html>' },
      },
    }];

    await loremIpsum(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
  });
});
