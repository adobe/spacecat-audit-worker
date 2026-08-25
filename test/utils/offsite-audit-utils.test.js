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
  resolveForwardedUrlLimit,
  resolveDrsPollIntervalSeconds,
  resolveEnableBrandProfile,
  resolveEnableSemrush,
  requestOffsiteScrape,
  computeBrandTokens,
  isExcludedCitedHost,
  toApexHost,
  formatDuration,
  buildOffsiteTimingLines,
  logOffsiteLlmUsage,
  buildOffsiteLlmUsageLine,
  formatDrsExtras,
  buildAnalysisScrapeStatusMessage,
  scrapedThisCycle,
} from '../../src/utils/offsite-audit-utils.js';
import {
  DRS_POLL_INTERVAL_SECONDS,
  DRS_POLL_INTERVAL_UNATTENDED_SECONDS,
} from '../../src/offsite-brand-presence/constants.js';
import { PEER } from '../../src/utils/offsite-logging.js';

use(sinonChai);

describe('offsite-audit-utils', () => {
  let sandbox;

  // Stub offsite logger (createOffsiteLogger shape): each method emits one taxonomy line.
  // The util call sites take a bound `olog` now, so assert on these instead of raw log strings.
  const makeOlog = () => ({
    start: sandbox.stub(),
    success: sandbox.stub(),
    skip: sandbox.stub(),
    failure: sandbox.stub(),
    warn: sandbox.stub(),
    debug: sandbox.stub(),
  });

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
      const olog = makeOlog();
      const drsClient = { isConfigured: sandbox.stub().returns(false) };
      const result = await filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, olog);
      expect(result.urls).to.deep.equal(urls);
      expect(result.counts.determined).to.equal(false);
      expect(olog.skip).to.have.been.calledWith(
        'data_acquisition_scrape_content_checked',
        'DRS client not configured, skipping availability filter',
        sinon.match({ reason: 'drs_not_configured' }),
      );
    });

    it('filters to URLs available in at least one dataset', async () => {
      const olog = makeOlog();
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

      const result = await filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, olog);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls.map((u) => u.url)).to.include.members([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      expect(result.counts).to.deep.equal({
        total: 3, available: 2, scraping: 0, notFound: 1, determined: true,
      });
      expect(olog.success).to.have.been.calledWith(
        'data_acquisition_scrape_content_checked',
        'DRS availability filter removed URLs not yet scraped',
        sinon.match({ peer: PEER.DRS, removed: 1, remaining: 2 }),
      );
    });

    it('logs summary per dataset', async () => {
      const olog = makeOlog();
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: [{ url: 'https://example.com/a', status: 'available' }],
          summary: {
            total: 3, available: 1, scraping: 0, not_found: 2,
          },
        }),
      };

      await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, olog);

      expect(olog.success).to.have.been.calledWith(
        'data_acquisition_scrape_content_checked',
        'DRS lookup dataset summary',
        sinon.match({
          peer: PEER.DRS, datasetId: 'ds1', available: 1, total: 3,
        }),
      );
    });

    it('counts still-scraping URLs separately from not-found ones', async () => {
      const olog = makeOlog();
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

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, olog);

      expect(result.urls.map((u) => u.url)).to.deep.equal(['https://example.com/a']);
      expect(result.counts).to.deep.equal({
        total: 3, available: 1, scraping: 1, notFound: 1, determined: true,
      });
      expect(olog.success).to.have.been.calledWith(
        'data_acquisition_scrape_content_checked',
        'DRS availability filter removed URLs not yet scraped',
        sinon.match({ peer: PEER.DRS, removed: 2, remaining: 1 }),
      );
    });

    it('throws DrsNoContentAvailableError when DRS responded but no URLs are available', async () => {
      const olog = makeOlog();
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
        await filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, olog);
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
      const olog = makeOlog();
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves(null),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, olog);

      expect(result.urls).to.deep.equal(urls);
      expect(result.counts.determined).to.equal(false);
      expect(olog.warn).to.have.been.calledWith('data_acquisition_scrape_content_checked', sinon.match(/DRS lookup returned null/), sinon.match({ peer: PEER.DRS, datasetId: 'ds1', reason: 'null_response' }));
      expect(olog.warn).to.have.been.calledWith('data_acquisition_scrape_content_checked', sinon.match(/All DRS lookups failed or returned null/), sinon.match({ peer: PEER.DRS, reason: 'all_failed' }));
    });

    it('falls back to full list when all lookups throw', async () => {
      const olog = makeOlog();
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().rejects(new Error('network error')),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, olog);

      expect(result.urls).to.deep.equal(urls);
      expect(result.counts.determined).to.equal(false);
      expect(olog.warn).to.have.been.calledWith('data_acquisition_scrape_content_checked', sinon.match(/DRS lookup failed; skipping dataset/), sinon.match({
        peer: PEER.DRS, datasetId: 'ds1', errorName: 'Error', errorMessage: 'network error',
      }));
      expect(olog.warn).to.have.been.calledWith('data_acquisition_scrape_content_checked', sinon.match(/All DRS lookups failed or returned null/), sinon.match({ peer: PEER.DRS, reason: 'all_failed' }));
    });

    it('does not log removed count when all URLs pass the filter', async () => {
      const olog = makeOlog();
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: urls.map((u) => ({ url: u.url, status: 'available' })),
          summary: {
            total: 3, available: 3, scraping: 0, not_found: 0,
          },
        }),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, olog);

      expect(result.urls).to.deep.equal(urls);
      expect(result.counts).to.deep.equal({
        total: 3, available: 3, scraping: 0, notFound: 0, determined: true,
      });
      expect(olog.debug).to.not.have.been.calledWith('data_acquisition_scrape_content_checked', sinon.match(/DRS availability filter: removed/));
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
      const olog = makeOlog();
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves({
          results: [{ url: 'https://example.com/a', status: 'available' }],
        }),
      };

      await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, olog);

      expect(olog.success).to.have.been.calledWith(
        'data_acquisition_scrape_content_checked',
        'DRS lookup dataset summary',
        sinon.match({
          peer: PEER.DRS, datasetId: 'ds1', available: 0, total: urls.length,
        }),
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

    it('reports both sent and store counts when the store exceeds the cap', () => {
      const msg = buildAnalysisScrapeStatusMessage({
        analysisName: 'cited-analysis',
        baseUrl: 'https://lilly.com',
        urlCount: 68,
        urlLimit: 50,
        counts: {
          available: 68, scraping: 0, notFound: 2, determined: true,
        },
        scrapedNow: false,
      });
      expect(msg).to.equal(
        ':mag: *cited-analysis* for *https://lilly.com* — reusing previously scraped DRS content '
        + '(no new scrape needed). Sending *50* of *68* available URL(s) '
        + 'from the URL store to Mystique for analysis (2 not yet scraped).',
      );
    });

    it('reports the plain store count when it is within the cap', () => {
      const msg = buildAnalysisScrapeStatusMessage({
        analysisName: 'reddit-analysis',
        baseUrl: 'https://example.com',
        urlCount: 12,
        urlLimit: 50,
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
      const olog = makeOlog();
      expect(resolveMystiqueUrlLimit(
        { messageData: { urlLimit: MYSTIQUE_URLS_LIMIT + 10 } },
        olog,
      )).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(olog.debug).to.have.been.calledOnceWith('audit_orchestration_analysis_url_limit_resolved', sinon.match(/exceeds cap/), sinon.match({ requested: MYSTIQUE_URLS_LIMIT + 10, cap: MYSTIQUE_URLS_LIMIT, urlLimit: MYSTIQUE_URLS_LIMIT }));
    });

    it('returns default and warns when urlLimit is invalid', () => {
      const olog = makeOlog();
      const nonInt = resolveMystiqueUrlLimit({ messageData: { urlLimit: 'x' } }, olog);
      const fractional = resolveMystiqueUrlLimit({ messageData: { urlLimit: 1.5 } }, olog);
      expect(nonInt).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(fractional).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(olog.warn).to.have.been.calledTwice;
      expect(olog.warn).to.have.been.calledWith(
        'audit_orchestration_analysis_url_limit_resolved',
        sinon.match(/Invalid urlLimit/),
        sinon.match({ reason: 'invalid' }),
      );
    });
  });

  describe('resolveForwardedUrlLimit', () => {
    it('returns undefined when urlLimit is absent, so the default is not forced onto every run', () => {
      expect(resolveForwardedUrlLimit({})).to.be.undefined;
      expect(resolveForwardedUrlLimit(undefined)).to.be.undefined;
      expect(resolveForwardedUrlLimit(null)).to.be.undefined;
      expect(resolveForwardedUrlLimit({ messageData: { urlLimit: '' } })).to.be.undefined;
    });

    it('resolves and caps an explicit urlLimit, like resolveMystiqueUrlLimit', () => {
      expect(resolveForwardedUrlLimit({ messageData: { urlLimit: 5 } })).to.equal(5);
      expect(resolveForwardedUrlLimit(
        { messageData: { urlLimit: MYSTIQUE_URLS_LIMIT + 10 } },
      )).to.equal(MYSTIQUE_URLS_LIMIT);
    });

    it('falls back to the default and warns when an explicit urlLimit is invalid', () => {
      const log = { warn: sandbox.stub() };
      expect(resolveForwardedUrlLimit({ messageData: { urlLimit: 'x' } }, log, '[T]'))
        .to.equal(MYSTIQUE_URLS_LIMIT);
      expect(log.warn).to.have.been.calledOnce;
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

    it('returns undefined and warns via the bound olog under audit_orchestration_brand_profile_resolved when enableBrandProfile is invalid', () => {
      const olog = makeOlog();
      expect(resolveEnableBrandProfile({ messageData: { enableBrandProfile: 'yes' } }, olog)).to.be.undefined;
      expect(olog.warn).to.have.been.calledOnce;
      const [event, message, extra] = olog.warn.firstCall.args;
      expect(event).to.equal('audit_orchestration_brand_profile_resolved');
      expect(message).to.equal('Invalid override value in auditContext, omitting');
      expect(extra).to.include({
        reason: 'invalid_override',
        reasonCategory: 'config',
        field: 'enableBrandProfile',
      });
    });

    it('returns undefined and warns for numeric values (e.g. 0), same as any other invalid input', () => {
      const olog = makeOlog();
      const ctxZero = { messageData: { enableBrandProfile: 0 } };
      const ctxOne = { messageData: { enableBrandProfile: 1 } };
      expect(resolveEnableBrandProfile(ctxZero, olog)).to.be.undefined;
      expect(resolveEnableBrandProfile(ctxOne, olog)).to.be.undefined;
      expect(olog.warn).to.have.been.calledTwice;
    });

    it('does not throw when no olog is supplied for an invalid value', () => {
      expect(resolveEnableBrandProfile({ messageData: { enableBrandProfile: 'yes' } })).to.be.undefined;
    });
  });

  describe('resolveEnableSemrush', () => {
    it('returns undefined when auditContext or messageData is absent, so the env var applies', () => {
      expect(resolveEnableSemrush({})).to.be.undefined;
      expect(resolveEnableSemrush(undefined)).to.be.undefined;
      expect(resolveEnableSemrush(null)).to.be.undefined;
      expect(resolveEnableSemrush({ messageData: { enableSemrush: '' } })).to.be.undefined;
    });

    it('returns true for boolean true or the string "true"', () => {
      expect(resolveEnableSemrush(
        { messageData: { enableSemrush: true } },
      )).to.equal(true);
      expect(resolveEnableSemrush(
        { messageData: { enableSemrush: 'true' } },
      )).to.equal(true);
    });

    it('returns false for boolean false or the string "false"', () => {
      expect(resolveEnableSemrush(
        { messageData: { enableSemrush: false } },
      )).to.equal(false);
      expect(resolveEnableSemrush(
        { messageData: { enableSemrush: 'false' } },
      )).to.equal(false);
    });

    it('returns undefined and warns via the bound olog under data_acquisition_bp_data_source_selected when enableSemrush is invalid', () => {
      const olog = makeOlog();
      expect(resolveEnableSemrush({ messageData: { enableSemrush: 'yes' } }, olog)).to.be.undefined;
      expect(olog.warn).to.have.been.calledOnce;
      const [event, message, extra] = olog.warn.firstCall.args;
      expect(event).to.equal('data_acquisition_bp_data_source_selected');
      expect(message).to.equal('Invalid override value in auditContext, omitting');
      expect(extra).to.include({
        reason: 'invalid_override',
        reasonCategory: 'config',
        field: 'enableSemrush',
      });
    });

    it('returns undefined and warns for numeric values (e.g. 0), same as any other invalid input', () => {
      const olog = makeOlog();
      expect(resolveEnableSemrush({ messageData: { enableSemrush: 0 } }, olog)).to.be.undefined;
      expect(resolveEnableSemrush({ messageData: { enableSemrush: 1 } }, olog)).to.be.undefined;
      expect(olog.warn).to.have.been.calledTwice;
    });

    it('does not throw when no olog is supplied for an invalid value', () => {
      expect(resolveEnableSemrush({ messageData: { enableSemrush: 'yes' } })).to.be.undefined;
    });
  });

  describe('requestOffsiteScrape', () => {
    let context;
    let olog;

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
      olog = makeOlog();
    });

    it('sends a scoped offsite-brand-presence message without enableBrandProfile by default', async () => {
      await requestOffsiteScrape(context, 'site-1', 'top-cited', { channelId: 'C1', threadTs: 'T1' }, undefined, undefined, undefined, olog);

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
      expect(olog.success).to.have.been.calledWith(
        'data_acquisition_scrape_job_request_dispatched',
        sinon.match(/Requested DRS scrape/),
        sinon.match({ reason: 'self_heal', domainScope: 'top-cited' }),
      );
    });

    it('forwards enableBrandProfile in messageData when true', async () => {
      await requestOffsiteScrape(context, 'site-1', 'reddit.com', undefined, true, undefined, undefined, olog);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.slackContext).to.be.undefined;
      expect(msg.auditContext.messageData).to.deep.equal({ domainScope: 'reddit.com', enableBrandProfile: true });
    });

    it('forwards explicit enableBrandProfile:false in messageData (distinct from absent)', async () => {
      await requestOffsiteScrape(context, 'site-1', 'youtube.com', undefined, false, undefined, undefined, olog);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.messageData).to.deep.equal({ domainScope: 'youtube.com', enableBrandProfile: false });
    });

    it('forwards urlLimit in messageData alongside enableBrandProfile', async () => {
      await requestOffsiteScrape(context, 'site-1', 'reddit.com', undefined, true, 20);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.messageData).to.deep.equal({
        domainScope: 'reddit.com',
        enableBrandProfile: true,
        urlLimit: 20,
      });
    });

    it('forwards urlLimit without enableBrandProfile when only urlLimit is given', async () => {
      await requestOffsiteScrape(context, 'site-1', 'top-cited', undefined, undefined, 15);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.messageData).to.deep.equal({ domainScope: 'top-cited', urlLimit: 15 });
    });

    it('forwards enableSemrush in messageData alongside enableBrandProfile and urlLimit', async () => {
      await requestOffsiteScrape(context, 'site-1', 'reddit.com', undefined, true, 20, true);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.messageData).to.deep.equal({
        domainScope: 'reddit.com',
        enableBrandProfile: true,
        urlLimit: 20,
        enableSemrush: true,
      });
    });

    it('forwards explicit enableSemrush:false (distinct from absent)', async () => {
      await requestOffsiteScrape(context, 'site-1', 'top-cited', undefined, undefined, undefined, false);

      const msg = context.sqs.sendMessage.firstCall.args[1];
      expect(msg.auditContext.messageData).to.deep.equal({ domainScope: 'top-cited', enableSemrush: false });
    });

    it('swallows and logs a failure when the send fails', async () => {
      context.dataAccess.Configuration.findLatest.rejects(new Error('boom'));

      await requestOffsiteScrape(context, 'site-1', 'top-cited', undefined, true, undefined, undefined, olog);

      expect(olog.failure).to.have.been.calledWith(
        'data_acquisition_scrape_job_request_dispatched',
        sinon.match(/Failed to request DRS scrape/),
        sinon.match({ reason: 'self_heal_failed', reasonCategory: 'infra' }),
      );
      expect(olog.warn).to.not.have.been.called;
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

  describe('logOffsiteLlmUsage', () => {
    let log;

    beforeEach(() => {
      log = { info: sandbox.spy() };
    });

    it('logs calls, tokens, and 4-decimal cost when llmUsage is present', () => {
      logOffsiteLlmUsage(log, '[offsite:cited]', 'site-123', {
        totalLlmCalls: 10,
        totalTokens: 326070,
        totalCostUsd: 1.468751,
      });
      expect(log.info).to.have.been.calledOnce;
      expect(log.info.firstCall.args[0]).to.equal(
        '[offsite:cited] LLM usage for siteId: site-123: 10 calls, 326070 tokens, est. cost $1.4688',
      );
    });

    it('logs nothing when llmUsage is undefined', () => {
      logOffsiteLlmUsage(log, '[offsite:cited]', 'site-123', undefined);
      expect(log.info).to.not.have.been.called;
    });

    it('logs nothing when llmUsage is null', () => {
      logOffsiteLlmUsage(log, '[offsite:cited]', 'site-123', null);
      expect(log.info).to.not.have.been.called;
    });

    it('logs nothing when llmUsage is not an object', () => {
      logOffsiteLlmUsage(log, '[offsite:cited]', 'site-123', 'oops');
      expect(log.info).to.not.have.been.called;
    });

    it('coerces missing or malformed numeric fields to 0 without throwing', () => {
      logOffsiteLlmUsage(log, '[YouTube]', 'site-999', {
        totalLlmCalls: 'x',
        totalCostUsd: undefined,
      });
      expect(log.info).to.have.been.calledOnce;
      expect(log.info.firstCall.args[0]).to.equal(
        '[YouTube] LLM usage for siteId: site-999: 0 calls, 0 tokens, est. cost $0.0000',
      );
    });
  });

  describe('buildOffsiteLlmUsageLine', () => {
    it('builds a bullet line with calls, tokens, and 4-decimal cost when present', () => {
      expect(buildOffsiteLlmUsageLine({
        totalLlmCalls: 10,
        totalTokens: 326070,
        totalCostUsd: 1.468751,
      })).to.equal('• :moneybag: LLM usage: 10 calls, 326070 tokens, est. cost $1.4688');
    });

    it('returns an empty string when llmUsage is absent or not an object', () => {
      expect(buildOffsiteLlmUsageLine(undefined)).to.equal('');
      expect(buildOffsiteLlmUsageLine(null)).to.equal('');
      expect(buildOffsiteLlmUsageLine('oops')).to.equal('');
    });

    it('coerces missing or malformed numeric fields to 0 without throwing', () => {
      expect(buildOffsiteLlmUsageLine({
        totalLlmCalls: 'x',
        totalCostUsd: undefined,
      })).to.equal('• :moneybag: LLM usage: 0 calls, 0 tokens, est. cost $0.0000');
    });
  });
});
