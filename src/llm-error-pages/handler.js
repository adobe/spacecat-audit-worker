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

import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  getS3Config,
  generateReportingPeriods,
  createDateRange,
  buildSiteFilters,
  processErrorPagesResults,
  buildLlmErrorPagesQuery,
  getAllLlmProviders,
  consolidateErrorsByUrl,
  sortErrorsByTrafficVolume,
  categorizeErrorsByStatusCode,
} from './utils.js';
import { wwwUrlResolver } from '../common/index.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';

export async function createOpportunityForErrorCategory(
  errorCode,
  errorPages,
  context,
) {
  const {
    log, sqs, env, site, dataAccess,
  } = context;
  const { Opportunity } = dataAccess;

  if (!errorPages || errorPages.length === 0) {
    log.info(`No validated errors for ${errorCode} category - skipping opportunity creation`);
    return;
  }

  log.info(`Creating opportunity for ${errorCode} errors with ${errorPages.length} suggestions`);

  const siteId = site.getId();
  const baseUrl = site.getBaseURL?.() || 'unknown';

  log.info(`Creating opportunity with siteId: ${siteId}`);

  const opportunityInstance = createOpportunityData({ errorCode, errorPages });

  let opportunity;
  try {
    // Look for existing opportunity with same type and error code
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    opportunity = opportunities.find((oppty) => oppty.getType() === 'llm-error-pages'
      && oppty.getData()?.errorCode === errorCode);
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  try {
    if (!opportunity) {
      // Create new opportunity
      const opportunityData = {
        siteId,
        auditId: context.auditId,
        runbook: opportunityInstance.runbook,
        type: 'llm-error-pages',
        origin: opportunityInstance.origin,
        title: opportunityInstance.title,
        description: opportunityInstance.description,
        guidance: opportunityInstance.guidance,
        tags: opportunityInstance.tags,
        data: opportunityInstance.data,
      };
      opportunity = await Opportunity.create(opportunityData);
      log.info(`Created new opportunity ${opportunity.getId()} for ${errorCode} errors`);
    } else {
      // Update existing opportunity
      log.info(`Found existing opportunity ${opportunity.getId()} for ${errorCode} errors, updating...`);

      // Update opportunity data
      opportunity.setData({
        ...opportunity.getData(),
        totalErrors: opportunityInstance.data.totalErrors,
        uniqueUrls: opportunityInstance.data.uniqueUrls,
        uniqueUserAgents: opportunityInstance.data.uniqueUserAgents,
        dataSources: opportunityInstance.data.dataSources,
      });

      opportunity.setUpdatedBy('system');
      await opportunity.save();
      log.info(`Updated existing opportunity ${opportunity.getId()}`);
    }

    // Handle suggestions based on error code
    log.info(`Processing suggestions for ${errorCode} errors`);

    // Clean up existing suggestions for this error code
    const existingSuggestions = await opportunity.getSuggestions();
    const suggestionsToRemove = existingSuggestions.filter(
      (suggestion) => suggestion.getData()?.statusCode === errorCode,
    );

    if (suggestionsToRemove.length > 0) {
      log.info(`Removing ${suggestionsToRemove.length} outdated suggestions for ${errorCode} errors`);
      await Promise.all(suggestionsToRemove.map((suggestion) => suggestion.delete()));
    }

    const suggestionType = errorCode === '404' ? 'REDIRECT_UPDATE' : 'CODE_CHANGE';
    const template = 'Fix {errorCode} error for {url} - {userAgent} crawler affected';

    // Create suggestions
    const mapNewSuggestion = (errorPage, index) => ({
      opportunityId: opportunity.getId(),
      type: suggestionType,
      rank: index + 1,
      status: 'NEW',
      data: {
        url: errorPage.url,
        statusCode: errorPage.status,
        totalRequests: errorPage.totalRequests,
        userAgent: errorPage.userAgent,
        rawUserAgents: errorPage.rawUserAgents,
        suggestedUrls: [],
        aiRationale: null,
        confidenceScore: null,
        suggestion: template.replace('{url}', errorPage.url).replace('{userAgent}', errorPage.userAgent).replace('{errorCode}', errorCode),
      },
    });

    // Create suggestions
    await syncSuggestions({
      opportunity,
      newData: errorPages,
      buildKey: (errorPage) => `${errorPage.url}|${errorPage.status}|${errorPage.userAgent}`,
      context,
      mapNewSuggestion,
      log,
    });

    log.info(`Created ${errorPages.length} suggestions for ${errorCode} errors`);

    // Send SQS message to Mystique for 404 errors only
    if (errorCode === '404' && sqs && env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
      const message = {
        type: 'guidance:broken-links',
        siteId: site.getId(),
        auditId: opportunity.auditId || 'unknown',
        deliveryType: site?.getDeliveryType?.() || 'aem_edge',
        time: new Date().toISOString(),
        data: {
          brokenLinks: errorPages.map((errorPage) => ({
            urlFrom: errorPage.userAgent,
            urlTo: baseUrl ? `${baseUrl}${errorPage.url}` : errorPage.url,
            suggestionId: `llm-${errorPage.url}-${errorPage.userAgent}`,
          })),
          alternativeUrls: [],
          opportunityId: opportunity.getId(),
        },
      };

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      log.info(`Queued ${errorPages.length} validated 404 URLs to Mystique for AI processing in single message`);
    }
  } catch (e) {
    log.error(`Failed to create/update opportunity for siteId ${siteId} and errorCode ${errorCode}: ${e.message}`);
    throw e;
  }
}

async function runLlmErrorPagesAudit(url, context, site) {
  const { log, message = {} } = context;
  const s3Config = getS3Config(site);

  log.info(`Starting LLM error pages audit for ${url}`);

  try {
    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

    // Validate database and table exist
    /* c8 ignore next */
    // await validateDatabaseAndTable(athenaClient, s3Config, log);

    let startDate;
    let endDate;
    let periodIdentifier;

    // Handle date range - custom dates or default to previous week
    if (message.startDate && message.endDate) {
      const parsedRange = createDateRange(message.startDate, message.endDate);
      startDate = parsedRange.startDate;
      endDate = parsedRange.endDate;
      periodIdentifier = `${message.startDate}_to_${message.endDate}`;
      log.info(`Running custom date range audit: ${message.startDate} to ${message.endDate}`);
    } else {
      // Default to previous week
      const week = generateReportingPeriods().weeks[0];
      startDate = week.startDate;
      endDate = week.endDate;
      periodIdentifier = `w${week.weekNumber}-${week.year}`;
      log.info(`Running weekly audit for ${periodIdentifier}`);
    }

    // Get site configuration
    const cdnLogsConfig = site.getConfig()?.getCdnLogsConfig?.() || {};
    const { filters } = cdnLogsConfig;
    const siteFilters = buildSiteFilters(filters);

    // Build and execute query
    const query = await buildLlmErrorPagesQuery({
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      startDate,
      endDate,
      llmProviders: getAllLlmProviders(), // Query all LLM providers
      siteFilters,
    });

    log.info('Executing LLM error pages query...');
    const sqlQueryDescription = '[Athena Query] LLM error pages analysis';
    const results = await athenaClient.query(
      query,
      s3Config.databaseName,
      sqlQueryDescription,
    );

    // Process results
    const processedResults = processErrorPagesResults(results);

    const categorizedResults = categorizeErrorsByStatusCode(processedResults.errorPages);

    // Attach site to context for downstream opportunity generation
    const downstreamContext = { ...context, site };

    // Process categories in parallel since each has its own opportunity
    const processingPromises = Object.entries(categorizedResults)
      .filter(([, errors]) => errors.length > 0)
      .map(async ([errorCode, errors]) => {
        try {
          const consolidatedErrorPages = consolidateErrorsByUrl(errors);
          const sortedErrors = sortErrorsByTrafficVolume(consolidatedErrorPages);
          await createOpportunityForErrorCategory(errorCode, sortedErrors, downstreamContext);
        } catch (error) {
          log.error(`Failed to process ${errorCode} category: ${error.message}`, error);
        }
      });

    await Promise.all(processingPromises);

    log.info(`Found ${processedResults.totalErrors} total errors across ${processedResults.summary.uniqueUrls} unique URLs`);

    const auditResult = {
      success: true,
      timestamp: new Date().toISOString(),
      periodIdentifier,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      database: s3Config.databaseName,
      table: s3Config.tableName,
      customer: s3Config.customerName,
      totalErrors: processedResults.totalErrors,
      summary: processedResults.summary,
      errorPages: processedResults.errorPages,
    };

    return {
      auditResult,
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`LLM error pages audit failed: ${error.message}`);

    return {
      auditResult: {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        database: s3Config.databaseName,
        table: s3Config.tableName,
        customer: s3Config.customerName,
      },
      fullAuditRef: url,
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runLlmErrorPagesAudit)
  .build();
