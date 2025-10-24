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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { AthenaCollector } from './collectors/athena-collector.js';
import { AnalysisStrategy } from './analysis/analysis-strategy.js';
import { PathIndex } from './domain/index/path-index.js';
import { AemClient } from './clients/aem-client.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export async function fetchBrokenContentFragmentLinks(context) {
  const { log, site } = context;

  try {
    const collector = await AthenaCollector.createFrom(context);
    const brokenPaths = await collector.fetchBrokenPaths();

    log.info(`Found ${brokenPaths.length} broken content fragment paths from ${collector.constructor.name}`);

    return {
      siteId: site.getId(),
      fullAuditRef: site.getBaseURL(),
      auditResult: {
        brokenPaths,
        success: true,
      },
    };
  } catch (error) {
    log.error(`Failed to fetch broken content fragment paths: ${error.message}`);
    return {
      siteId: site.getId(),
      fullAuditRef: site.getBaseURL(),
      auditResult: {
        error: error.message,
        success: false,
      },
    };
  }
}

export async function analyzeBrokenContentFragmentLinks(context) {
  const { log, audit, site } = context;

  const auditResult = audit.getAuditResult();
  if (!auditResult.success) {
    throw new Error('Audit failed, skipping content fragment path analysis');
  }

  try {
    const pathIndex = new PathIndex(context);
    const aemClient = AemClient.createFrom(context, pathIndex);
    const strategy = new AnalysisStrategy(context, aemClient, pathIndex);

    // Extract URLs for analysis while keeping the full brokenPaths data
    const urls = auditResult.brokenPaths.map((item) => item.url || item);
    const suggestions = await strategy.analyze(urls);

    log.info(`Found ${suggestions.length} suggestions for broken content fragment paths`);

    return {
      siteId: site.getId(),
      fullAuditRef: site.getBaseURL(),
      auditResult: {
        brokenPaths: auditResult.brokenPaths,
        suggestions: suggestions.map((suggestion) => suggestion.toJSON()),
        success: true,
      },
    };
  } catch (error) {
    log.error(`Failed to analyze broken content fragment paths: ${error.message}`);
    return {
      siteId: site.getId(),
      fullAuditRef: site.getBaseURL(),
      auditResult: {
        brokenPaths: auditResult.brokenPaths,
        error: error.message,
        success: false,
      },
    };
  }
}

export function provideContentFragmentLinkSuggestions(context) {
  const { log, audit, site } = context;

  const auditResult = audit.getAuditResult();
  if (!auditResult.success) {
    throw new Error('Audit failed, skipping content fragment path suggestions generation');
  }

  const { brokenPaths = [], suggestions = [] } = auditResult;

  log.info(`Providing ${suggestions.length} content fragment path suggestions`);

  return {
    siteId: site.getId(),
    fullAuditRef: site.getBaseURL(),
    auditResult: {
      brokenPaths,
      suggestions,
      success: true,
    },
  };
}

export default new AuditBuilder()
  .addStep('fetch-broken-content-fragment-links', fetchBrokenContentFragmentLinks, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('analyze-broken-content-fragment-links', analyzeBrokenContentFragmentLinks, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('provide-content-fragment-link-suggestions', provideContentFragmentLinkSuggestions)
  .build();
