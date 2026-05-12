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

// ⚠️  DEMO ONLY — DO NOT USE IN PRODUCTION ⚠️
// This audit contains hardcoded stub data and is intended solely for
// prototyping and demonstration purposes. It must be replaced with a real
// implementation before being enabled on any production site.

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { AUDIT_TYPE } from './constants.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const dirName = dirname(fileURLToPath(import.meta.url));

/**
 * Scores and selects the top content-gap topics from the dataset.
 * Opportunity score = volume × (1 − citation_share) × (1 − owned_keywords_share).
 * High volume with low existing AI and organic presence signals an untapped gap.
 */
export function selectTopTopics(topics, count = 5) {
  const seen = new Set();
  return topics
    .filter(({ adobe_topic: t }) => {
      if (seen.has(t)) {
        return false;
      }
      seen.add(t);
      return true;
    })
    .map((t) => ({
      ...t,
      opportunityScore: t.volume * (1 - t.citation_share) * (1 - t.owned_keywords_share),
    }))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, count);
}

// Example: custom Spacecat API request
// import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
//
// const { SPACECAT_API_BASE_URL: apiBase, SPACECAT_API_KEY: apiKey } = context.env;
// const response = await fetch(`${apiBase}/your/custom/endpoint`, {
//   headers: { 'x-api-key': apiKey },
// });
// if (!response.ok) { throw new Error(`API request failed: ${response.status}`); }
// const data = await response.json();
//
// For paginated store endpoints (url-store, sentiment/config), use StoreClient instead:
// import StoreClient from '../utils/store-client.js';
// const client = StoreClient.createFrom(context);
// const urls = await client.getUrls(site.getId(), 'llm-content-gaps');

/**
 * Detects LLM content gaps for a single page.
 * Exported so the preflight audit can import and call this directly
 * with its own scrape data, without going through the full audit runner.
 *
 * @param {string} url - Page URL being checked
 * @param {object} scrapeData - Scraped page data from the scraper
 * @param {object} log - Logger instance
 * @returns {Array<object>} Array of detected content gap issues
 */
export function checkLlmContentGaps(url, _scrapeData, log) {
  log.info(`[${AUDIT_TYPE}] checking ${url}`);
  return [
    {
      success: false,
      check: 'content-gap',
      checkTitle: 'Content gap: AI-powered analytics',
      description: 'Page has insufficient coverage for topic "AI-powered analytics" (coverage score: 18%).',
      explanation: 'Expand the page to address key subtopics identified in the Semrush content brief.',
      topic: 'AI-powered analytics',
      coverageScore: 18,
      contentBrief: {
        recommendedWordCount: 1200,
        missingSubtopics: ['real-time dashboards', 'predictive insights', 'data connectors'],
        suggestedHeadings: [
          'What is AI-powered analytics?',
          'Key features of AI analytics platforms',
          'How to integrate AI analytics into your workflow',
        ],
        rewriteInstructions: 'Add sections covering real-time dashboards and predictive insights. Include concrete examples and a comparison table of data connectors.',
      },
    },
    {
      success: false,
      check: 'content-gap',
      checkTitle: 'Content gap: enterprise data governance',
      description: 'Page has insufficient coverage for topic "enterprise data governance" (coverage score: 31%).',
      explanation: 'Expand the page to address key subtopics identified in the Semrush content brief.',
      topic: 'enterprise data governance',
      coverageScore: 31,
      contentBrief: {
        recommendedWordCount: 900,
        missingSubtopics: ['compliance frameworks', 'data lineage', 'role-based access'],
        suggestedHeadings: [
          'Data governance in enterprise environments',
          'Compliance and regulatory requirements',
          'Implementing role-based access control',
        ],
        rewriteInstructions: 'Introduce a dedicated section on compliance frameworks (GDPR, CCPA). Add a data lineage diagram and explain role-based access control.',
      },
    },
    {
      success: true,
      check: 'content-gap',
      checkTitle: 'Sufficient coverage: cloud deployment',
      description: 'Page adequately covers topic "cloud deployment" (coverage score: 74%).',
      explanation: 'No action required.',
      topic: 'cloud deployment',
      coverageScore: 74,
    },
  ];
}

export function loadTopicsForSite(baseUrl) {
  const hostname = new URL(baseUrl).hostname.replace(/\./g, '-');
  const dataFile = join(dirName, `data/${hostname}-sample.json`);
  if (!existsSync(dataFile)) {
    throw new Error(`No topic data available for ${baseUrl} (expected ${hostname}-sample.json)`);
  }
  return JSON.parse(readFileSync(dataFile, 'utf-8'));
}

export async function auditRunner(auditUrl, context, site) {
  const { log } = context;
  log.info(`[${AUDIT_TYPE}] selecting top content-gap topics`);

  const allTopics = loadTopicsForSite(site.getBaseURL());
  const topTopics = selectTopTopics(allTopics);
  const findings = topTopics.map((t) => ({
    success: false,
    check: 'content-gap',
    checkTitle: `Content gap: ${t.adobe_topic}`,
    description: `Topic "${t.adobe_topic}" has low AI citation share (${t.citation_share}) and low owned keyword share (${t.owned_keywords_share}) with a search volume of ${t.volume}.`,
    explanation: 'Expand content coverage for this topic to capture untapped search and AI citation opportunities.',
    topic: t.adobe_topic,
    topicLabel: t.semrush_topic,
    volume: t.volume,
    citationShare: t.citation_share,
    ownedKeywordsShare: t.owned_keywords_share,
    opportunityScore: t.opportunityScore,
  }));

  return {
    auditResult: {
      siteId: site.getId(), url: auditUrl, status: 'completed', findings,
    },
    fullAuditRef: auditUrl,
  };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const gaps = (auditData.auditResult?.findings || []).filter((f) => !f.success);

  if (!gaps.length) {
    log.info(`[${AUDIT_TYPE}] no content gaps found, skipping opportunity creation`);
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
  );

  await syncSuggestions({
    opportunity,
    newData: gaps,
    context,
    buildKey: (gap) => `${gap.topic}|${auditUrl}`,
    mapNewSuggestion: (gap) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: Math.round(gap.opportunityScore),
      data: {
        url: auditUrl,
        topic: gap.topic,
        topicLabel: gap.topicLabel,
        volume: gap.volume,
        citationShare: gap.citationShare,
        ownedKeywordsShare: gap.ownedKeywordsShare,
        opportunityScore: gap.opportunityScore,
      },
    }),
    log,
  });

  log.info(`[${AUDIT_TYPE}] opportunity created and ${gaps.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .withPostProcessors([opportunityAndSuggestions])
  .build();
