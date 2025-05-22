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

// import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
// import { dataNeededForA11yAuditv2 } from './utils/constants.js';
import { aggregateAccessibilityData, createReportOpportunity, createReportOpportunitySuggestion } from './utils/utils.js';
import {
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
  generateBaseReportMarkdown,
  getWeekNumber,
} from './utils/generateMdReports.js';
import {
  createInDepthReportOpportunity,
  createEnhancedReportOpportunity,
  createFixedVsNewReportOpportunity,
  createBaseReportOpportunity,
} from './oppty-handlers/reportOppty.js';
// import { getObjectKeysUsingPrefix, getObjectFromKey } from '../utils/s3-utils.js';

// const { AUDIT_STEP_DESTINATIONS } = Audit;
// const AUDIT_TYPE_ACCESSIBILITY = 'accessibility'; // Defined audit type

// First step: sends a message to the content scraper to generate accessibility audits
// async function scrapeAccessibilityData(context) {
//   const {
//     site, log, finalUrl, env, s3Client,
//   } = context;
//   const siteId = site.getId();
//   const bucketName = env.S3_SCRAPER_BUCKET_NAME;
// eslint-disable-next-line max-len
//   log.info(`[A11yAudit] Step 1: Preparing content scrape for accessibility audit for ${site.getBaseURL()}`);

// eslint-disable-next-line max-len
//   const finalResultFiles = await getObjectKeysUsingPrefix(s3Client, bucketName, `accessibility/${siteId}/`, log, 10, '-final-result.json');
//   if (finalResultFiles.length === 0) {
//     log.error(`[A11yAudit] No final result files found for ${site.getBaseURL()}`);
//     return {
//       status: 'NO_OPPORTUNITIES',
//       message: 'No final result files found for accessibility audit',
//     };
//   }
//   const latestFinalResultFileKey = finalResultFiles[finalResultFiles.length - 1];
// eslint-disable-next-line max-len
//   const latestFinalResultFile = await getObjectFromKey(s3Client, bucketName, latestFinalResultFileKey, log);
//   if (!latestFinalResultFile) {
//     log.error(`[A11yAudit] No latest final result file found for ${site.getBaseURL()}`);
//     return {
//       status: 'NO_OPPORTUNITIES',
//       message: 'No data found in the latest final result file for accessibility audit',
//     };
//   }

//   delete latestFinalResultFile.overall;
//   // const urlsToScrape = dataNeededForA11yAuditv2.urls;
//   const urlsToScrape = [];
//   for (const [key, value] of Object.entries(latestFinalResultFile)) {
//     if (key.includes('https://')) {
//       urlsToScrape.push({
//         url: key,
//         urlId: key.replace('https://', ''),
//         traffic: value.traffic,
//       });
//     }
//   }

//   // The first step MUST return auditResult and fullAuditRef.
//   // fullAuditRef could point to where the raw scraped data will be stored (e.g., S3 path).
//   return {
// eslint-disable-next-line max-len
//     auditResult: { status: 'SCRAPING_REQUESTED', message: 'Content scraping for accessibility audit initiated.' },
//     fullAuditRef: finalUrl,
//     // Data for the CONTENT_SCRAPER
//     urls: urlsToScrape,
//     siteId: site.getId(),
//     jobId: site.getId(),
//     processingType: AUDIT_TYPE_ACCESSIBILITY,
//     // Potentially add other scraper-specific options if needed
//     concurrency: 25,
//   };
// }

// Second step: gets data from the first step and processes it to create new opportunities
async function processAccessibilityOpportunities(context) {
  const {
    site, log, s3Client, env,
  } = context;
  const siteId = site.getId();
  log.info(`[A11yAudit] Step 2: Processing scraped data for ${site.getBaseURL()}`);

  // Get the S3 bucket name from config or environment
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(errorMsg);
    return {
      status: 'PROCESSING_FAILED',
      error: errorMsg,
    };
  }

  try {
    // Use the accessibility aggregator to process data
    const version = new Date().toISOString().split('T')[0];
    const outputKey = `accessibility/${siteId}/${version}-final-result.json`;
    const aggregationResult = await aggregateAccessibilityData(
      s3Client,
      bucketName,
      siteId,
      log,
      outputKey,
      version,
    );

    if (!aggregationResult.success) {
      log.warn(`[A11yAudit] No data aggregated: ${aggregationResult.message}`);
      return {
        status: 'NO_OPPORTUNITIES',
        message: aggregationResult.message,
      };
    }

    const { finalResultFiles } = aggregationResult;
    const { current, lastWeek } = finalResultFiles;

    // data needed for all reports oppties
    const week = getWeekNumber(new Date());
    const year = new Date().getFullYear();
    // eslint-disable-next-line max-len
    const latestAudit = await site.getLatestAuditByAuditType('accessibility');
    const auditData = JSON.parse(JSON.stringify(latestAudit));
    const isProd = env.AWS_ENV === 'prod';
    const envAsoDomain = isProd ? 'experience' : 'experience-stage';
    const orgId = site.getOrganizationId();
    const relatedReportsUrls = {
      inDepthReportUrl: '',
      enhancedReportUrl: '',
      fixedVsNewReportUrl: '',
    };

    // 1.1 generate the markdown report for in-depth overview
    const inDepthOverviewMarkdown = generateInDepthReportMarkdown(current);

    // 1.2 create the opportunity for the in-depth overview report
    const opportunityInstance = createInDepthReportOpportunity(week, year);
    const opportunityRes = await createReportOpportunity(opportunityInstance, auditData, context);
    if (!opportunityRes.status) {
      log.error('Failed to create report opportunity', opportunityRes.message);
      return {
        status: 'PROCESSING_FAILED',
        error: opportunityRes.message,
      };
    }
    const { opportunity: inDepthOverviewOpportunity } = opportunityRes;

    // 1.3 create the suggestions for the in-depth overview report oppty
    const suggestionRes = await createReportOpportunitySuggestion(
      inDepthOverviewOpportunity,
      inDepthOverviewMarkdown,
      auditData,
      log,
    );

    if (!suggestionRes.status) {
      log.error('Failed to create report opportunity suggestion', suggestionRes.message);
      return {
        status: 'PROCESSING_FAILED',
        error: suggestionRes.message,
      };
    }

    // 1.4 update status to ignored
    await inDepthOverviewOpportunity.setStatus('IGNORED');
    await inDepthOverviewOpportunity.save();

    // 1.5 construct url for the report
    const inDepthOverviewOpportunityId = inDepthOverviewOpportunity.getId();
    relatedReportsUrls.inDepthReportUrl = `https://${envAsoDomain}.adobe.com/?organizationId=${orgId}#/@aem-sites-engineering/sites-optimizer/sites/${siteId}/opportunities/${inDepthOverviewOpportunityId}`;

    // 2.1 generate the markdown report for in-depth top 10
    const inDepthTop10Markdown = generateEnhancedReportMarkdown(current);

    // 2.2 create the opportunity for the in-depth top 10 report
    const enhancedOpportunityInstance = createEnhancedReportOpportunity(week, year);
    // eslint-disable-next-line max-len
    const enhancedOpportunityRes = await createReportOpportunity(enhancedOpportunityInstance, auditData, context);
    if (!enhancedOpportunityRes.status) {
      log.error('Failed to create enhancedreport opportunity', enhancedOpportunityRes.message);
      return {
        status: 'PROCESSING_FAILED',
        error: enhancedOpportunityRes.message,
      };
    }
    const { opportunity: inDepthTop10Opportunity } = enhancedOpportunityRes;

    // 2.3 create the suggestions for the in-depth top 10 report oppty
    const enhancedSuggestionRes = await createReportOpportunitySuggestion(
      inDepthTop10Opportunity,
      inDepthTop10Markdown,
      auditData,
      log,
    );

    if (!enhancedSuggestionRes.status) {
      log.error('Failed to create enhanced report opportunity suggestion', enhancedSuggestionRes.message);
      return {
        status: 'PROCESSING_FAILED',
        error: enhancedSuggestionRes.message,
      };
    }

    // 2.4 update status to ignored
    await inDepthTop10Opportunity.setStatus('IGNORED');
    await inDepthTop10Opportunity.save();
    // 2.5 construct url for the report
    relatedReportsUrls.enhancedReportUrl = `https://${envAsoDomain}.adobe.com/?organizationId=${orgId}#/@aem-sites-engineering/sites-optimizer/sites/${siteId}/opportunities/${inDepthTop10Opportunity.getId()}`;

    // 3.1 generate the markdown report for fixed vs new issues if any
    const fixedVsNewMarkdown = generateFixedNewReportMarkdown(current);
    if (fixedVsNewMarkdown.length > 0) {
    // 3.2 create the opportunity for the fixed vs new report
      const fixedVsNewOpportunityInstance = createFixedVsNewReportOpportunity(week, year);
      // eslint-disable-next-line max-len
      const fixedVsNewOpportunityRes = await createReportOpportunity(fixedVsNewOpportunityInstance, auditData, context);
      if (!fixedVsNewOpportunityRes.status) {
        log.error('Failed to create fixed vs new report opportunity', fixedVsNewOpportunityRes.message);
        return {
          status: 'PROCESSING_FAILED',
          error: fixedVsNewOpportunityRes.message,
        };
      }
      const { opportunity: fixedVsNewOpportunity } = fixedVsNewOpportunityRes;

      // 3.3 create the suggestions for the fixed vs new report oppty
      const fixedVsNewSuggestionRes = await createReportOpportunitySuggestion(
        fixedVsNewOpportunity,
        fixedVsNewMarkdown,
        auditData,
        log,
      );

      if (!fixedVsNewSuggestionRes.status) {
        log.error('Failed to create fixed vs new report opportunity suggestion', fixedVsNewSuggestionRes.message);
        return {
          status: 'PROCESSING_FAILED',
          error: fixedVsNewSuggestionRes.message,
        };
      }

      // 3.4 update status to ignored
      await fixedVsNewOpportunity.setStatus('IGNORED');
      await fixedVsNewOpportunity.save();

      // 3.5 construct url for the report
      relatedReportsUrls.fixedVsNewReportUrl = `https://${envAsoDomain}.adobe.com/?organizationId=${orgId}#/@aem-sites-engineering/sites-optimizer/sites/${siteId}/opportunities/${fixedVsNewOpportunity.getId()}`;
    }

    // 4.1 generate the markdown report for base report and
    //    add the urls from the above reports into the markdown report
    const baseReportMarkdown = generateBaseReportMarkdown(current, lastWeek, relatedReportsUrls);
    // 4.2 generate oppty and suggestions for the report
    const baseOpportunityInstance = createBaseReportOpportunity(week, year);
    // eslint-disable-next-line max-len
    const baseOpportunityRes = await createReportOpportunity(baseOpportunityInstance, auditData, context);
    if (!baseOpportunityRes.status) {
      log.error('Failed to create base report opportunity', baseOpportunityRes.message);
      return {
        status: 'PROCESSING_FAILED',
        error: baseOpportunityRes.message,
      };
    }
    const { opportunity: baseOpportunity } = baseOpportunityRes;

    // 4.3 create the suggestions for the base report oppty
    const baseSuggestionRes = await createReportOpportunitySuggestion(
      baseOpportunity,
      baseReportMarkdown,
      auditData,
      log,
    );

    if (!baseSuggestionRes.status) {
      log.error('Failed to create base report opportunity suggestion', baseSuggestionRes.message);
      return {
        status: 'PROCESSING_FAILED',
        error: baseSuggestionRes.message,
      };
    }

    // Extract some key metrics for the audit result
    const totalIssues = finalResultFiles.current.overall.violations.total;
    const urlsProcessed = Object.keys(finalResultFiles.current).length;
    const categoriesByCount = Object.entries(finalResultFiles.current.overall.violations)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));

    // Return the final result
    return {
      status: totalIssues > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      opportunitiesFound: totalIssues,
      urlsProcessed,
      topIssueCategories: categoriesByCount.slice(0, 5), // Top 5 issue categories
      summary: `Found ${totalIssues} accessibility issues across ${urlsProcessed} URLs`,
      fullReportUrl: outputKey, // Reference to the full report in S3
    };
  } catch (error) {
    log.error(`[A11yAudit] Error processing accessibility data: ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver) // Keeps the existing URL resolver
  // First step: Prepare and send data to CONTENT_SCRAPER
  // eslint-disable-next-line max-len
  // .addStep('scrapeAccessibilityData', scrapeAccessibilityData, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  // Second step: Process the scraped data to find opportunities
  .addStep('processAccessibilityOpportunities', processAccessibilityOpportunities)
  .build();
