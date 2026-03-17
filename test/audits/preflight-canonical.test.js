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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import canonicalHandler from '../../src/preflight/canonical.js';

use(sinonChai);
use(chaiAsPromised);

const PAGE_URL = 'https://main--example--site.aem.page/page1';
const PREVIEW_BASE_URL = 'https://main--example--site.aem.page';

function buildContext(overrides = {}) {
  return {
    site: { getId: () => 'site-123' },
    job: { getId: () => 'job-123' },
    step: 'identify',
    log: {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    },
    dataAccess: {
      AsyncJob: {
        findById: sinon.stub().resolves({
          setResult: sinon.stub(),
          save: sinon.stub().resolves(),
        }),
      },
    },
    ...overrides,
  };
}

function buildAuditContext(scrapedObjects = [], overrides = {}) {
  const auditsResult = [{ pageUrl: PAGE_URL, step: 'identify', audits: [] }];
  const audits = new Map([[PAGE_URL, auditsResult[0]]]);

  return {
    previewUrls: [PAGE_URL],
    previewBaseURL: PREVIEW_BASE_URL,
    step: 'identify',
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown: [],
    ...overrides,
  };
}

function buildScrapedObject(canonicalMeta, rawBody = null) {
  const scrapeResult = {};
  if (canonicalMeta !== undefined) scrapeResult.canonical = canonicalMeta;
  if (rawBody !== null) scrapeResult.rawBody = rawBody;
  return {
    Key: `scrapes/site-123/page1/scrape.json`,
    data: { finalUrl: PAGE_URL, scrapeResult },
  };
}

function getCanonicalAudit(auditsResult) {
  return auditsResult[0].audits.find((a) => a.name === 'canonical');
}

describe('Preflight Canonical Audit', () => {
  describe('canonical tag checks', () => {
    it('reports no opportunities when canonical is valid and self-referencing', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: PAGE_URL, inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      expect(getCanonicalAudit(auditCtx.auditsResult).opportunities).to.deep.equal([]);
    });

    it('reports canonical-tag-missing when tag is absent', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: false, count: 0, href: null, inHead: false,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const { opportunities } = getCanonicalAudit(auditCtx.auditsResult);
      expect(opportunities).to.have.lengthOf(1);
      expect(opportunities[0].check).to.equal('canonical-tag-missing');
      expect(opportunities[0].seoImpact).to.equal('Moderate');
      expect(opportunities[0].seoRecommendation).to.equal('Add a canonical tag to the head section');
    });

    it('reports canonical-tag-no-href when tag exists but href is null', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: null, inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const { opportunities } = getCanonicalAudit(auditCtx.auditsResult);
      expect(opportunities).to.have.lengthOf(1);
      expect(opportunities[0].check).to.equal('canonical-tag-no-href');
    });

    it('reports canonical-tag-outside-head when tag is not in <head>', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: PAGE_URL, inHead: false,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const checks = getCanonicalAudit(auditCtx.auditsResult).opportunities.map((o) => o.check);
      expect(checks).to.include('canonical-tag-outside-head');
    });

    it('reports canonical-tag-multiple when more than one canonical tag exists', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 2, href: PAGE_URL, inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const checks = getCanonicalAudit(auditCtx.auditsResult).opportunities.map((o) => o.check);
      expect(checks).to.include('canonical-tag-multiple');
    });

    it('reports canonical-tag-empty when href is blank whitespace', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: '   ', inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const { opportunities } = getCanonicalAudit(auditCtx.auditsResult);
      expect(opportunities).to.have.lengthOf(1);
      expect(opportunities[0].check).to.equal('canonical-tag-empty');
    });

    it('reports canonical-self-referenced when canonical points to a different path', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: `${PREVIEW_BASE_URL}/other-page`, inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const checks = getCanonicalAudit(auditCtx.auditsResult).opportunities.map((o) => o.check);
      expect(checks).to.include('canonical-self-referenced');
    });

    it('reports canonical-url-absolute when href is a relative URL', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: '/page1', inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const checks = getCanonicalAudit(auditCtx.auditsResult).opportunities.map((o) => o.check);
      expect(checks).to.include('canonical-url-absolute');
    });

    it('reports canonical-url-lowercased when href is fully uppercased', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: PAGE_URL.toUpperCase(), inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const checks = getCanonicalAudit(auditCtx.auditsResult).opportunities.map((o) => o.check);
      expect(checks).to.include('canonical-url-lowercased');
    });

    it('reports canonical-url-same-protocol when protocol differs from previewBaseURL', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: PAGE_URL.replace('https://', 'http://'), inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const checks = getCanonicalAudit(auditCtx.auditsResult).opportunities.map((o) => o.check);
      expect(checks).to.include('canonical-url-same-protocol');
    });
  });

  describe('data source fallback', () => {
    it('falls back to HTML parsing when scrapeResult.canonical is absent', async () => {
      const ctx = buildContext();
      const rawBody = `<!DOCTYPE html><html><head><link rel="canonical" href="${PAGE_URL}"/></head><body></body></html>`;
      const auditCtx = buildAuditContext([buildScrapedObject(undefined, rawBody)]);

      await canonicalHandler(ctx, auditCtx);

      expect(getCanonicalAudit(auditCtx.auditsResult).opportunities).to.deep.equal([]);
    });

    it('uses canonical outside <head> via HTML fallback when inHead is false', async () => {
      const ctx = buildContext();
      // Canonical tag placed in <body>, not <head>
      const rawBody = `<!DOCTYPE html><html><head></head><body><link rel="canonical" href="${PREVIEW_BASE_URL}/other"/></body></html>`;
      const auditCtx = buildAuditContext([buildScrapedObject(undefined, rawBody)]);

      await canonicalHandler(ctx, auditCtx);

      const checks = getCanonicalAudit(auditCtx.auditsResult).opportunities.map((o) => o.check);
      expect(checks).to.include('canonical-tag-outside-head');
      expect(checks).to.include('canonical-self-referenced');
    });

    it('reports canonical-tag-no-href via HTML fallback when canonical has no href attribute', async () => {
      const ctx = buildContext();
      const rawBody = '<!DOCTYPE html><html><head><link rel="canonical"/></head><body></body></html>';
      const auditCtx = buildAuditContext([buildScrapedObject(undefined, rawBody)]);

      await canonicalHandler(ctx, auditCtx);

      const { opportunities } = getCanonicalAudit(auditCtx.auditsResult);
      expect(opportunities[0].check).to.equal('canonical-tag-no-href');
    });

    it('reports canonical-tag-missing via HTML fallback when no canonical in rawBody', async () => {
      const ctx = buildContext();
      const rawBody = '<!DOCTYPE html><html><head></head><body></body></html>';
      const auditCtx = buildAuditContext([buildScrapedObject(undefined, rawBody)]);

      await canonicalHandler(ctx, auditCtx);

      const { opportunities } = getCanonicalAudit(auditCtx.auditsResult);
      expect(opportunities[0].check).to.equal('canonical-tag-missing');
    });

    it('reports canonical-tag-missing when both canonical metadata and rawBody are absent', async () => {
      const ctx = buildContext();
      // scrapeResult with neither canonical nor rawBody
      const auditCtx = buildAuditContext([{
        Key: 'scrapes/site-123/page1/scrape.json',
        data: { finalUrl: PAGE_URL, scrapeResult: {} },
      }]);

      await canonicalHandler(ctx, auditCtx);

      const { opportunities } = getCanonicalAudit(auditCtx.auditsResult);
      expect(opportunities).to.have.lengthOf(1);
      expect(opportunities[0].check).to.equal('canonical-tag-missing');
      expect(ctx.log.warn).to.have.been.calledWith(sinon.match('No canonical metadata available'));
    });

    it('logs a warning and skips page when no scraped data is found for a URL', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([]); // no scraped objects

      await canonicalHandler(ctx, auditCtx);

      expect(ctx.log.warn).to.have.been.calledWith(sinon.match('No scraped data found'));
      expect(getCanonicalAudit(auditCtx.auditsResult).opportunities).to.deep.equal([]);
    });
  });

  describe('opportunity format', () => {
    it('populates check, issue, seoImpact and seoRecommendation fields', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: false, count: 0, href: null, inHead: false,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const [opp] = getCanonicalAudit(auditCtx.auditsResult).opportunities;
      expect(opp).to.have.all.keys('check', 'issue', 'seoImpact', 'seoRecommendation');
      expect(opp.seoImpact).to.equal('Moderate');
    });
  });

  describe('timing and persistence', () => {
    it('appends a canonical entry to timeExecutionBreakdown', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: PAGE_URL, inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      const breakdown = auditCtx.timeExecutionBreakdown.find((e) => e.name === 'canonical');
      expect(breakdown).to.exist;
      expect(breakdown).to.have.all.keys('name', 'duration', 'startTime', 'endTime');
    });

    it('saves intermediate results via dataAccess.AsyncJob', async () => {
      const ctx = buildContext();
      const auditCtx = buildAuditContext([buildScrapedObject({
        exists: true, count: 1, href: PAGE_URL, inHead: true,
      })]);

      await canonicalHandler(ctx, auditCtx);

      expect(ctx.dataAccess.AsyncJob.findById).to.have.been.calledWith('job-123');
    });
  });
});
