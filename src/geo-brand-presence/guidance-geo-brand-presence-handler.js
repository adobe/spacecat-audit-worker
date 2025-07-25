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

import { notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { convertToOpportunityEntity } from './opportunity-data-mapper.js';
import { GEO_FAQ_OPPTY_TYPE, OPPTY_TYPES } from './handler.js';

function getSuggestionValue(suggestions, subType, log) {
  if (subType === GEO_FAQ_OPPTY_TYPE) {
    let suggestionValue = '| URL | Question | Answer | Rationale | Sources |\n|-----|----------|-------|--------|---------|\n';
    suggestions.forEach((suggestion) => {
      const sources = suggestion.sources ? suggestion.sources.map((source, sourceIndex) => `[${sourceIndex + 1}] ${source}`).join('<br>') : '';
      if (!sources) {
        log.warn(`No sources found for suggestion: ${suggestion.question}. Skipping this suggestion.`);
      } else {
        suggestionValue += `| ${suggestion.pageUrl} | ${suggestion.question} | ${suggestion.answer} | ${suggestion.rationale} | ${sources} |\n`;
      }
    });
    return suggestionValue;
  } else {
    let suggestionValue = '| Url | Questions | Screenshot |\n |-----|-----------|------------|\n';
    suggestions.forEach((suggestion) => {
      suggestionValue += `| ${suggestion.url} | ${suggestion.q.join('\n')} | [![${suggestion.name}](${suggestion.previewImage})](${suggestion.screenshotUrl})|\n`;
    });
    return suggestionValue;
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const {
    auditId, siteId, type: subType, data,
  } = message;
  if (!subType || !OPPTY_TYPES.includes(subType)) {
    log.error(`Unsupported subtype: ${subType}`);
    return notFound();
  }
  const { suggestions } = data;
  log.info('Message received in guidance handler:', message);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }

  const entity = convertToOpportunityEntity(siteId, auditId, subType);
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  let opportunity = existingOpportunities.find(
    (oppty) => oppty.getData()?.subType === subType,
  );

  if (!opportunity) {
    log.info(`No existing Opportunity found for ${subType}. Creating a new one.`);
    opportunity = await Opportunity.create(entity);
  } else {
    log.info(`Existing Opportunity found for ${subType}. Updating it with new data.`);
    opportunity.setAuditId(auditId);
    opportunity.setData({
      ...opportunity.getData(),
      ...entity.data,
    });
    opportunity.setUpdatedBy('system');
    opportunity = await opportunity.save();
  }

  const existingSuggestions = await opportunity.getSuggestions();

  // delete previous suggestions if any
  await Promise.all(existingSuggestions.map((suggestion) => suggestion.remove()));
  const suggestionValue = getSuggestionValue(suggestions, subType, log);

  // map the suggestions received from Mystique to ASO
  const suggestionData = {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: 'NEW',
    data: {
      suggestionValue,
    },
    kpiDeltas: {
      estimatedKPILift: 0,
    },
  };

  await Suggestion.create(suggestionData);

  return ok();
}
