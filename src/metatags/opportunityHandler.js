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
import { syncSuggestions } from '../utils/data-access.js';

function removeTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
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
 * Updates Meta-tags Opportunity and Suggestions collection with new audit results
 * @param siteId site id
 * @param auditId audit id
 * @param auditData object containing audit results and some metadata
 * @param dataAccess object containing accessor objects
 * @param log logger
 * @returns {Promise<void>}
 */
export default async function syncOpportunityAndSuggestions(
  siteId,
  auditId,
  auditData,
  dataAccess,
  log,
) {
  log.info(`Syncing opportunity and suggestions for ${siteId}`);
  let metatagsOppty;
  try {
    // Get all opportunities by site-id and new status
    const opportunities = await dataAccess.Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    // Find existing opportunity for meta-tags, if it doesn't create a new one
    metatagsOppty = opportunities.find((oppty) => oppty.getType() === 'meta-tags');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  try {
    if (!metatagsOppty) {
      const opportunityData = {
        siteId,
        auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7B27CF48AA-5492-435D-B17C-01E38332A5CA%7D&file=Experience_Success_Studio_Metatags_Runbook.docx&action=default&mobileredirect=true',
        type: 'meta-tags',
        origin: 'AUTOMATION',
        title: 'Metadata issues found, including invalid meta tags. This could impact your SEO.',
        description: 'Review and optimize your title, description, and H1 tags to improve search engine rankings and enhance user engagement.',
        guidance: {
          steps: [
            'Review the detected meta-tags with issues, the AI-generated suggestions, and the provided rationale behind each recommendation.',
            'Customize the AI-suggested tag content if necessary by manually editing it.',
            'Copy the finalized tag content for the affected page.',
            'Update the tag in your page authoring source by pasting the content in the appropriate location.',
            'Publish the changes to apply the updates to your live site.',
          ],
        },
        tags: ['traffic-acquisition'],
      };
      metatagsOppty = await dataAccess.Opportunity.create(opportunityData);
      log.debug('Meta-tags Opportunity created');
    } else {
      metatagsOppty.setAuditId(auditId);
      await metatagsOppty.save();
    }
  } catch (e) {
    log.error(`Creating meta-tags opportunity for siteId ${siteId} failed with error: ${e.message}`, e);
    throw new Error(`Failed to create meta-tags opportunity for siteId ${siteId}: ${e.message}`);
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

  const buildKey = (suggestion) => {
    const data = suggestion.data || suggestion;
    return `${data.url}|${data.issue}|${data.tagContent}`;
  };
  // Sync the suggestions from new audit with old ones.
  // Keeps existing ones who are overlapping with new ones, deletes outdated ones, creates new ones.
  await syncSuggestions({
    opportunity: metatagsOppty,
    newData: suggestions,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: metatagsOppty.getId(),
      type: `${suggestion.tagName.toUpperCase()}_TAG_UPDATE`,
      rank: suggestion.rank,
      data: {
        ...suggestion,
      },
    }),
    log,
  });
  log.info(`Successfully synced Opportunity And Suggestions for site: ${siteId} and ${auditData.type} audit type.`);
}
