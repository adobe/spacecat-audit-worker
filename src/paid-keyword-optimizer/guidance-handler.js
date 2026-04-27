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
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import {
  mapToKeywordOptimizerOpportunity,
  mapClusterToSuggestion,
  assignClusterRanks,
} from './guidance-opportunity-mapper.js';
import { createPaidLogger } from '../paid/paid-log.js';

const GUIDANCE_TYPE = 'ad-intent-mismatch';

/**
 * Handler for ad intent mismatch guidance responses from mystique.
 *
 * New cluster-based message format:
 * {
 *   auditId, siteId,
 *   data: {
 *     url,
 *     guidance: [{
 *       body: {
 *         clusterResults: [...],
 *         portfolioMetrics: {...},
 *         observability: {...},
 *         langfuseTraceId, langfuseTraceUrl,
 *         hasConflictingHeadlineRecommendations
 *       }
 *     }]
 *   }
 * }
 * @param {Object} message - Message from mystique
 * @param {Object} context - Execution context
 * @returns {Promise<Response>} HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;

  // Handle failure envelope from Mystique — URL-level analysis failed
  if (data?.status === 'failed') {
    log.info({
      trace_id: data?.error?.langfuseTraceId,
      audit_id: auditId,
      site_id: siteId,
      url: data?.url,
      error_type: data?.error?.type,
    }, '[ad-intent-mismatch] URL-level failure from Mystique');
    return ok();
  }

  const { guidance } = data;
  const guidanceBody = guidance?.[0]?.body;
  const url = data?.url;
  const paidLog = createPaidLogger(log, GUIDANCE_TYPE);

  paidLog.received(siteId, url, auditId);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    paidLog.failed('no audit found', siteId, url, auditId);
    return notFound();
  }

  const auditResult = audit.getAuditResult();
  if (!auditResult) {
    paidLog.failed('audit has no result data', siteId, url, auditId);
    return ok();
  }

  // Gate: skip when body is null or clusterResults absent
  if (!guidanceBody || !guidanceBody.clusterResults) {
    paidLog.skipping('no clusterResults in guidance body', siteId, url, auditId);
    return ok();
  }

  const { clusterResults, observability } = guidanceBody;

  // Log structured observability fields from Mystique
  if (observability) {
    log.info({
      ...observability,
      site_id: siteId,
      url,
      audit_id: auditId,
    }, '[ad-intent-mismatch] Mystique observability data');
  }

  // Replace-on-re-audit: find existing NEW/IN_PROGRESS opportunities on same
  // (siteId, url, type="ad-intent-mismatch") and mark as IGNORED
  const [newOpportunities, inProgressOpportunities] = await Promise.all([
    Opportunity.allBySiteIdAndStatus(siteId, 'NEW'),
    Opportunity.allBySiteIdAndStatus(siteId, 'IN_PROGRESS'),
  ]);

  const existingToIgnore = [...newOpportunities, ...inProgressOpportunities]
    .filter((oppty) => oppty.getType() === GUIDANCE_TYPE)
    .filter((oppty) => oppty.getData()?.url === url);

  if (existingToIgnore.length > 0) {
    existingToIgnore.forEach((oppty) => {
      oppty.setStatus('IGNORED');
    });
    await Opportunity.saveMany(existingToIgnore);
    existingToIgnore.forEach((oppty) => {
      paidLog.markedIgnored(oppty.getId(), siteId, url, auditId);
    });
  }

  // Create the opportunity (1 per URL)
  const entity = mapToKeywordOptimizerOpportunity(siteId, audit, message);
  const opportunity = await Opportunity.create(entity);
  paidLog.createdOpportunity(siteId, url, opportunity.getId());

  // Assign composite ranks to clusters
  const rankedClusters = assignClusterRanks(clusterResults);

  // Create 1 suggestion per cluster
  const suggestions = rankedClusters.map((cluster) => mapClusterToSuggestion(
    context,
    opportunity.getId(),
    cluster,
  ));

  // Bulk-create suggestions
  await Promise.all(suggestions.map((s) => Suggestion.create(s)));
  suggestions.forEach(() => {
    paidLog.createdSuggestion(opportunity.getId(), siteId, url, auditId);
  });

  log.info(
    `[ad-intent-mismatch] Created opportunity ${opportunity.getId()} with `
    + `${suggestions.length} cluster suggestions for site ${siteId}, url ${url}`,
  );

  return ok();
}
