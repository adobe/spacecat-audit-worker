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

import { getS3Path } from '../../../../src/prerender/utils/utils.js';

/**
 * Shared factory helpers for prerender behavioural contract tests.
 *
 * Rule: helpers mock only EXTERNAL dependencies — S3, SQS, DB entities.
 * They never stub internal handler functions (convertToOpportunity,
 * getObjectFromKey, syncSuggestions, etc.). That keeps these tests
 * green through any internal refactoring or module extraction.
 */

// ─── HTML fixtures ────────────────────────────────────────────────────────────

/** Identical server/client HTML — ratio = 1.0, needsPrerender = false. */
export const HTML_SAME = '<html><body><p>identical content for both server and client sides testing</p></body></html>';

/** Server-side with few words; pair with HTML_CLIENT_NEEDS_PRERENDER for ratio >> 1.1. */
export const HTML_SERVER_SPARSE = '<html><body><p>few words here</p></body></html>';

/** Client-side with many words — ratio vs HTML_SERVER_SPARSE well above 1.1 threshold. */
export const HTML_CLIENT_NEEDS_PRERENDER = `<html><body><p>${'The quick brown fox jumps over the lazy dog. '.repeat(15).trim()}</p></body></html>`;

// ─── S3 key helpers ───────────────────────────────────────────────────────────

/**
 * Uses the production getS3Path so the expected key format stays the single source of truth
 * (no second sanitization copy to drift out of sync).
 */
export function scrapeKeys(scrapeJobId, url) {
  return {
    serverHtml: getS3Path(url, scrapeJobId, 'server-side.html'),
    clientHtml: getS3Path(url, scrapeJobId, 'client-side.html'),
    scrapeJson: getS3Path(url, scrapeJobId, 'scrape.json'),
  };
}

/**
 * Builds a partial S3 keyMap for one URL — ready to spread into the full keyMap.
 *
 * @param {string} scrapeJobId
 * @param {string} url
 * @param {Object} options
 * @param {string} [options.serverHtml=HTML_SAME]
 * @param {string} [options.clientHtml=HTML_SAME]
 * @param {Object} [options.scrapeJson={ isDeployedAtEdge: false }]
 */
export function buildUrlS3Content(scrapeJobId, url, {
  serverHtml = HTML_SAME,
  clientHtml = HTML_SAME,
  scrapeJson = { isDeployedAtEdge: false },
} = {}) {
  const keys = scrapeKeys(scrapeJobId, url);
  return {
    [keys.serverHtml]: serverHtml,
    [keys.clientHtml]: clientHtml,
    [keys.scrapeJson]: scrapeJson,
  };
}

// ─── Site ─────────────────────────────────────────────────────────────────────

export function buildSite({
  id = 'test-site-id',
  baseUrl = 'https://example.com',
  includedUrls = [],
  overrideBaseURL = null,
} = {}) {
  const fetchConfig = overrideBaseURL ? { getFetchConfig: () => ({ overrideBaseURL }) } : {};
  return {
    getId: () => id,
    getBaseURL: () => baseUrl,
    getDeliveryType: () => 'aem_edge',
    getRegion: () => 'us-east-1',
    getConfig: () => ({
      getIncludedURLs: () => Promise.resolve(includedUrls),
      ...fetchConfig,
    }),
  };
}

// ─── Logger ───────────────────────────────────────────────────────────────────

export function buildLog(sandbox) {
  return {
    info: sandbox.stub(),
    warn: sandbox.stub(),
    error: sandbox.stub(),
    debug: sandbox.stub(),
  };
}

// ─── S3 client ────────────────────────────────────────────────────────────────

/** Convenience: creates the NoSuchKey error S3 SDK throws for missing objects. */
export function noSuchKeyError() {
  const err = new Error('The specified key does not exist.');
  err.name = 'NoSuchKey';
  return err;
}

/**
 * Builds an S3 client stub that dispatches by key.
 *
 * keyMap values:
 *   - string       → raw body (no ContentType) — use for HTML
 *   - plain object → JSON body with ContentType: application/json
 *   - Error        → rejected (use noSuchKeyError() for missing keys)
 *   - absent key   → rejects with NoSuchKey automatically
 *
 * PutObjectCommand always resolves; use captureStatusWrite(s3Client) to inspect.
 */
export function buildS3Client(sandbox, keyMap = {}) {
  const send = sandbox.stub().callsFake((cmd) => {
    if (cmd.constructor.name === 'GetObjectCommand') {
      const { Key } = cmd.input;
      if (Object.hasOwn(keyMap, Key)) {
        const value = keyMap[Key];
        if (value instanceof Error) {
          return Promise.reject(value);
        }
        const isString = typeof value === 'string';
        const body = isString ? value : JSON.stringify(value);
        return Promise.resolve({
          Body: { transformToString: () => Promise.resolve(body) },
          ...(isString ? {} : { ContentType: 'application/json' }),
        });
      }
      return Promise.reject(noSuchKeyError());
    }
    if (cmd.constructor.name === 'PutObjectCommand') {
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`Unexpected S3 command: ${cmd.constructor.name}`));
  });
  return { send };
}

/** Canonical S3 key for a site's status.json. */
export function statusKey(siteId) {
  return `prerender/scrapes/${siteId}/status.json`;
}

// ─── Status.json shape ────────────────────────────────────────────────────────

/**
 * Builds a valid status.json object.
 * pages[] entries follow the shape: { url, pathname, needsPrerender, isDeployedAtEdge }
 */
export function buildStatus({
  scrapeForbidden = false,
  scrapeForbiddenSince = undefined,
  scrapeJobId = undefined,
  pages = [],
} = {}) {
  const status = { scrapeForbidden, pages };
  if (scrapeForbiddenSince !== undefined) {
    status.scrapeForbiddenSince = scrapeForbiddenSince;
  }
  if (scrapeJobId !== undefined) {
    status.scrapeJobId = scrapeJobId;
  }
  return status;
}

/** Returns a scrapeForbiddenSince timestamp N days in the past. */
export function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Suggestion ───────────────────────────────────────────────────────────────

export function buildSuggestion(sandbox, {
  id = 'suggestion-id',
  siteId = 'test-site-id',
  status = 'NEW',
  data = {},
} = {}) {
  return {
    getId: () => id,
    getSiteId: () => siteId,
    getStatus: () => status,
    getData: () => data,
    setData: sandbox.stub(),
    setStatus: sandbox.stub(),
    setUpdatedBy: sandbox.stub(),
    save: sandbox.stub().resolvesThis(),
  };
}

// ─── Opportunity ──────────────────────────────────────────────────────────────

export function buildOpportunity(sandbox, {
  id = 'opportunity-id',
  siteId = 'test-site-id',
  type = 'prerender',
  status = 'NEW',
  suggestions = [],
  data = {},
} = {}) {
  return {
    getId: () => id,
    getSiteId: () => siteId,
    getType: () => type,
    getStatus: () => status,
    getAuditId: () => 'audit-id',
    getData: () => data,
    setAuditId: sandbox.stub(),
    setData: sandbox.stub(),
    setStatus: sandbox.stub(),
    setUpdatedBy: sandbox.stub(),
    getSuggestions: sandbox.stub().resolves(suggestions),
    // addSuggestions is called by syncSuggestions when new suggestions are created
    addSuggestions: sandbox.stub().callsFake((newSuggestions) => Promise.resolve(newSuggestions)),
    save: sandbox.stub().resolvesThis(),
  };
}

// ─── DataAccess ───────────────────────────────────────────────────────────────

/**
 * Builds a dataAccess stub covering all entities the handler touches.
 *
 * Pass pre-built entities via overrides to control specific return values:
 *   buildDataAccess(sandbox, { opportunities: [myOpp], topPages: [{ url, traffic }] })
 */
export function buildDataAccess(sandbox, {
  opportunities = [],
  topPages = [],
  citabilityRecords = [],
  scrapeUrls = [],
} = {}) {
  return {
    Opportunity: {
      allBySiteIdAndStatus: sandbox.stub().resolves(opportunities),
      findById: sandbox.stub().resolves(opportunities[0] ?? null),
      create: sandbox.stub().callsFake((data) => Promise.resolve(
        buildOpportunity(sandbox, { siteId: data.siteId ?? 'test-site-id' }),
      )),
    },
    SiteTopPage: {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(
        topPages.map((p) => ({
          getUrl: () => (typeof p === 'string' ? p : p.url),
          getTraffic: () => (typeof p === 'string' ? 100 : (p.traffic ?? 100)),
        })),
      ),
    },
    PageCitability: {
      allByIndexKeys: sandbox.stub().resolves(citabilityRecords),
      findByIndexKeys: sandbox.stub().resolves(null),
      create: sandbox.stub().resolvesThis(),
    },
    ScrapeUrl: {
      allByScrapeJobId: sandbox.stub().resolves(
        scrapeUrls.map((u) => ({
          getUrl: () => u,
          getStatus: () => 'COMPLETE',
          getStatusCode: () => 200,
        })),
      ),
    },
    Suggestion: {
      saveMany: sandbox.stub().resolves([]),
      bulkUpdateStatus: sandbox.stub().resolves([]),
      allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
    },
  };
}

// ─── SQS ──────────────────────────────────────────────────────────────────────

export function buildSqs(sandbox) {
  return { sendMessage: sandbox.stub().resolves() };
}

// ─── Full context ─────────────────────────────────────────────────────────────

/**
 * Assembles a complete handler context.
 * All dependencies default to safe stubs; pass overrides for the ones your test cares about.
 *
 * @example
 * const ctx = buildContext(sandbox, {
 *   site: buildSite({ id: 'blocked-site' }),
 *   s3Client: buildS3Client(sandbox, {
 *     [statusKey('blocked-site')]: buildStatus({
 *       scrapeForbidden: true, scrapeForbiddenSince: daysAgo(1),
 *     }),
 *   }),
 * });
 */
export function buildContext(sandbox, overrides = {}) {
  const site = overrides.site ?? buildSite();
  return {
    site,
    log: buildLog(sandbox),
    s3Client: buildS3Client(sandbox),
    dataAccess: buildDataAccess(sandbox),
    sqs: buildSqs(sandbox),
    env: {
      S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.us-east-1.amazonaws.com/test-queue',
    },
    finalUrl: site.getBaseURL(),
    audit: { getId: () => 'audit-id' },
    auditContext: {},
    scrapeResultPaths: new Map(),
    data: null,
    ...overrides,
  };
}

// ─── S3 inspection helpers ────────────────────────────────────────────────────

/** Returns the parsed body of the first PutObjectCommand sent to an s3Client stub. */
export function captureStatusWrite(s3Client) {
  const put = s3Client.send.getCalls().find(
    (c) => c.args[0]?.constructor?.name === 'PutObjectCommand',
  );
  if (!put) {
    return null;
  }
  return JSON.parse(put.args[0].input.Body);
}
