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
import bodySize from '../../src/preflight/body-size.js';

use(sinonChai);

describe('Preflight Body Size Audit', () => {
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

  it('creates a body-size audit entry for each page', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body><p>Normal length content here.</p></body></html>' },
      },
    }];

    await bodySize(context, auditContext);

    const pageAudit = auditContext.audits.get('https://example.com/page1');
    expect(pageAudit.audits).to.have.lengthOf(1);
    expect(pageAudit.audits[0]).to.deep.include({ name: 'body-size', type: 'seo' });
  });

  it('flags pages with body text between 1 and 100 characters', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body>Short</body></html>' },
      },
    }];

    await bodySize(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
    expect(audit.opportunities[0]).to.deep.include({
      check: 'content-length',
      issue: 'Body content length is below 100 characters',
      seoImpact: 'Moderate',
      seoRecommendation: 'Add more meaningful content to the page',
    });
  });

  it('does not flag pages with body text longer than 100 characters', async () => {
    const longText = 'a'.repeat(101);
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: `<html><body><p>${longText}</p></body></html>` },
      },
    }];

    await bodySize(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(0);
  });

  it('does not flag pages with empty body text', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body></body></html>' },
      },
    }];

    await bodySize(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(0);
  });

  it('flags page with exactly 100 characters of body text', async () => {
    const text = 'a'.repeat(100);
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: `<html><body>${text}</body></html>` },
      },
    }];

    await bodySize(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
  });

  it('does not flag page with exactly 101 characters of body text', async () => {
    const text = 'a'.repeat(101);
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: `<html><body>${text}</body></html>` },
      },
    }];

    await bodySize(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(0);
  });

  it('logs a warning when no audit entry exists for a scraped URL', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/unknown',
        scrapeResult: { rawBody: '<html><body>Short</body></html>' },
      },
    }];

    await bodySize(context, auditContext);

    expect(log.warn).to.have.been.calledWithMatch('[preflight-audit]');
  });

  it('adds timing information to the execution breakdown', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1',
        scrapeResult: { rawBody: '<html><body></body></html>' },
      },
    }];

    await bodySize(context, auditContext);

    expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
    expect(auditContext.timeExecutionBreakdown[0]).to.include({
      name: 'body-size',
    });
    expect(auditContext.timeExecutionBreakdown[0]).to.have.property('duration');
    expect(auditContext.timeExecutionBreakdown[0]).to.have.property('startTime');
    expect(auditContext.timeExecutionBreakdown[0]).to.have.property('endTime');
  });

  it('returns { processing: false }', async () => {
    auditContext.scrapedObjects = [];
    const result = await bodySize(context, auditContext);
    expect(result).to.deep.equal({ processing: false });
  });

  it('strips trailing slash from finalUrl when looking up audit', async () => {
    auditContext.scrapedObjects = [{
      data: {
        finalUrl: 'https://example.com/page1/',
        scrapeResult: { rawBody: '<html><body>Short</body></html>' },
      },
    }];

    await bodySize(context, auditContext);

    const audit = auditContext.audits.get('https://example.com/page1').audits[0];
    expect(audit.opportunities).to.have.lengthOf(1);
  });
});
