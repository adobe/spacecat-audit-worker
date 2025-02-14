/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { TITLE, DESCRIPTION, H1 } from './constants.js';

export function removeTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Synchronizes existing suggestions with new data
 * by removing outdated suggestions and adding new ones.
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.opportunity - The opportunity object to synchronize suggestions for.
 * @param {Array} params.newData - Array of new data objects to sync.
 * @param {Function} params.buildKey - Function to generate a unique key for each item.
 * @param {Function} params.mapNewSuggestion - Function to map new data to suggestion objects.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncMetatagsSuggestions({
  opportunity,
  newData,
  buildKey,
  mapNewSuggestion,
  log,
}) {
  const existingSuggestions = await opportunity.getSuggestions();
  const existingSuggestionsMap = new Map(
    existingSuggestions.map((existing) => [buildKey(existing.getData()), existing]),
  );

  // Create new suggestions and sync them with existing suggestions
  const newSuggestions = newData
    .map(mapNewSuggestion)
    .filter((newSuggestion) => {
      // Skip suggestions that already exist with the same key
      const existing = existingSuggestionsMap.get(buildKey(newSuggestion.data));
      if (existing) {
        existingSuggestionsMap.delete(buildKey(newSuggestion.data));
        return false;
      }
      return true;
    });

  // Remove only the suggestions that don't have corresponding new data
  const suggestionsToRemove = Array.from(existingSuggestionsMap.values());
  await Promise.all(suggestionsToRemove.map((suggestion) => suggestion.remove()));

  // TODO: Skip deleting the suggestions created by BO UI
  //  once the createdBy field is introduced in suggestions schema

  // Add only the new suggestions that don't exist yet
  if (newSuggestions.length > 0) {
    const suggestions = await opportunity.addSuggestions(newSuggestions);

    if (suggestions.errorItems?.length > 0) {
      log.error(`Suggestions for siteId ${opportunity.getSiteId()} contains ${suggestions.errorItems.length} items with errors`);
      suggestions.errorItems.forEach((errorItem) => {
        log.error(`Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
      });

      if (suggestions.createdItems?.length <= 0) {
        throw new Error(`Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
      }
    }
  }
}

const issueRankings = {
  title: {
    missing: 1,
    empty: 2,
    duplicate: 5,
    long: 8,
    short: 8,
  },
  description: {
    missing: 3,
    empty: 3,
    duplicate: 6,
    long: 9,
    short: 9,
  },
  h1: {
    missing: 4,
    empty: 4,
    duplicate: 7,
    long: 10,
    multiple: 11,
  },
};

/**
 * Returns the tag issues rank as per below ranking based on seo impact.
 * The rank can help in sorting by impact.
 * Rankling (low number means high rank):
 * 1. Missing Title
 * 2. Empty Title
 * 3. Missing Description
 * 4. Missing H1
 * 5. Duplicate Title
 * 6. Duplicate Description
 * 7. Duplicate H1
 * 8. Title Too Long/Short
 * 9. Description Too Long/Short
 * 10. H1 Too Long
 * 11. Multiple H1 on a Page
 * @param issue
 * @param tagName
 */
function getIssueRanking(tagName, issue) {
  const tagIssues = issueRankings[tagName];
  const issueWords = issue.toLowerCase().split(' ');
  for (const word of issueWords) {
    if (tagIssues[word]) {
      return tagIssues[word];
    }
  }
  return -1;
}

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
export default async function convertToOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  log.info(`Syncing opportunity and suggestions for ${auditData.siteId}`);
  let metatagsOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');

    metatagsOppty = opportunities.find((oppty) => oppty.getType() === 'meta-tags');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  try {
    if (!metatagsOppty) {
      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7B27CF48AA-5492-435D-B17C-01E38332A5CA%7D&file=Experience_Success_Studio_Metatags_Runbook.docx&action=default&mobileredirect=true',
        type: 'meta-tags',
        origin: 'AUTOMATION',
        title: 'Pages have metadata issues, including missing and invalid tags.',
        description: 'Fixing metadata issues like missing or invalid tags boosts SEO by improving content visibility, search rankings, and user engagement.',
        guidance: {
          steps: [
            'Review the detected meta-tags with issues, the AI-generated suggestions, and the provided rationale behind each recommendation.',
            'Customize the AI-suggested tag content if necessary by manually editing it.',
            'Copy the finalized tag content for the affected page.',
            'Update the tag in your page authoring source by pasting the content in the appropriate location.',
            'Publish the changes to apply the updates to your live site.',
          ],
        },
        tags: ['Traffic acquisition'],
      };
      metatagsOppty = await Opportunity.create(opportunityData);
      log.debug('Meta-tags Opportunity created');
    } else {
      metatagsOppty.setAuditId(auditData.siteId);
      await metatagsOppty.save();
    }
  } catch (e) {
    log.error(`Creating meta-tags opportunity for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
    throw new Error(`Failed to create meta-tags opportunity for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { detectedTags } = auditData.auditResult;
  const suggestions = [];
  // Generate suggestions data to be inserted in meta-tags opportunity suggestions
  Object.keys(detectedTags).forEach((endpoint) => {
    [TITLE, DESCRIPTION, H1].forEach((tag) => {
      if (detectedTags[endpoint]?.[tag]?.issue) {
        suggestions.push({
          ...detectedTags[endpoint][tag],
          tagName: tag,
          url: removeTrailingSlash(auditData.auditResult.finalUrl) + endpoint,
          rank: getIssueRanking(tag, detectedTags[endpoint][tag].issue),
        });
      }
    });
  });

  const buildKey = (data) => `${data.url}|${data.issue}|${data.tagContent}`;

  // Sync the suggestions from new audit with old ones
  await syncMetatagsSuggestions({
    opportunity: metatagsOppty,
    newData: suggestions,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: metatagsOppty.getId(),
      type: 'METADATA_UPDATE',
      rank: suggestion.rank,
      data: { ...suggestion },
    }),
    log,
  });
  log.info(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and meta-tags audit type.`);
}
