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

import { AuditBuilder } from '../common/audit-builder.js';
import { AthenaCollector } from './collectors/athena-collector.js';
import { AnalysisStrategy } from './analysis/analysis-strategy.js';
import { PathIndex } from './domain/index/path-index.js';
import { AemClient } from './clients/aem-client.js';
import { wwwUrlResolver } from '../common/index.js';

async function fetchBrokenContentFragmentLinks(context) {
  const { log } = context;

  const collector = await AthenaCollector.createFrom(context);
  const brokenPaths = await collector.fetchBrokenPaths();

  log.info(`Found ${brokenPaths.length} broken content fragment paths from ${collector.constructor.name}`);

  return brokenPaths;
}

async function analyzeBrokenContentFragmentLinks(context, brokenPaths) {
  const { log } = context;

  const pathIndex = new PathIndex(context);
  const aemClient = AemClient.createFrom(context, pathIndex);
  const strategy = new AnalysisStrategy(context, aemClient, pathIndex);

  // Extract URLs for analysis while keeping the full brokenPaths data
  const urls = brokenPaths.map((item) => item.url || item);
  const suggestions = await strategy.analyze(urls);

  log.info(`Found ${suggestions.length} suggestions for broken content fragment paths`);

  return suggestions.map((suggestion) => suggestion.toJSON());
}

/**
 * The main audit runner that orchestrates the content fragment broken links audit.
 *
 * @param {string} baseURL - The base URL of the site being audited
 * @param {Object} context - The context object containing configurations, services, etc.
 * @param {Object} site - The site object being audited
 * @returns {Promise<Object>} The audit result containing broken paths and suggestions
 */
export async function contentFragmentBrokenLinksAuditRunner(baseURL, context, site) {
  const { log } = context;
  const auditContext = { ...context, site };

  try {
    const brokenPaths = await fetchBrokenContentFragmentLinks(auditContext);
    const suggestions = await analyzeBrokenContentFragmentLinks(auditContext, brokenPaths);

    return {
      fullAuditRef: baseURL,
      auditResult: {
        brokenPaths,
        suggestions,
        success: true,
      },
    };
  } catch (error) {
    log.error(`Audit failed with error: ${error.message}`);

    return {
      fullAuditRef: baseURL,
      auditResult: {
        error: error.message,
        success: false,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(contentFragmentBrokenLinksAuditRunner)
  .build();
