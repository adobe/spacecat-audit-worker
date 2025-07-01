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

import { readFileSync } from 'fs';
import { notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { convertToOpportunityEntity } from './opportunity-data-mapper.js';

const POSSIBLE_SUBTYPES = ['guidance:geo-brand-presence', 'guidance:geo-faq'];

function getSuggestionValue(suggestions, subType, log) {
  if (subType === 'guidance:geo-faq') {
    let suggestionValue = '| URL | Question | Answer | Sources |\n|-----|----------|-------|--------|\n';
    suggestions.forEach((suggestion) => {
      const sources = suggestion.sources ? suggestion.sources.map((source, sourceIndex) => `[${sourceIndex + 1}] ${source}`).join('<br>') : '';
      suggestionValue += `| ${suggestion.page_url} | ${suggestion.question} | ${suggestion.answer} | ${sources} |\n`;
    });
    return suggestionValue;
  } else if (subType === 'guidance:geo-brand-presence') {
    let suggestionValue = '| Url | Questions | Screenshot |\n |-----|-----------|------------|\n';
    suggestions.forEach((suggestion) => {
      suggestionValue += `| ${suggestion.url} | ${suggestion.q.join('\n')} | [![${suggestion.name}](${suggestion.previewImage})](${suggestion.screenshotUrl})|\n`;
    });
    return suggestionValue;
  } else {
    log.warn(`Unsupported subType: ${subType}`);
    return notFound();
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { suggestions } = data;
  log.info(`Message received in guidance handler: ${JSON.stringify(message, null, 2)}`);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }

  const entity = convertToOpportunityEntity(siteId, auditId);

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  let opportunity = existingOpportunities.find(
    (oppty) => POSSIBLE_SUBTYPES.includes(oppty.getData()?.subType),
  );
  const subType = opportunity.getData()?.subType;

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

  // map the suggestions received from Mystique to ASO
  const suggestionData = {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: 'NEW',
    data: {
      suggestionValue: getSuggestionValue(suggestions, subType, log),
    },
    kpiDeltas: {
      estimatedKPILift: 0,
    },
  };

  await Suggestion.create(suggestionData);

  return ok();
}

const jsonData = JSON.parse(readFileSync('./src/geo-brand-presence/wilson.json', 'utf8'));
const { suggestions } = jsonData;
const result = getSuggestionValue(suggestions, 'guidance:geo-faq');
console.log('=== FAQ Format Result ===');
console.log(result);
