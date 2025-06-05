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
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`Importing top pages for ${finalUrl}`);

  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'Importing Pages', finalUrl },
    fullAuditRef: `llm-blocked::${finalUrl}`,
    finalUrl,
  };
}

export async function checkLLMBlocked(context, _convertToOpportunity, _syncSuggestions) {
  const {
    site,
    dataAccess,
    log,
    finalUrl,
    audit,
  } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  if (topPages.length === 0) {
    throw new Error('No top pages found for site');
  }

  log.info(`Checking top URLs for blocked AI bots, finalUrl: ${finalUrl}`);

  const agents = [
    'ClaudeBot/1.0',
    'Perplexity-User/1.0',
    'PerplexityBot/1.0',
    'ChatGPT-User/1.0',
    'GPTBot/1.0',
  ];

  // check the top 20 pages
  const failedUrlsPromises = topPages.slice(0, 20).map(async (page) => {
    // fetch the page with each user agent once
    const userAgentResults = await Promise.all(agents.map(
      async (agent) => ({
        status: (await fetch(page.getUrl(), { headers: { 'User-Agent': agent } })).status,
        agent,
      }),
    ));

    // fetch the page with no user agent (baseline)
    const baselineResult = await fetch(page.getUrl());

    // check for differences between baseline and each user agent
    const blockedResults = userAgentResults
      .filter((result) => result.status !== baselineResult.status);

    if (blockedResults.length > 0) {
      return { url: page.getUrl(), blockedAgents: blockedResults };
    }
    return null;
  });

  const failedUrls = (await Promise.all(failedUrlsPromises)).filter((x) => !!x);

  if (failedUrls.length <= 0) {
    return {
      auditResult: JSON.stringify([]),
      fullAuditRef: `llm-blocked::${finalUrl}`,
    };
  }

  const opportunity = await _convertToOpportunity(
    finalUrl,
    {
      siteId: site.getId(),
      auditId: audit.getId(),
      id: audit.getId(),
    },
    context,
    createOpportunityData,
    'llm-blocked',
  );

  await _syncSuggestions({
    opportunity,
    newData: failedUrls,
    buildKey: (data) => data.url,
    context,
    log,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: 10,
      data: {
        recommendations: [],
        suggestionValue: `
The following user agents have been blocked for the URL ${entry.url}: ${entry.blockedAgents.map((a) => a.agent).join('; ')}
        `,
      },
    }),
  });

  return {
    auditResult: JSON.stringify(failedUrls),
    fullAuditRef: `llm-blocked::${finalUrl}`,
  };
}

const checkLLMBlockedStep = (context) => checkLLMBlocked(
  context,
  convertToOpportunity,
  syncSuggestions,
);

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('check-llm-blocked', checkLLMBlockedStep)
  .build();
