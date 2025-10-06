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
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

// DJB2 hash
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    h = ((h << 5) + h) ^ str.charCodeAt(i); // h * 33 ^ c
  }
  // eslint-disable-next-line no-bitwise
  return (`00000000${(h >>> 0).toString(16)}`).slice(-8);
}

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
    const { finalUrl, log } = context;
    log.info(`Fetching https://${finalUrl}/robots.txt`);
    const robotsTxt = await fetch(`https://${finalUrl}/robots.txt`);
    const robotsTxtContent = await robotsTxt.text();

    const robots = robotsParser(`https://${finalUrl}`, robotsTxtContent);

    return { robots, plainRobotsTxt: robotsTxtContent };
  } catch (error) {
    context.log.error(`Error getting robots.txt: ${error}`);
    return { robots: null, plainRobotsTxt: null };
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

  const agents = [
    'ClaudeBot/1.0',
    'Perplexity-User/1.0',
    'PerplexityBot/1.0',
    'ChatGPT-User/1.0',
    'GPTBot/1.0',
    'OAI-SearchBot/1.0',
  ];

  const { robots, plainRobotsTxt } = await getRobotsTxt(context);
  if (!robots) {
    log.warn('No robots.txt found. Aborting robots.txt check.');
    return {
      auditResult: JSON.stringify([]),
      fullAuditRef: `llm-blocked::${finalUrl}`,
    };
  }

  // line number -> affected URL / user agent
  const resultsMap = {};

  const robotsTxtHash = hash(plainRobotsTxt);

  agents.forEach((agent) => {
    topPages.forEach((page) => {
      const isAllowedGenerally = robots.isAllowed(page.getUrl());
      const isAllowedForRobot = robots.isAllowed(page.getUrl(), agent);
      if (isAllowedGenerally && !isAllowedForRobot) {
        const line = robots.getMatchingLineNumber(page.getUrl(), agent);
        const url = page.getUrl();

        if (resultsMap[line]) {
          resultsMap[line].items.push({ url, agent });
        } else {
          resultsMap[line] = { lineNumber: line, robotsTxtHash, items: [{ url, agent }] };
        }
      }
    });
  });

  if (Object.keys(resultsMap).length <= 0) {
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
    { fullRobots: plainRobotsTxt, numProcessedUrls: topPages.length },
  );

  // Create the suggestions
  await syncSuggestions({
    opportunity,
    newData: Object.values(resultsMap),
    buildKey: (data) => `${data.lineNumber}-${data.robotsTxtHash}`,
    context,
    log,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: 10,
      data: {
        lineNumber: entry.lineNumber,
        items: entry.items,
        affectedUserAgents: [...new Set(entry.items.map((item) => item.agent))],
        robotsTxtHash,
      },
    }),
  });

  return {
    auditResult: JSON.stringify(resultsMap),
    fullAuditRef: `llm-blocked::${finalUrl}`,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('check-llm-blocked', checkLLMBlocked)
  .build();
