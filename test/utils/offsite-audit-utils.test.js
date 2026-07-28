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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  DrsNoContentAvailableError,
  MYSTIQUE_URLS_LIMIT,
  NON_EARNED_EXCLUDED_DOMAINS,
  filterUrlsByDrsStatus,
  resolveMystiqueUrlLimit,
  resolveDrsPollIntervalSeconds,
  resolveEnableBrandProfile,
  requestOffsiteScrape,
  computeBrandTokens,
  isExcludedCitedHost,
  toApexHost,
  formatDuration,
  buildOffsiteTimingLines,
  formatDrsExtras,
  buildAnalysisScrapeStatusMessage,
  scrapedThisCycle,
} from '../../src/utils/offsite-audit-utils.js';
import {
  DRS_POLL_INTERVAL_SECONDS,
  DRS_POLL_INTERVAL_UNATTENDED_SECONDS,
} from '../../src/offsite-brand-presence/constants.js';

use(sinonChai);

describe('offsite-audit-utils', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('resolveDrsPollIntervalSeconds', () => {
    it('returns the short (attended) interval when a full Slack context is present', () => {
      expect(resolveDrsPollIntervalSeconds({ channelId: 'C123', threadTs: '111.222' }))
        .to.equal(DRS_POLL_INTERVAL_SECONDS);
    });

    it('returns the long (unattended) interval when there is no Slack context', () => {
      expect(resolveDrsPollIntervalSeconds(undefined))
        .to.equal(DRS_POLL_INTERVAL_UNATTENDED_SECONDS);
      expect(resolveDrsPollIntervalSeconds({}))
        .to.equal(DRS_POLL_INTERVAL_UNATTENDED_SECONDS);
    });

    it('treats a partial Slack context (missing threadTs or channelId) as unattended', () => {
      // A half-populated context can't post to a thread, so it should not get the fast cadence.
      expect(resolveDrsPollIntervalSeconds({ channelId: 'C123' }))
        .to.equal(DRS_POLL_INTERVAL_UNATTENDED_SECONDS);
      expect(resolveDrsPollIntervalSeconds({ threadTs: '111.222' }))
        .to.equal(DRS_POLL_INTERVAL_UNATTENDED_SECONDS);
    });

    it('uses a longer interval for unattended runs than for attended ones', () => {
      expect(DRS_POLL_INTERVAL_UNATTENDED_SECONDS).to.be.greaterThan(DRS_POLL_INTERVAL_SECONDS);
    });
  });

  describe('MYSTIQUE_URLS_LIMIT', () => {
    it('should be a positive number', () => {
      expect(MYSTIQUE_URLS_LIMIT).to.be.a('number');
      expect(MYSTIQUE_URLS_LIMIT).to.be.greaterThan(0);
    });
  });

  describe('DrsNoContentAvailableError', () => {
    it('should be an Error with the correct name', () => {
      const error = new DrsNoContentAvailableError('nothing ready');
      expect(error).to.be.instanceOf(Error);
      expect(error.name).to.equal('DrsNoContentAvailableError');
      expect(error.message).to.equal('nothing ready');
      expect(error.counts).to.be.undefined;
    });

    it('exposes the DRS status breakdown passed to the constructor', () => {
      const counts = {
        total: 70, available: 0, scraping: 3, notFound: 67, determined: true,
      };
      const error = new DrsNoContentAvailableError('nothing ready', counts);
      expect(error.counts).to.deep.equal(counts);
    });
  });

  describe('filterUrlsByDrsStatus', () => {
    const urls = [
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
      { url: 'https://example.com/c' },
    ];
    const datasetIds = ['dataset_one', 'dataset_two'];
    const siteId = 'site-123';

    it('returns original list with undetermined counts when drsClient is null', async () => {
      const result = await filterUrlsByDrsStatus(urls, datasetIds, siteId, null);
      expect(result.urls).to.deep.equal(urls);
      expect(result.counts).to.deep.equal({
        total: 3, available: 3, scraping: 0, notFound: 0, determined: false,
      });
    });

    it('returns original list when drsClient is not configured', async () => {
      const log = { info: sandbox.stub() };
      const drsClient = { isConfigured: sandbox.stub().returns(false) };
      const result = await filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, log, '[T]');
      expect(result.urls).to.deep.equal(urls);
      expect(result.counts.determined).to.equal(false);
      expect(log.info).to.have.been.calledWith('[T] DRS client not configured, skipping availability filter');
    });

    it('filters to URLs available in at least one dataset', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub(),
      };

      drsClient.lookupScrapeResults.withArgs(sinon.match({ datasetId: 'dataset_one' })).resolves({
        results: [
          { url: 'https://example.com/a', status: 'available' },
          { url: 'https://example.com/b', status: 'scraping' },
          { url: 'https://example.com/c', status: 'not_found' },
        ],
        summary: {
          total: 3, available: 1, scraping: 1, not_found: 1,
        },
      });

      drsClient.lookupScrapeResults.withArgs(sinon.match({ datasetId: 'dataset_two' })).resolves({
        results: [
          { url: 'https://example.com/a', status: 'scraping' },
          { url: 'https://example.com/b', status: 'available' },
          { url: 'https://example.com/c', status: 'not_found' },
        ],
        summary: {
          total: 3, available: 1, scraping: 1, not_found: 1,
        },
      });

      const result = await filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, log, '[T]');

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls.map((u) => u.url)).to.include.members([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      expect(result.counts).to.deep.equal({
        total: 3, available: 2, scraping: 0, notFound: 1, determined: true,
      });
      expect(log.info).to.have.been.calledWith('[T] DRS availability filter: removed 1 URL(s) not yet scraped (0 scraping, 1 not-found), 2 remaining');
    });

    it('logs summary per dataset', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: [{ url: 'https://example.com/a', status: 'available' }],
          summary: {
            total: 3, available: 1, scraping: 0, not_found: 2,
          },
        }),
      };

      await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, log, '[T]');

      expect(log.info).to.have.been.calledWith('[T] DRS lookup datasetId=ds1: 1/3 available, 0 scraping, 2 not-found');
    });

    it('counts still-scraping URLs separately from not-found ones', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: [
            { url: 'https://example.com/a', status: 'available' },
            { url: 'https://example.com/b', status: 'scraping' },
            { url: 'https://example.com/c', status: 'not_found' },
          ],
          summary: {
            total: 3, available: 1, scraping: 1, not_found: 1,
          },
        }),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, log, '[T]');

      expect(result.urls.map((u) => u.url)).to.deep.equal(['https://example.com/a']);
      expect(result.counts).to.deep.equal({
        total: 3, available: 1, scraping: 1, notFound: 1, determined: true,
      });
      expect(log.info).to.have.been.calledWith('[T] DRS availability filter: removed 2 URL(s) not yet scraped (1 scraping, 1 not-found), 1 remaining');
    });

    it('throws DrsNoContentAvailableError when DRS responded but no URLs are available', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: urls.map((u) => ({ url: u.url, status: 'not_found' })),
          summary: {
            total: 3, available: 0, scraping: 0, not_found: 3,
          },
        }),
      };

      let thrown;
      try {
        await filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, log, '[T]');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).to.be.instanceOf(DrsNoContentAvailableError);
      // The status breakdown is attached so callers can report why no content was available.
      expect(thrown.counts).to.deep.equal({
        total: 3, available: 0, scraping: 0, notFound: 3, determined: true,
      });
    });

    it('falls back to full list when all lookups return null', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves(null),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, log, '[T]');

      expect(result.urls).to.deep.equal(urls);
      expect(result.counts.determined).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/DRS lookup returned null/);
      expect(log.warn).to.have.been.calledWithMatch(/All DRS lookups failed or returned null/);
    });

    it('falls back to full list when all lookups throw', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().rejects(new Error('network error')),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, log, '[T]');

      expect(result.urls).to.deep.equal(urls);
      expect(result.counts.determined).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/DRS lookup failed for datasetId=ds1/);
      expect(log.warn).to.have.been.calledWithMatch(/All DRS lookups failed or returned null/);
    });

    it('does not log removed count when all URLs pass the filter', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: urls.map((u) => ({ url: u.url, status: 'available' })),
          summary: {
            total: 3, available: 3, scraping: 0, not_found: 0,
          },
        }),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, log);

      expect(result.urls).to.deep.equal(urls);
      expect(result.counts).to.deep.equal({
        total: 3, available: 3, scraping: 0, notFound: 0, determined: true,
      });
      expect(log.info).to.not.have.been.calledWithMatch(/DRS availability filter: removed/);
    });

    it('works without log or logPrefix', async () => {
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: [{ url: 'https://example.com/a', status: 'available' }],
          summary: {
            total: 3, available: 1, scraping: 0, not_found: 2,
          },
        }),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient);

      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0].url).to.equal('https://example.com/a');
    });

    it('falls back to rawUrls.length in summary log when response.summary is absent', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: [{ url: 'https://example.com/a', status: 'available' }],
        }),
      };

      await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, log, '[T]');

      expect(log.info).to.have.been.calledWith(
        `[T] DRS lookup datasetId=ds1: 0/${urls.length} available, 0 scraping, 0 not-found`,
      );
    });
  });

  describe('formatDrsExtras', () => {
    it('returns empty string for undetermined counts', () => {
      expect(formatDrsExtras({ determined: false })).to.equal('');
    });

    it('returns empty string when counts are missing', () => {
      expect(formatDrsExtras(undefined)).to.equal('');
    });

    it('returns empty string when every URL is available', () => {
      expect(formatDrsExtras({
        available: 5, scraping: 0, notFound: 0, determined: true,
      })).to.equal('');
    });

    it('reports scraping only', () => {
      expect(formatDrsExtras({
        available: 5, scraping: 3, notFound: 0, determined: true,
      })).to.equal(' (3 still scraping)');
    });

    it('reports not-found only', () => {
      expect(formatDrsExtras({
        available: 5, scraping: 0, notFound: 2, determined: true,
      })).to.equal(' (2 not yet scraped)');
    });

    it('reports both scraping and not-found', () => {
      expect(formatDrsExtras({
        available: 5, scraping: 3, notFound: 2, determined: true,
      })).to.equal(' (3 still scraping, 2 not yet scraped)');
    });
  });

  describe('buildAnalysisScrapeStatusMessage', () => {
    it('describes a fresh scrape that finished this cycle', () => {
      const msg = buildAnalysisScrapeStatusMessage({
        analysisName: 'reddit-analysis',
        baseUrl: 'https://example.com',
        urlCount: 12,
        counts: {
          available: 12, scraping: 0, notFound: 0, determined: true,
        },
        scrapedNow: true,
      });
      expect(msg).to.equal(
        ':mag: *reddit-analysis* for *https://example.com* — DRS scrape finished. '
        + 'Sending *12* available URL(s) from the URL store to Mystique for analysis.',
      );
    });

    it('describes reused prior content and appends the pending breakdown', () => {
      const msg = buildAnalysisScrapeStatusMessage({
        analysisName: 'cited-analysis',
        baseUrl: 'https://example.com',
        urlCount: 8,
        counts: {
          available: 8, scraping: 2, notFound: 1, determined: true,
        },
        scrapedNow: false,
      });
      expect(msg).to.equal(
        ':mag: *cited-analysis* for *https://example.com* — reusing previously scraped DRS content '
        + '(no new scrape needed). Sending *8* available URL(s) from the URL store to Mystique '
        + 'for analysis (2 still scraping, 1 not yet scraped).',
      );
    });
  });

  describe('scrapedThisCycle', () => {
    it('is true when both DRS timing anchors are present', () => {
      expect(scrapedThisCycle({ timings: { drsStartedAt: 1, drsCompletedAt: 2 } })).to.equal(true);
    });

    it('is false when timing anchors are missing (reused prior content)', () => {
      expect(scrapedThisCycle({ timings: { analysisStartedAt: 1 } })).to.equal(false);
      expect(scrapedThisCycle({})).to.equal(false);
      expect(scrapedThisCycle(undefined)).to.equal(false);
    });
  });

  describe('resolveMystiqueUrlLimit', () => {
    it('returns MYSTIQUE_URLS_LIMIT when urlLimit is absent', () => {
      expect(resolveMystiqueUrlLimit({})).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit(undefined)).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit(null)).to.equal(MYSTIQUE_URLS_LIMIT);
    });

    it('returns integer urlLimit when valid and below cap', () => {
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 5 } })).to.equal(5);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: '12' } })).to.equal(12);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 8 } })).to.equal(8);
    });

    it('returns cap when urlLimit exceeds MYSTIQUE_URLS_LIMIT', () => {
      const log = { info: sandbox.stub() };
      expect(resolveMystiqueUrlLimit(
        { messageData: { urlLimit: MYSTIQUE_URLS_LIMIT + 10 } },
        log,
        '[T]',
      )).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(log.info).to.have.been.calledOnce;
    });

    it('returns default and warns when urlLimit is invalid', () => {
      const log = { warn: sandbox.stub() };
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 'x' } }, log, '[T]')).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 1.5 } }, log, '[T]')).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(log.warn).to.have.been.calledTwice;
    });
  });

  describe('resolveEnableBrandProfile', () => {
    it('returns undefined when auditContext or messageData is absent, so the flag is omitted', () => {
      expect(resolveEnableBrandProfile({})).to.be.undefined;
      expect(resolveEnableBrandProfile(undefined)).to.be.undefined;
      expect(resolveEnableBrandProfile(null)).to.be.undefined;
      expect(resolveEnableBrandProfile({ messageData: { enableBrandProfile: '' } })).to.be.undefined;
    });

    it('returns true for boolean true or the string "true"', () => {
      expect(resolveEnableBrandProfile(
        { messageData: { enableBrandProfile: true } },
      )).to.equal(true);
      expect(resolveEnableBrandProfile(
        { messageData: { enableBrandProfile: 'true' } },
      )).to.equal(true);
    });

    it('returns false for boolean false or the string "false"', () => {
      expect(resolveEnableBrandProfile(
        { messageData: { enableBrandProfile: false } },
      )).to.equal(false);
      expect(resolveEnableBrandProfile(
        { messageData: { enableBrandProfile: 'false' } },
      )).to.equal(false);
    });

    it('returns undefined and warns when enableBrandProfile is invalid', () => {
      const log = { warn: sandbox.stub() };
      expect(resolveEnableBrandProfile({ messageData: { enableBrandProfile: 'yes' } }, log, '[T]')).to.be.undefined;
      expect(log.warn).to.have.been.calledOnce;
    });

    it('returns undefined and warns for numeric values (e.g. 0), same as any other invalid input', () => {
      const log = { warn: sandbox.stub() };
      expect(resolveEnableBrandProfile({ messageData: { enableBrandProfile: 0 } }, log, '[T]')).to.be.undefined;
      expect(resolveEnableBrandProfile({ messageData: { enableBrandProfile: 1 } }, log, '[T]')).to.be.undefined;
      expect(log.warn).to.have.been.calledTwice;
    });
  });

  describe('requestOffsiteScrape', () => {
    let context;

    beforeEach(() => {
      context = {
        sqs: { sendMessage: sandbox.stub().resolves() },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves({
              getQueues: () => ({ audits: 'audits-queue-url' }),
            }),
          },
        },
        log: { info: sandbox.stub(), warn: sandbox.stub() },
      };
    });

    it('sends a scoped offsite-brand-presence message without enableBrandProfile by default', async () => {
      await requestOffsiteScrape(context, 'site-1', 'top-cited', { channelId: 'C1', threadTs: 'T1' });

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [queueUrl, msg] = context.sqs.sendMessage.firstCall.args;
      expect(queueUrl).to.equal('audits-queue-url');
      expect(msg).to.deep.equal({
        type: 'offsite-brand-presence',
        siteId: 'site-1',
        auditContext: {
          slackContext: { channelId: 'C1', threadTs: 'T1' },
          messageData: { domainScope: 'top-cited' },
        },
      });
    });

    it('forwards enableBrandProfile in messageData when true', async () => {
      await requestOffsiteScrape(context, 'site-1', 'reddit.com', undefined, true);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.slackContext).to.be.undefined;
      expect(msg.auditContext.messageData).to.deep.equal({ domainScope: 'reddit.com', enableBrandProfile: true });
    });

    it('forwards explicit enableBrandProfile:false in messageData (distinct from absent)', async () => {
      await requestOffsiteScrape(context, 'site-1', 'youtube.com', undefined, false);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.messageData).to.deep.equal({ domainScope: 'youtube.com', enableBrandProfile: false });
    });

    it('swallows and logs a warning when the send fails', async () => {
      context.dataAccess.Configuration.findLatest.rejects(new Error('boom'));

      await requestOffsiteScrape(context, 'site-1', 'top-cited', undefined, true);

      expect(context.log.warn).to.have.been.calledWithMatch(/Failed to request DRS scrape/);
    });
  });

  describe('NON_EARNED_EXCLUDED_DOMAINS', () => {
    it('is a frozen list of social/search/aggregator domains', () => {
      expect(NON_EARNED_EXCLUDED_DOMAINS).to.be.an('array');
      expect(Object.isFrozen(NON_EARNED_EXCLUDED_DOMAINS)).to.be.true;
      expect(NON_EARNED_EXCLUDED_DOMAINS).to.include.members([
        'google.com', 'facebook.com', 'instagram.com', 'groupon.com',
      ]);
    });

    it('does not include youtube/reddit (routed to their own analyses)', () => {
      expect(NON_EARNED_EXCLUDED_DOMAINS).to.not.include('youtube.com');
      expect(NON_EARNED_EXCLUDED_DOMAINS).to.not.include('reddit.com');
    });
  });

  describe('computeBrandTokens', () => {
    it('derives a token from the site apex label', () => {
      const tokens = computeBrandTokens('lovesac.com');
      expect([...tokens]).to.deep.equal(['lovesac']);
    });

    it('strips a leading subdomain to use only the first label', () => {
      // www-stripped hostnames are passed in; the apex label is the first label.
      expect([...computeBrandTokens('bmw.com')]).to.deep.equal(['bmw']);
    });

    it('unions normalized brand keywords with the apex label', () => {
      const tokens = computeBrandTokens('lovesac.com', ['Loved By Lovesac', 'SACTIONAL']);
      expect(tokens.has('lovesac')).to.be.true;
      expect(tokens.has('lovedbylovesac')).to.be.true;
      expect(tokens.has('sactional')).to.be.true;
    });

    it('drops tokens shorter than 3 chars (apex label and keywords)', () => {
      const tokens = computeBrandTokens('hp.com', ['ab', 'xyz']);
      expect(tokens.has('hp')).to.be.false;
      expect(tokens.has('ab')).to.be.false;
      expect(tokens.has('xyz')).to.be.true;
    });

    it('returns an empty set for missing hostname and keywords', () => {
      expect([...computeBrandTokens()]).to.deep.equal([]);
      expect([...computeBrandTokens('', null)]).to.deep.equal([]);
    });
  });

  describe('isExcludedCitedHost', () => {
    const tokens = computeBrandTokens('lovesac.com');

    it('returns a domain reason for non-earned domains and their subdomains', () => {
      expect(isExcludedCitedHost('google.com')).to.equal('domain:google.com');
      expect(isExcludedCitedHost('www.facebook.com')).to.equal('domain:facebook.com');
      expect(isExcludedCitedHost('m.instagram.com')).to.equal('domain:instagram.com');
      expect(isExcludedCitedHost('groupon.com')).to.equal('domain:groupon.com');
    });

    it('returns a brand-token reason for brand-owned lookalike hosts', () => {
      expect(isExcludedCitedHost('lovedbylovesac.com', tokens)).to.equal('brand-token:lovesac');
      expect(isExcludedCitedHost('www.lovesac.com', tokens)).to.equal('brand-token:lovesac');
      // accepted false positive: independent reviewer with brand name in host
      expect(isExcludedCitedHost('lovesac-reviews.com', tokens)).to.equal('brand-token:lovesac');
    });

    it('returns null for neutral third-party hosts (no token, no path matching)', () => {
      expect(isExcludedCitedHost('techradar.com', tokens)).to.be.null;
      expect(isExcludedCitedHost('caranddriver.com', tokens)).to.be.null;
    });

    it('does not match a non-earned domain as a bare substring', () => {
      // "notgoogle.com" is not google.com nor a subdomain of it.
      expect(isExcludedCitedHost('notgoogle.com')).to.be.null;
    });

    it('returns null for empty host and when no brand tokens are supplied', () => {
      expect(isExcludedCitedHost('')).to.be.null;
      expect(isExcludedCitedHost(undefined, tokens)).to.be.null;
      expect(isExcludedCitedHost('lovedbylovesac.com')).to.be.null;
    });
  });

  describe('toApexHost', () => {
    it('strips scheme and leading www from a full URL', () => {
      expect(toApexHost('https://www.bmw.com/news')).to.equal('bmw.com');
      expect(toApexHost('http://m.bmw.com/owners')).to.equal('m.bmw.com');
    });

    it('accepts a bare host string (no scheme) and lowercases it', () => {
      expect(toApexHost('BMW.com')).to.equal('bmw.com');
    });

    it('returns empty string for falsy, whitespace-only, or unparseable input', () => {
      expect(toApexHost('')).to.equal('');
      expect(toApexHost(undefined)).to.equal('');
      expect(toApexHost('   ')).to.equal('');
      expect(toApexHost('http://[bad')).to.equal('');
    });
  });

  describe('formatDuration', () => {
    it('returns null for missing, negative, or non-finite input', () => {
      expect(formatDuration(undefined)).to.equal(null);
      expect(formatDuration(NaN)).to.equal(null);
      expect(formatDuration(-1)).to.equal(null);
      expect(formatDuration(Infinity)).to.equal(null);
    });

    it('formats sub-minute durations as seconds', () => {
      expect(formatDuration(0)).to.equal('0s');
      expect(formatDuration(42_000)).to.equal('42s');
      expect(formatDuration(59_400)).to.equal('59s');
    });

    it('formats whole minutes without a seconds part', () => {
      expect(formatDuration(180_000)).to.equal('3m');
    });

    it('formats minutes with a remaining seconds part', () => {
      expect(formatDuration(190_000)).to.equal('3m 10s');
    });
  });

  describe('buildOffsiteTimingLines', () => {
    const now = 1_000_000;

    it('returns empty string when timings are missing or lack analysisStartedAt', () => {
      expect(buildOffsiteTimingLines(undefined, now)).to.equal('');
      expect(buildOffsiteTimingLines({}, now)).to.equal('');
      expect(buildOffsiteTimingLines({ analysisStartedAt: 'x' }, now)).to.equal('');
    });

    it('reports DRS, Mystique, and total when DRS timings are present', () => {
      const timings = {
        drsStartedAt: now - 100_000, // DRS scrape started 100s before "now"
        drsCompletedAt: now - 60_000, // finished 40s later → DRS = 40s
        analysisStartedAt: now - 30_000, // analysis (Mystique) started 30s before now
      };
      const lines = buildOffsiteTimingLines(timings, now);
      expect(lines).to.include('• DRS scrape: 40s');
      expect(lines).to.include('• Suggestion generation (Mystique): 30s');
      // total = DRS (40s) + Mystique (30s) = 70s → rendered as minutes+seconds
      expect(lines).to.include('• Total (DRS + Mystique): 1m 10s');
    });

    it('reports DRS as n/a when no scrape ran this cycle', () => {
      const lines = buildOffsiteTimingLines({ analysisStartedAt: now - 45_000 }, now);
      expect(lines).to.include('• DRS scrape: reused prior scrape (n/a)');
      expect(lines).to.include('• Suggestion generation (Mystique): 45s');
      expect(lines).to.include('• Total: 45s');
      expect(lines).to.not.include('DRS + Mystique');
    });

    it('returns empty string when the elapsed Mystique time is not computable', () => {
      // analysisStartedAt in the future → negative elapsed → no usable duration.
      expect(buildOffsiteTimingLines({ analysisStartedAt: now + 5_000 }, now)).to.equal('');
    });
  });
});
