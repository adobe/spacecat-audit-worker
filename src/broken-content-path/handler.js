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
import { CollectorFactory } from './collectors/collector-factory.js';
import { AnalysisStrategy } from './analysis/analysis-strategy.js';
import { PathIndex } from './domain/index/path-index.js';
import { AemAuthorClient } from './clients/aem-author-client.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export async function fetchBrokenContentPaths(context) {
  const { log } = context;

  const collector = CollectorFactory.create(context);
  const brokenPaths = await collector.fetchBrokenPaths();

  log.info(`Found ${brokenPaths.length} broken content paths from ${collector.constructor.name}`);
  return { brokenPaths };
}

export async function analyzeBrokenContentPaths(context) {
  const { audit, log } = context;

  const result = audit.getAuditResult();
  if (!result.success) {
    throw new Error('Audit failed, skipping analysis');
  }

  const pathIndex = new PathIndex(context);
  const aemAuthorClient = AemAuthorClient.createFrom(context, pathIndex);
  const strategy = new AnalysisStrategy(context, aemAuthorClient, pathIndex);
  const suggestions = await strategy.analyze(result.brokenPaths);

  log.info(`Found ${suggestions.length} suggestions for broken content paths`);
  return { suggestions };
}

export function provideSuggestions(context) {
  const { audit, finalUrl, tenant } = context;

  const result = audit.getAuditResult();
  if (!result.success) {
    throw new Error('Audit failed, skipping suggestions generation');
  }

  return {
    fullAuditRef: finalUrl,
    auditResult: {
      finalUrl,
      tenant,
      brokenContentPaths: result.suggestions,
      success: true,
    },
  };
}

export default new AuditBuilder()
  .addStep('fetch-broken-content-paths', fetchBrokenContentPaths, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('analyze-broken-content-paths', analyzeBrokenContentPaths, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('provide-suggestions', provideSuggestions)
  .build();
