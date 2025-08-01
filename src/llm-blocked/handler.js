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
import robotsParser from 'robots-parser';
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

export async function getRobotsTxt(context) {
  try {
    const { finalUrl } = context;
    const robotsTxt = await fetch(`${finalUrl}/robots.txt`);
    const robotsTxtContent = await robotsTxt.text();

    const robots = robotsParser(`${finalUrl}/robots.txt`, robotsTxtContent);

    return robots;
  } catch (error) {
    context.log.error(`Error getting robots.txt: ${error}`);
    return null;
  }
}

export async function checkLLMBlocked(context) {
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

  const agentsWithRationale = {
    'ClaudeBot/1.0': 'Unblock ClaudeBot/1.0 to allow Anthropic’s Claude to access your site when assisting users.',
    'Perplexity-User/1.0': 'Unblock Perplexity-User/1.0 to let Perplexity AI directly browse and reference your website in users\' queries.',
    'PerplexityBot/1.0': 'Unblock PerplexityBot/1.0 to enable Perplexity AI to index your content.',
    'ChatGPT-User/1.0': 'Unblock ChatGPT-User/1.0 to allow ChatGPT to visit your website while answering a user’s question in browsing-enabled mode.',
    'GPTBot/1.0': 'Unblock GPTBot/1.0 to permit OpenAI’s GPT models to access and learn from your content for improved future responses.',
    'OAI-SearchBot/1.0': 'Unblock OAI-SearchBot/1.0 to let OpenAI’s search infrastructure retrieve your website content for ChatGPT search results.',
  };

  const agents = [...Object.keys(agentsWithRationale)];

  const robots = await getRobotsTxt(context);
  if (!robots) {
    log.warn('No robots.txt found. Aborting robots.txt check.');
    return {
      auditResult: JSON.stringify([]),
      fullAuditRef: `llm-blocked::${finalUrl}`,
    };
  }

  const suggestionsArray = [];

  agents.forEach((agent) => {
    const agentResult = {
      agent,
      rationale: agentsWithRationale[agent],
      affectedUrls: [],
    };

    topPages.forEach((page) => {
      if (!robots.isAllowed(page.getUrl(), agent)) {
        agentResult.affectedUrls.push(page.getUrl());
      }
    });

    if (agentResult.affectedUrls.length > 0) {
      suggestionsArray.push(agentResult);
    }
  });

  if (suggestionsArray.length <= 0) {
    return {
      auditResult: JSON.stringify([]),
      fullAuditRef: `llm-blocked::${finalUrl}`,
    };
  }

  // Create the opportunity
  const opportunity = await convertToOpportunity(
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

  // Create the suggestions
  await syncSuggestions({
    opportunity,
    newData: suggestionsArray,
    buildKey: (data) => data.agent,
    context,
    log,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: 10,
      data: {
        ...entry,
      },
    }),
  });

  return {
    auditResult: JSON.stringify(suggestionsArray),
    fullAuditRef: `llm-blocked::${finalUrl}`,
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('check-llm-blocked', checkLLMBlocked)
  .build();
