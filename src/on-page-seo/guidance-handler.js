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

import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';

/**
 * Checks if any suggestions were manually modified
 * @param {Array} suggestions - Array of suggestion entities
 * @returns {boolean} True if any suggestion was manually modified
 */
function hasManuallyModifiedSuggestions(suggestions) {
  return suggestions.some((suggestion) => {
    const updatedBy = suggestion.getUpdatedBy();
    return updatedBy && updatedBy !== 'system';
  });
}

/**
 * Guidance handler - receives content recommendations from Mystique
 * @param {object} message - SQS message from Mystique
 * @param {object} context - Audit context
 * @returns {Promise<object>} HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity, Suggestion } = dataAccess;
  const { opportunityId, data } = message;
  const { contentRecommendations = [] } = data;

  log.info(`[on-page-seo guidance] Processing ${contentRecommendations.length} content recommendations`);

  // Retrieve opportunity
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    log.error(`[on-page-seo guidance] Opportunity not found: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Check for manual modifications
  const existingSuggestions = await opportunity.getSuggestions();
  if (existingSuggestions.length > 0 && hasManuallyModifiedSuggestions(existingSuggestions)) {
    log.info('[on-page-seo guidance] Suggestions were manually modified. Skipping updates.');
    return ok();
  }

  // Update opportunity guidance (same format as experimentation-opportunities)
  if (data.guidance) {
    opportunity.setGuidance({
      recommendations: data.guidance, // Array of { insight, rationale, recommendation, type }
    });
    opportunity.setUpdatedBy('system');
    await opportunity.save();
  }

  // Delete previous content suggestions (keep technical issue suggestions)
  const contentSuggestions = existingSuggestions.filter(
    (s) => !s.getData()?.requiresTechnicalFix,
  );
  await Promise.all(contentSuggestions.map((s) => s.remove()));

  // Create new content suggestions (one suggestion per URL with variations array)
  const requiresValidation = Boolean(context.site?.requiresValidation);

  for (const recommendation of contentRecommendations) {
    // Calculate estimatedKPILift from variations' projectedImpact
    const variations = recommendation.variations || [];
    const maxProjectedImpact = variations.length > 0
      ? Math.max(...variations.map((v) => v.projectedImpact || 0))
      : 0;

    // eslint-disable-next-line no-await-in-loop
    await Suggestion.create({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: recommendation.quickWinScore || 0,
      status: requiresValidation ? SuggestionModel.STATUSES.PENDING_VALIDATION
        : SuggestionModel.STATUSES.NEW,
      data: {
        variations: recommendation.variations || [], // Array of variation objects from Mystique
        // Each variation has: name, id, changes, variationEditPageUrl,
        // variationPageUrl, explanation, projectedImpact, previewImage (S3 URL)
      },
      kpiDeltas: {
        estimatedKPILift: maxProjectedImpact, // Highest projected impact from variations
      },
    });
  }

  log.info(`[on-page-seo guidance] Created ${contentRecommendations.length} content suggestions`);

  return ok();
}
