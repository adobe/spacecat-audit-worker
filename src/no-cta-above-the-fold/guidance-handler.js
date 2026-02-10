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
import { createPaidLogger } from '../paid/paid-log.js';

const GUIDANCE_TYPE = 'no-cta-above-the-fold';

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
  const paidLog = createPaidLogger(log, GUIDANCE_TYPE);

  paidLog.received(siteId, url, auditId);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    paidLog.failed('no audit found', siteId, url, auditId);
    return notFound();
  }

  const guidanceParsed = getGuidanceObj(guidance);

  if (isSuggestionFailure(guidanceParsed)) {
    paidLog.skipping('suggestion generation failure', siteId, url, auditId);
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
    paidLog.skipping('opportunity already exists', siteId, url, auditId);
    return ok();
  }

  const entity = mapToOpportunity(siteId, url, audit, guidanceParsed);
  paidLog.creatingOpportunity(siteId, url, auditId);

  const opportunity = await Opportunity.create(entity);

  const suggestionData = await mapToSuggestion(
    context,
    opportunity.getId(),
    url,
    guidanceParsed,
  );

  await Suggestion.create(suggestionData);
  paidLog.createdSuggestion(opportunity.getId(), siteId, url, auditId);

  return ok();
}
