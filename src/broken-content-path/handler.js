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
import { SplunkClient } from './clients/splunk-client.js';
import { AnalysisStrategy } from './services/analysis-strategy.js';
import { PathIndex } from './domain/index/path-index.js';
import { AemAuthorClient } from './clients/aem-author-client.js';

export async function brokenContentPathRunner(auditUrl, context) {
  const { log, site } = context;
  log.info(`Starting audit for site ${site.getId()} with URL ${auditUrl}`);

  try {
    // Fetch broken content paths from Splunk
    const splunkClient = SplunkClient.createFrom(context);
    const brokenPaths = await splunkClient.fetchBrokenPaths();

    log.info(`Found ${brokenPaths.length} broken URLs from Splunk`);

    const aemAuthorClient = AemAuthorClient.createFrom(context);
    const pathIndex = new PathIndex(context, aemAuthorClient);
    const strategy = new AnalysisStrategy(context, pathIndex, aemAuthorClient);
    const suggestions = await strategy.analyzePaths(brokenPaths);

    log.info(`Evaluated ${suggestions.length} paths with suggestions`);

    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        brokenContentPaths: suggestions, // Contains broken path and suggestion
        success: true,
      },
    };
  } catch (error) {
    log.error(`Broken content path audit for site ID ${site.getId()} with URL ${auditUrl} failed with error: ${error.message}`, error);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: `Broken content path audit for site ID ${site.getId()} with URL ${auditUrl} failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

export default new AuditBuilder()
  .withRunner(brokenContentPathRunner)
  .build();
