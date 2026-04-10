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
  filterUrlsByDrsStatus,
  resolveMystiqueUrlLimit,
} from '../../src/utils/offsite-audit-utils.js';

use(sinonChai);

describe('offsite-audit-utils', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
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

    it('returns original list when drsClient is null', async () => {
      const result = await filterUrlsByDrsStatus(urls, datasetIds, siteId, null);
      expect(result).to.deep.equal(urls);
    });

    it('returns original list when drsClient is not configured', async () => {
      const log = { info: sandbox.stub() };
      const drsClient = { isConfigured: sandbox.stub().returns(false) };
      const result = await filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, log, '[T]');
      expect(result).to.deep.equal(urls);
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

      expect(result).to.have.lengthOf(2);
      expect(result.map((u) => u.url)).to.include.members([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      expect(log.info).to.have.been.calledWith('[T] DRS availability filter: removed 1 URL(s) not yet scraped, 2 remaining');
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

      expect(log.info).to.have.been.calledWith('[T] DRS lookup datasetId=ds1: 1/3 available');
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

      await expect(
        filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, log, '[T]'),
      ).to.be.rejectedWith(DrsNoContentAvailableError);
    });

    it('falls back to full list when all lookups return null', async () => {
      const log = { info: sandbox.stub(), warn: sandbox.stub() };
      const drsClient = {
        isConfigured: sandbox.stub().returns(true),
        lookupScrapeResults: sandbox.stub().resolves(null),
      };

      const result = await filterUrlsByDrsStatus(urls, ['ds1'], siteId, drsClient, log, '[T]');

      expect(result).to.deep.equal(urls);
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

      expect(result).to.deep.equal(urls);
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

      expect(result).to.deep.equal(urls);
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

      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('https://example.com/a');
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
        `[T] DRS lookup datasetId=ds1: 0/${urls.length} available`,
      );
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
});
