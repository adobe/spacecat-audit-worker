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

import { getPrompt } from '@adobe/spacecat-shared-utils';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { internalServerError } from '@adobe/spacecat-shared-http-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import {
  getRUMDomainkey, getRUMUrl, getScrapedDataForSiteId, sleep,
} from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';
import { syncSuggestions } from '../utils/data-access.js';

const INTERVAL = 30; // days
const AUDIT_TYPE = 'broken-internal-links';

/**
 * Classifies links into priority categories based on views
 * High: top 25%, Medium: next 25%, Low: bottom 50%
 * @param {Array} links - Array of objects with views property
 * @returns {Array} - Links with priority classifications included
 */
function calculatePriority(links) {
  // Sort links by views in descending order
  const sortedLinks = [...links].sort((a, b) => b.views - a.views);

  // Calculate indices for the 25% and 50% marks
  const quarterIndex = Math.ceil(sortedLinks.length * 0.25);
  const halfIndex = Math.ceil(sortedLinks.length * 0.5);

  // Map through sorted links and assign priority
  return sortedLinks.map((link, index) => {
    let priority;

    if (index < quarterIndex) {
      priority = 'high';
    } else if (index < halfIndex) {
      priority = 'medium';
    } else {
      priority = 'low';
    }

    return {
      ...link,
      priority,
    };
  });
}

/**
 * Perform an audit to check which internal links for domain are broken.
 *
 * @async
 * @param {string} baseURL - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function internalLinksAuditRunner(auditUrl, context, site) {
  const { log } = context;
  const finalUrl = await getRUMUrl(auditUrl);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context, auditUrl, log);

  const options = {
    domain: finalUrl,
    domainkey,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  log.info('broken-internal-links: Options for RUM call: ', JSON.stringify(options));

  const internal404Links = await rumAPIClient.query('404-internal-links', options);
  const priorityLinks = calculatePriority(internal404Links);
  const auditResult = {
    brokenInternalLinks: priorityLinks,
    fullAuditRef: auditUrl,
    finalUrl,
    auditContext: {
      interval: INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

// eslint-disable-next-line consistent-return
export async function convertToOpportunity(auditUrl, auditData, context) {
  const {
    dataAccess,
    log,
  } = context;
  const { Opportunity } = dataAccess;

  let opportunity;
  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    return internalServerError(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  try {
    if (!opportunity) {
      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_Internal_Links_Runbook.docx?web=1',
        type: AUDIT_TYPE,
        origin: 'AUTOMATION',
        title: 'Broken internal links are impairing user experience and SEO crawlability',
        description: 'We\'ve detected broken internal links on your website. Broken links can negatively impact user experience and SEO. Please review and fix these links to ensure smooth navigation and accessibility.',
        guidance: {
          steps: [
            'Update each broken internal link to valid URLs.',
            'Test the implemented changes manually to ensure they are working as expected.',
            'Monitor internal links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
          ],
        },
        tags: [
          'Traffic acquisition',
          'Engagement',
        ],
      };
      opportunity = await Opportunity.create(opportunityData);
    } else {
      opportunity.setAuditId(auditData.id);
      await opportunity.save();
    }
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
    throw e;
  }

  const buildKey = (item) => `${item.url_from}-${item.url_to}`;

  // Sync suggestions
  await syncSuggestions({
    opportunity,
    newData: auditData?.auditResult?.brokenInternalLinks,
    buildKey,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: entry.traffic_domain,
      data: {
        ...entry,
        /* code commented until implementation of suggested links. TODO: implement suggestions, https://jira.corp.adobe.com/browse/SITES-26545 */
        // suggestedLink: 'some suggestion here',
      },
    }),
    log,
  });

  // TODO: Update opportunity title based on number of broken internal links

  // log.info(`Suggestions count: ${opportunity.getSuggestions().length}`);
  // const suggestionCount = opportunity.getSuggestions().length;
  // opportunity.setTitle(`${suggestionCount} broken internal
  // ${suggestionCount === 1 ? 'link is' : 'links are'}
  // impairing user experience and SEO crawlability`);
  // await opportunity.save();
  // log.info(`Suggestions title: ${opportunity.getTitle()}`);
}

export const generateSuggestionData = async (finalUrl, auditData, context, site) => {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;

  if (auditData.auditResult.success === false) {
    log.info('Audit failed, skipping suggestions generation');
    return { ...auditData };
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-internal-links-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    return { ...auditData };
  }

  log.info(`Generating suggestions for site ${finalUrl}`);

  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = { responseFormat: 'json_object' };
  const BATCH_SIZE = 300;

  const data = await getScrapedDataForSiteId(site, context);
  const { siteData, headerLinks } = data;
  const totalBatches = Math.ceil(siteData.length / BATCH_SIZE);
  const dataBatches = Array.from(
    { length: totalBatches },
    (_, i) => siteData.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );

  log.info(`Processing ${siteData.length} alternative URLs in ${totalBatches} batches of ${BATCH_SIZE}...`);

  const processBatch = async (batch, urlTo) => {
    try {
      const requestBody = await getPrompt({ alternative_urls: batch, broken_url: urlTo }, 'broken-backlinks', log);
      await sleep(1000);
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`No suggestions found for ${urlTo}`);
        return null;
      }

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      log.error(`Batch processing error: ${error.message}`);
      return null;
    }
  };

  const processBacklink = async (backlink, headerSuggestions) => {
    log.info(`Processing backlink: ${backlink.url_to}`);
    const suggestions = [];
    for (const batch of dataBatches) {
      // eslint-disable-next-line no-await-in-loop
      const result = await processBatch(batch, backlink.url_to);
      if (result) {
        suggestions.push(result);
      }
    }

    if (totalBatches > 1) {
      log.info(`Compiling final suggestions for: ${backlink.url_to}`);
      try {
        const finalRequestBody = await getPrompt({ suggested_urls: suggestions, header_links: headerSuggestions, broken_url: backlink.url_to }, 'broken-backlinks-followup', log);
        await sleep(1000);
        const finalResponse = await firefallClient
          .fetchChatCompletion(finalRequestBody, firefallOptions);

        if (finalResponse.choices?.length >= 1 && finalResponse.choices[0].finish_reason !== 'stop') {
          log.error(`No final suggestions found for ${backlink.url_to}`);
          return { ...backlink };
        }

        const answer = JSON.parse(finalResponse.choices[0].message.content);
        log.info(`Final suggestion for ${backlink.url_to}: ${JSON.stringify(answer)}`);
        return {
          ...backlink,
          urls_suggested: answer.suggested_urls?.length > 0 ? answer.suggested_urls : [finalUrl],
          ai_rationale: answer.ai_rationale?.length > 0 ? answer.ai_rationale : 'No suitable suggestions found',
        };
      } catch (error) {
        log.error(`Final suggestion error for ${backlink.url_to}: ${error.message}`);
        return { ...backlink };
      }
    }

    log.info(`Suggestions for ${backlink.url_to}: ${JSON.stringify(suggestions[0]?.suggested_urls)}`);
    return {
      ...backlink,
      urls_suggested:
        suggestions[0]?.suggested_urls?.length > 0 ? suggestions[0]?.suggested_urls : [finalUrl],
      ai_rationale:
        suggestions[0]?.ai_rationale?.length > 0 ? suggestions[0]?.ai_rationale : 'No suitable suggestions found',
    };
  };

  const headerSuggestionsResults = [];
  for (const backlink of auditData.auditResult.brokenInternalLinks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const requestBody = await getPrompt({ alternative_urls: headerLinks, broken_url: backlink.url_to }, 'broken-backlinks', log);
      // eslint-disable-next-line no-await-in-loop
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`No header suggestions for ${backlink.url_to}`);
        headerSuggestionsResults.push(null);
        // eslint-disable-next-line no-continue
        continue;
      }

      headerSuggestionsResults.push(JSON.parse(response.choices[0].message.content));
    } catch (error) {
      log.error(`Header suggestion error: ${error.message}`);
      headerSuggestionsResults.push(null);
    }
  }

  const updatedInternalLinks = [];
  for (let index = 0; index < auditData.auditResult.brokenInternalLinks.length; index += 1) {
    const backlink = auditData.auditResult.brokenInternalLinks[index];
    const headerSuggestions = headerSuggestionsResults[index];
    // eslint-disable-next-line no-await-in-loop
    const updatedBacklink = await processBacklink(backlink, headerSuggestions);
    updatedInternalLinks.push(updatedBacklink);
  }

  log.info('Suggestions generation complete.');
  return {
    ...auditData,
    auditResult: {
      brokenInternalLinks: updatedInternalLinks,
    },
  };
};

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(internalLinksAuditRunner)
  .withPostProcessors([generateSuggestionData, convertToOpportunity])
  .build();
