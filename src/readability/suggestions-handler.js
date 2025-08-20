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

import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendReadabilityToMystique, clearReadabilitySuggestions } from './suggestions-opportunity-handler.js';
import { DATA_SOURCES } from '../common/constants.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.READABILITY;
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

export async function processImportStep(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `readability-suggestions/${site.getId()}/`;

  return {
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    type: 'readability-suggestions',
    siteId: site.getId(),
  };
}

export async function processReadabilitySuggestionsWithMystique(context) {
  const {
    log, site, audit, dataAccess,
  } = context;

  log.info(`[${AUDIT_TYPE}]: Processing readability suggestions with Mystique for site ${site.getId()}`);

  try {
    const { Opportunity, AsyncJob } = dataAccess;
    const siteId = site.getId();
    const auditUrl = site.getBaseURL();

    // Find the most recent preflight job to get readability issues
    const allJobs = await AsyncJob.allBySiteId(siteId);
    const preflightJobs = allJobs.filter((job) => job.getType() === 'preflight');

    if (preflightJobs.length === 0) {
      throw new Error(`No preflight jobs found for site ${site.getId()}`);
    }

    // Get the most recent preflight job
    const latestPreflightJob = preflightJobs
      .sort((a, b) => new Date(b.getCreatedAt()) - new Date(a.getCreatedAt()))[0];

    log.info(`[${AUDIT_TYPE}]: Found latest preflight job ${latestPreflightJob.getId()} for site ${siteId}`);

    // Extract readability issues from preflight results
    const preflightResult = latestPreflightJob.getResult();
    if (!preflightResult || !preflightResult.auditsResult) {
      throw new Error(`No preflight results found in job ${latestPreflightJob.getId()}`);
    }

    // Collect all readability issues from all pages
    const readabilityIssues = [];
    for (const pageResult of preflightResult.auditsResult) {
      const readabilityAudit = pageResult.audits.find((a) => a.name === 'readability');
      if (readabilityAudit && readabilityAudit.opportunities) {
        for (const opportunity of readabilityAudit.opportunities) {
          if (opportunity.check === 'poor-readability' && opportunity.textContent) {
            readabilityIssues.push({
              pageUrl: opportunity.pageUrl,
              textContent: opportunity.textContent,
              fleschReadingEase: opportunity.fleschReadingEase,
              selector: opportunity.selector,
            });
          }
        }
      }
    }

    if (readabilityIssues.length === 0) {
      log.info(`[${AUDIT_TYPE}]: No readability issues found in preflight results for site ${siteId}`);
      return;
    }

    log.info(`[${AUDIT_TYPE}]: Found ${readabilityIssues.length} readability issues to process with Mystique`);

    // Find or create the readability suggestions opportunity
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    let readabilitySuggestionsOppty = opportunities.find(
      (oppty) => oppty.getType() === 'readability-suggestions',
    );

    if (readabilitySuggestionsOppty) {
      log.info(`[${AUDIT_TYPE}]: Clearing existing suggestions before sending to Mystique`);
      await clearReadabilitySuggestions({ opportunity: readabilitySuggestionsOppty, log });

      // Reset opportunity data to start fresh for new audit run
      const resetData = {
        totalReadabilityIssues: readabilityIssues.length,
        dataSources: readabilitySuggestionsOppty.getData()?.dataSources || [],
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: readabilityIssues.length,
        processedSuggestionIds: [],
        preflightJobId: latestPreflightJob.getId(),
      };
      readabilitySuggestionsOppty.setData(resetData);
      await readabilitySuggestionsOppty.save();
      log.info(`[${AUDIT_TYPE}]: Reset opportunity data for fresh audit run`);
    } else {
      log.info(`[${AUDIT_TYPE}]: Creating new readability suggestions opportunity for site ${siteId}`);
      const opportunityDTO = {
        siteId,
        auditId: audit.getId(),
        runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
        type: 'readability-suggestions',
        origin: 'AUTOMATION',
        title: 'AI-powered readability improvement suggestions',
        description: 'Automated suggestions to improve content readability using advanced AI text analysis and rewriting',
        guidance: {
          recommendations: [
            {
              insight: 'Poor readability reduces user engagement and search rankings',
              recommendation: 'Use AI-generated suggestions to rewrite complex text with simpler language and structure',
              type: null,
              rationale: 'Improved readability enhances user experience and accessibility while boosting SEO performance',
            },
          ],
        },
        data: {
          totalReadabilityIssues: readabilityIssues.length,
          dataSources: [DATA_SOURCES.SITE, DATA_SOURCES.PAGE],
          mystiqueResponsesReceived: 0,
          mystiqueResponsesExpected: readabilityIssues.length,
          processedSuggestionIds: [],
          preflightJobId: latestPreflightJob.getId(),
        },
        tags: ['readability', 'content', 'seo', 'accessibility'],
      };

      readabilitySuggestionsOppty = await Opportunity.create(opportunityDTO);
      log.info(`[${AUDIT_TYPE}]: Created new opportunity with ID ${readabilitySuggestionsOppty.getId()}`);
    }

    await sendReadabilityToMystique(
      auditUrl,
      readabilityIssues,
      site.getId(),
      audit.getId(),
      readabilitySuggestionsOppty,
      context,
    );

    log.info(`[${AUDIT_TYPE}]: Sent ${readabilityIssues.length} readability issues to Mystique for AI-powered suggestions`);
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to process readability suggestions with Mystique: ${error.message}`);
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('processReadabilitySuggestionsWithMystique', processReadabilitySuggestionsWithMystique)
  .build();
