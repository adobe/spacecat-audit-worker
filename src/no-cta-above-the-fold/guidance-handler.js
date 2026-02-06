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
  mapToOpportunity,
  mapToSuggestion,
} from './guidance-opportunity-mapper.js';

function isSuggestionFailure(guidanceEntry) {
  const failureMessage = 'Suggestion generation failed, no opportunity created';
  const recommendation = guidanceEntry?.recommendation;

  return typeof recommendation === 'string'
    && recommendation.includes(failureMessage);
}

function getGuidanceObj(guidance) {
  const body = guidance && guidance[0] && guidance[0].body;

  return {
    ...guidance[0],
    body,
  };
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance } = data;

  log.info(
    `[paid-audit] Received no-cta-above-the-fold message for site: ${siteId}, url: ${url}, audit: ${auditId}`,
  );

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[paid-audit] Failed no-cta-above-the-fold: no audit found for site: ${siteId}, url: ${url}, audit: ${auditId}`);
    return notFound();
  }

  const guidanceParsed = getGuidanceObj(guidance);

  if (isSuggestionFailure(guidanceParsed)) {
    log.info(
      `[paid-audit] Skipping no-cta-above-the-fold opportunity creation for site: ${siteId}, url: ${url}, audit: ${auditId} due to suggestion generation failure`,
    );
    return ok();
  }

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const matchingOpportunity = existingOpportunities
    .filter((oppty) => oppty.getType() === 'generic-opportunity')
    .find((oppty) => {
      const opportunityData = oppty.getData();
      const status = oppty.getStatus();

      return opportunityData?.opportunityType === 'no-cta-above-the-fold'
        && opportunityData?.page === url
        && status !== 'RESOLVED'
        && status !== 'IGNORED';
    });

  if (matchingOpportunity) {
    log.info(
      `[paid-audit] Skipping no-cta-above-the-fold: opportunity already exists for site: ${siteId}, url: ${url}, audit: ${auditId}`,
    );
    return ok();
  }

  const entity = mapToOpportunity(siteId, url, audit, guidanceParsed);
  log.info(
    `[paid-audit] Creating no-cta-above-the-fold opportunity for site: ${siteId}, url: ${url}, audit: ${auditId}`,
  );

  const opportunity = await Opportunity.create(entity);

  const suggestionData = await mapToSuggestion(
    context,
    opportunity.getId(),
    url,
    guidanceParsed,
  );

  await Suggestion.create(suggestionData);
  log.info(`[paid-audit] Created no-cta-above-the-fold suggestion for opportunity: ${opportunity.getId()}, site: ${siteId}, url: ${url}, audit: ${auditId}`);

  return ok();
}
