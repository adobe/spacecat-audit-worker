/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Post-processor that publishes LHS audit metrics as blackboard facts.
 * Writes to blackboard_fact table for consumption by Mystique control system.
 */

import { isObject } from '@adobe/spacecat-shared-utils';
import {
  supersedePreviousFact,
  createFactData,
  publishFactsToBlackboard,
} from '../common/blackboard-utils.js';

const FACT_KEYS = {
  MOBILE: {
    PERFORMANCE: 'lhs-mobile-performance',
    SEO: 'lhs-mobile-seo',
    ACCESSIBILITY: 'lhs-mobile-accessibility',
    BEST_PRACTICES: 'lhs-mobile-best-practices',
    TBT: 'lhs-mobile-tbt',
    THIRD_PARTY: 'lhs-mobile-third-party',
    CSP: 'lhs-mobile-csp',
    RUNTIME_ERROR: 'lhs-mobile-runtime-error',
  },
  DESKTOP: {
    PERFORMANCE: 'lhs-desktop-performance',
    SEO: 'lhs-desktop-seo',
    ACCESSIBILITY: 'lhs-desktop-accessibility',
    BEST_PRACTICES: 'lhs-desktop-best-practices',
    TBT: 'lhs-desktop-tbt',
    THIRD_PARTY: 'lhs-desktop-third-party',
    RUNTIME_ERROR: 'lhs-desktop-runtime-error',
  },
};

/**
 * Publishes LHS audit metrics as blackboard facts.
 * @param {Object} auditData - Audit data from LHS runner
 * @param {Object} site - Site object
 * @param {Object} context - Lambda context
 * @param {string} strategy - 'mobile' or 'desktop'
 */
export async function publishLHSFactsToBlackboard(auditData, site, context, strategy) {
  const { dataAccess, log } = context;
  const { BlackboardFact } = dataAccess;

  if (!BlackboardFact) {
    log.warn('BlackboardFact not available in dataAccess - skipping blackboard publish');
    return;
  }

  const { auditResult } = auditData;
  const {
    scores, totalBlockingTime, thirdPartySummary, csp, runtimeError,
  } = auditResult;

  const organizationId = site.getOrganizationId();
  const websiteId = site.getId();
  const eventTime = new Date().toISOString();
  const source = `lhs-${strategy}-audit`;

  const keys = strategy === 'mobile' ? FACT_KEYS.MOBILE : FACT_KEYS.DESKTOP;
  const factsToCreate = [];

  // Score facts
  if (scores) {
    const scoreEntries = Object.entries(scores);
    for (let i = 0; i < scoreEntries.length; i += 1) {
      const [scoreType, score] = scoreEntries[i];
      const factKey = keys[scoreType.toUpperCase().replace(/-/g, '_')];
      if (!factKey) {
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const previousFact = await supersedePreviousFact(
        dataAccess,
        factKey,
        organizationId,
        websiteId,
      );

      factsToCreate.push(createFactData({
        key: factKey,
        value: { score, strategy },
        source,
        organizationId,
        websiteId,
        eventTime,
        version: previousFact ? previousFact.getVersion() + 1 : 1,
        supersedesFactId: previousFact ? previousFact.getId() : null,
      }));
    }
  }

  // TBT fact
  if (totalBlockingTime !== null && totalBlockingTime !== undefined) {
    const previousFact = await supersedePreviousFact(
      dataAccess,
      keys.TBT,
      organizationId,
      websiteId,
    );

    factsToCreate.push(createFactData({
      key: keys.TBT,
      value: { tbt_ms: totalBlockingTime, strategy },
      source,
      organizationId,
      websiteId,
      eventTime,
      version: previousFact ? previousFact.getVersion() + 1 : 1,
      supersedesFactId: previousFact ? previousFact.getId() : null,
    }));
  }

  // Third-party summary fact
  if (thirdPartySummary && thirdPartySummary.length > 0) {
    const previousFact = await supersedePreviousFact(
      dataAccess,
      keys.THIRD_PARTY,
      organizationId,
      websiteId,
    );

    const totalBlockingMs = thirdPartySummary.reduce(
      (sum, item) => sum + (item.blockingTime || 0),
      0,
    );

    factsToCreate.push(createFactData({
      key: keys.THIRD_PARTY,
      value: {
        entities: thirdPartySummary,
        total_blocking_time: totalBlockingMs,
        strategy,
      },
      source,
      organizationId,
      websiteId,
      eventTime,
      version: previousFact ? previousFact.getVersion() + 1 : 1,
      supersedesFactId: previousFact ? previousFact.getId() : null,
    }));
  }

  // CSP fact (mobile only)
  if (strategy === 'mobile' && csp && csp.length > 0) {
    const previousFact = await supersedePreviousFact(
      dataAccess,
      keys.CSP,
      organizationId,
      websiteId,
    );

    factsToCreate.push(createFactData({
      key: keys.CSP,
      value: { violations: csp, strategy },
      source,
      organizationId,
      websiteId,
      eventTime,
      version: previousFact ? previousFact.getVersion() + 1 : 1,
      supersedesFactId: previousFact ? previousFact.getId() : null,
    }));
  }

  // Runtime error fact
  if (isObject(runtimeError) && runtimeError.code) {
    const previousFact = await supersedePreviousFact(
      dataAccess,
      keys.RUNTIME_ERROR,
      organizationId,
      websiteId,
    );

    factsToCreate.push(createFactData({
      key: keys.RUNTIME_ERROR,
      value: {
        code: runtimeError.code,
        message: runtimeError.message,
        strategy,
      },
      source,
      organizationId,
      websiteId,
      eventTime,
      version: previousFact ? previousFact.getVersion() + 1 : 1,
      supersedesFactId: previousFact ? previousFact.getId() : null,
    }));
  }

  // Bulk create facts
  await publishFactsToBlackboard(dataAccess, factsToCreate, log, `lhs-${strategy}`, websiteId);
}

/**
 * Post-processor wrapper for mobile LHS audits.
 */
export async function lhsMobileBlackboardPublisher(auditData, site, context) {
  await publishLHSFactsToBlackboard(auditData, site, context, 'mobile');
}

/**
 * Post-processor wrapper for desktop LHS audits.
 */
export async function lhsDesktopBlackboardPublisher(auditData, site, context) {
  await publishLHSFactsToBlackboard(auditData, site, context, 'desktop');
}
