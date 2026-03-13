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

/* eslint-env mocha */

import { expect } from 'chai';
import { InternalLinksConfigResolver } from '../../../src/internal-links/config.js';

function createSite(config = {}, deliveryConfig = {}) {
  return {
    getConfig: () => ({
      getHandlers: () => ({
        'broken-internal-links': {
          config,
        },
      }),
    }),
    getDeliveryConfig: () => deliveryConfig,
  };
}

describe('internal-links config resolver', () => {
  it('returns default scraper and polling config when handler config is empty', () => {
    const resolver = new InternalLinksConfigResolver(createSite(), {});

    expect(resolver.isLinkCheckerEnabled()).to.equal(false);
    expect(resolver.getLinkCheckerLookbackMinutes()).to.equal(1440);
    expect(resolver.getLinkCheckerMaxJobDurationMinutes()).to.equal(60);
    expect(resolver.getLinkCheckerPollingConfig()).to.deep.equal({
      maxPollAttempts: 10,
      pollIntervalMs: 60000,
    });
    expect(resolver.getIncludedStatusBuckets()).to.deep.equal([
      'not_found_404',
      'gone_410',
      'forbidden_or_blocked',
      'server_error_5xx',
      'timeout_or_network',
      'redirect_chain_excessive',
      'soft_404',
      'masked_by_linkchecker',
    ]);
    expect(resolver.getIncludedItemTypes()).to.deep.equal([
      'link',
      'form',
      'image',
      'svg',
      'css',
      'js',
      'iframe',
      'video',
      'audio',
      'media',
    ]);
    expect(resolver.getMystiqueItemTypes()).to.deep.equal([
      'link',
      'form',
      'image',
      'svg',
      'css',
      'js',
    ]);
    expect(resolver.getScraperOptions()).to.include({
      enableJavascript: true,
      waitUntil: 'networkidle2',
      scrollToBottom: true,
      clickLoadMore: true,
      hideConsentBanners: true,
    });
  });

  it('prefers site config over env overrides', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      linkCheckerMaxPollAttempts: 12,
      linkCheckerPollIntervalMs: 1500,
      brightDataMaxResults: 20,
      brightDataRequestDelayMs: 250,
      validateBrightDataUrls: true,
    }), {
      LINKCHECKER_MAX_POLL_ATTEMPTS: '5',
      LINKCHECKER_POLL_INTERVAL_MS: '7000',
      BRIGHT_DATA_MAX_RESULTS: '8',
      BRIGHT_DATA_REQUEST_DELAY_MS: '900',
      BRIGHT_DATA_VALIDATE_URLS: 'false',
    });

    expect(resolver.getLinkCheckerPollingConfig()).to.deep.equal({
      maxPollAttempts: 12,
      pollIntervalMs: 1500,
    });
    expect(resolver.getBrightDataConfig()).to.deep.equal({
      validateUrls: true,
      maxResults: 20,
      requestDelayMs: 250,
    });
    expect(resolver.getLinkCheckerProgramId()).to.equal(undefined);
    expect(resolver.getLinkCheckerEnvironmentId()).to.equal(undefined);
  });

  it('returns explicit LinkChecker program and environment IDs from handler config', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      aemProgramId: 'program-123',
      aemEnvironmentId: 'env-456',
    }), {});

    expect(resolver.getLinkCheckerProgramId()).to.equal('program-123');
    expect(resolver.getLinkCheckerEnvironmentId()).to.equal('env-456');
  });

  it('prefers deliveryConfig program and environment IDs over handler config', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      aemProgramId: 'handler-program',
      aemEnvironmentId: 'handler-env',
    }, {
      programId: 'delivery-program',
      environmentId: 'delivery-env',
    }), {});

    expect(resolver.getLinkCheckerProgramId()).to.equal('delivery-program');
    expect(resolver.getLinkCheckerEnvironmentId()).to.equal('delivery-env');
  });

  it('falls back to handler config when deliveryConfig IDs are missing', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      aemProgramId: 'handler-program',
      aemEnvironmentId: 'handler-env',
    }, {
      programId: '',
      environmentId: null,
    }), {});

    expect(resolver.getLinkCheckerProgramId()).to.equal('handler-program');
    expect(resolver.getLinkCheckerEnvironmentId()).to.equal('handler-env');
  });

  it('returns raw handler and delivery config objects', () => {
    const handlerConfig = { isLinkcheckerEnabled: true, batchSize: 25 };
    const deliveryConfig = { programId: 'delivery-program', environmentId: 'delivery-env' };
    const resolver = new InternalLinksConfigResolver(createSite(handlerConfig, deliveryConfig), {});

    expect(resolver.getHandlerConfig()).to.equal(handlerConfig);
    expect(resolver.getDeliveryConfig()).to.equal(deliveryConfig);
  });

  it('normalizes scraper options and supports scroll duration alias', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      enableJavascript: false,
      waitUntil: 'invalid-option',
      waitForSelector: '',
      scrollToBottom: false,
      scrollMaxDurationMs: 45000,
      clickLoadMore: false,
      loadMoreSelector: '  ',
      screenshotTypes: ['fullpage', 123, 'viewport'],
      hideConsentBanners: false,
    }), {});

    expect(resolver.getScraperOptions()).to.deep.equal({
      enableJavascript: false,
      pageLoadTimeout: 30000,
      evaluateTimeout: 10000,
      waitUntil: 'networkidle2',
      networkIdleTimeout: 2000,
      waitForSelector: 'body',
      rejectRedirects: false,
      expandShadowDOM: true,
      scrollToBottom: false,
      maxScrollDurationMs: 45000,
      clickLoadMore: false,
      loadMoreSelector: '  ',
      screenshotTypes: ['fullpage', 'viewport'],
      hideConsentBanners: false,
    });
  });

  it('parses configurable item types and status buckets', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      includedStatusBuckets: 'not_found_404, gone_410, masked_by_linkchecker',
      includedItemTypes: ['link', 'image'],
      mystiqueItemTypes: 'link,form',
    }), {});

    expect(resolver.getIncludedStatusBuckets()).to.deep.equal([
      'not_found_404',
      'gone_410',
      'masked_by_linkchecker',
    ]);
    expect(resolver.getIncludedItemTypes()).to.deep.equal(['link', 'image']);
    expect(resolver.getMystiqueItemTypes()).to.deep.equal(['link', 'form']);
  });

  it('falls back to defaults when configured string lists are empty after trimming', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      includedStatusBuckets: ' ,  , ',
      includedItemTypes: ['  ', ''],
    }), {});

    expect(resolver.getIncludedStatusBuckets()).to.deep.equal([
      'not_found_404',
      'gone_410',
      'forbidden_or_blocked',
      'server_error_5xx',
      'timeout_or_network',
      'redirect_chain_excessive',
      'soft_404',
      'masked_by_linkchecker',
    ]);
    expect(resolver.getIncludedItemTypes()).to.deep.equal([
      'link',
      'form',
      'image',
      'svg',
      'css',
      'js',
      'iframe',
      'video',
      'audio',
      'media',
    ]);
  });

  it('ignores non-string entries in array-based list config values', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      includedStatusBuckets: ['not_found_404', 410],
    }), {});

    expect(resolver.getIncludedStatusBuckets()).to.deep.equal(['not_found_404']);
  });

});
