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
import {
  InternalLinksConfigResolver,
  createInternalLinksConfigResolver,
} from '../../../src/internal-links/config.js';

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

function createSiteWithSlackAuditConfig(slackAuditConfig = {}, handlerConfig = {}, deliveryConfig = {}) {
  return {
    getConfig: () => ({
      getHandlers: () => ({
        'broken-internal-links': {
          config: handlerConfig,
        },
      }),
      slack: {
        'broken-internal-links': {
          'audit-config': slackAuditConfig,
        },
      },
    }),
    getDeliveryConfig: () => deliveryConfig,
  };
}

function createSiteWithGetSlackAuditConfig(slackAuditConfig = {}, handlerConfig = {}, deliveryConfig = {}) {
  return {
    getConfig: () => ({
      getHandlers: () => ({
        'broken-internal-links': {
          config: handlerConfig,
        },
      }),
      getSlack: () => ({
        'broken-internal-links': {
          'audit-config': slackAuditConfig,
        },
      }),
    }),
    getDeliveryConfig: () => deliveryConfig,
  };
}

function createSiteWithNestedSlackAuditConfig(slackAuditConfig = {}, handlerConfig = {}, deliveryConfig = {}) {
  return {
    getConfig: () => ({
      getHandlers: () => ({
        'broken-internal-links': {
          config: handlerConfig,
        },
      }),
      config: {
        slack: {
          'broken-internal-links': {
            'audit-config': slackAuditConfig,
          },
        },
      },
    }),
    getDeliveryConfig: () => deliveryConfig,
  };
}

function createSiteWithRawHandlers(handlerConfig = {}, deliveryConfig = {}) {
  return {
    getConfig: () => ({
      handlers: {
        'broken-internal-links': {
          config: handlerConfig,
        },
      },
    }),
    getDeliveryConfig: () => deliveryConfig,
  };
}

function createSiteWithNestedRawHandlers(handlerConfig = {}, deliveryConfig = {}) {
  return {
    getConfig: () => ({
      config: {
        handlers: {
          'broken-internal-links': {
            config: handlerConfig,
          },
        },
      },
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

  it('uses env bright-data booleans when handler config is absent', () => {
    const resolverTrue = new InternalLinksConfigResolver(createSite(), {
      BRIGHT_DATA_VALIDATE_URLS: 'true',
    });
    const resolverFalse = new InternalLinksConfigResolver(createSite(), {
      BRIGHT_DATA_VALIDATE_URLS: 'false',
    });

    expect(resolverTrue.getBrightDataConfig().validateUrls).to.equal(true);
    expect(resolverFalse.getBrightDataConfig().validateUrls).to.equal(false);
  });

  it('falls back to default bright-data boolean when env key is absent', () => {
    const resolver = new InternalLinksConfigResolver(createSite(), {});

    expect(resolver.getBrightDataConfig().validateUrls).to.equal(false);
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

    expect(resolver.getHandlerConfig()).to.deep.equal(handlerConfig);
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

  it('preserves valid waitUntil values', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      waitUntil: 'load',
    }), {});

    expect(resolver.getScraperOptions().waitUntil).to.equal('load');
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

  it('reads broken-internal-links audit config from slack fallback structure', () => {
    const resolver = new InternalLinksConfigResolver(createSiteWithSlackAuditConfig({
      maxUrlsToProcess: 1,
      batchSize: 7,
    }), {});

    expect(resolver.getMaxUrlsToProcess()).to.equal(1);
    expect(resolver.getBatchSize()).to.equal(7);
  });

  it('reads broken-internal-links audit config from getSlack fallback structure', () => {
    const resolver = new InternalLinksConfigResolver(createSiteWithGetSlackAuditConfig({
      maxUrlsToProcess: 2,
      batchSize: 9,
    }), {});

    expect(resolver.getMaxUrlsToProcess()).to.equal(2);
    expect(resolver.getBatchSize()).to.equal(9);
  });

  it('reads broken-internal-links audit config from nested config.slack fallback structure', () => {
    const resolver = new InternalLinksConfigResolver(createSiteWithNestedSlackAuditConfig({
      maxUrlsToProcess: 4,
      batchSize: 11,
    }), {});

    expect(resolver.getMaxUrlsToProcess()).to.equal(4);
    expect(resolver.getBatchSize()).to.equal(11);
  });

  it('prefers handler config over slack fallback structure', () => {
    const resolver = new InternalLinksConfigResolver(createSiteWithSlackAuditConfig({
      maxUrlsToProcess: 1,
    }, {
      maxUrlsToProcess: 3,
    }), {});

    expect(resolver.getMaxUrlsToProcess()).to.equal(3);
  });

  it('returns configurable broken-link batch and reporting limits', () => {
    const resolver = new InternalLinksConfigResolver(createSite({
      linkCheckerMinTimeNeededMs: 1234,
      maxBrokenLinksPerSuggestionBatch: 25,
      maxBrokenLinksReported: 300,
      brightDataBatchSize: 12,
      maxAlternativeUrlsToSend: 44,
    }), {});

    expect(resolver.getLinkCheckerMinTimeNeededMs()).to.equal(1234);
    expect(resolver.getMaxBrokenLinksPerBatch()).to.equal(25);
    expect(resolver.getMaxBrokenLinksReported()).to.equal(300);
    expect(resolver.getBrightDataBatchSize()).to.equal(12);
    expect(resolver.getMaxAlternativeUrlsToSend()).to.equal(44);
  });

  it('reads broken-internal-links audit config from raw handlers structure', () => {
    const resolver = new InternalLinksConfigResolver(createSiteWithRawHandlers({
      maxUrlsToProcess: 1,
      batchSize: 5,
    }), {});

    expect(resolver.getMaxUrlsToProcess()).to.equal(1);
    expect(resolver.getBatchSize()).to.equal(5);
  });

  it('reads broken-internal-links audit config from nested config.handlers structure', () => {
    const resolver = new InternalLinksConfigResolver(createSiteWithNestedRawHandlers({
      maxUrlsToProcess: 2,
      batchSize: 6,
    }), {});

    expect(resolver.getMaxUrlsToProcess()).to.equal(2);
    expect(resolver.getBatchSize()).to.equal(6);
  });

  it('creates a resolver through the factory helper', () => {
    const site = createSite({ maxUrlsToProcess: 8 });
    const resolver = createInternalLinksConfigResolver(site, {});

    expect(resolver).to.be.instanceOf(InternalLinksConfigResolver);
    expect(resolver.getMaxUrlsToProcess()).to.equal(8);
  });

  it('handles sites without config or delivery helpers', () => {
    const resolver = new InternalLinksConfigResolver({}, {});

    expect(resolver.getHandlerConfig()).to.deep.equal({});
    expect(resolver.getDeliveryConfig()).to.deep.equal({});
    expect(resolver.getMaxUrlsToProcess()).to.equal(100);
  });

});
