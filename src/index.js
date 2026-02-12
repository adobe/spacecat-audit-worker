/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import wrap from '@adobe/helix-shared-wrap';
import { helixStatus } from '@adobe/helix-status';
import secrets from '@adobe/helix-shared-secrets';
import dataAccess from '@adobe/spacecat-shared-data-access';
import { resolveSecretsName, sqsEventAdapter, logWrapper } from '@adobe/spacecat-shared-utils';
import { internalServerError, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { checkSiteRequiresValidation } from './utils/site-validation.js';

import sqs from './support/sqs.js';
import s3Client from './support/s3-client.js';
import accessibility from './accessibility/handler.js';
import accessibilityDesktop from './accessibility/handler-desktop.js';
import accessibilityMobile from './accessibility/handler-mobile.js';
import apex from './apex/handler.js';
import cwv from './cwv/handler.js';
import lhsDesktop from './lhs/handler-desktop.js';
import lhsMobile from './lhs/handler-mobile.js';
import sitemap from './sitemap/handler.js';
import sitemapProductCoverage from './sitemap-product-coverage/handler.js';
import redirectChains from './redirect-chains/handler.js';
import paid from './paid-cookie-consent/handler.js';
import paidKeywordOptimizer from './paid-keyword-optimizer/handler.js';
import paidKeywordOptimizerGuidance from './paid-keyword-optimizer/guidance-handler.js';
import noCTAAboveTheFold from './no-cta-above-the-fold/handler.js';
import canonical from './canonical/handler.js';
import backlinks from './backlinks/handler.js';
import brokenLinksGuidance from './broken-links-guidance/guidance-handler.js';
import metatagsGuidance from './metatags-guidance/guidance-handler.js';
import internalLinks from './internal-links/handler.js';
import essExperimentationDaily from './experimentation-ess/daily.js';
import essExperimentationAll from './experimentation-ess/all.js';
import experimentationOpportunities from './experimentation-opportunities/handler.js';
import formsOpportunities from './forms-opportunities/handler.js';
import metaTags from './metatags/handler.js';
import costs from './costs/handler.js';
import structuredData from './structured-data/handler.js';
import structuredDataGuidance from './structured-data/guidance-handler.js';
import siteDetection from './site-detection/handler.js';
import highFormViewsLowConversionsGuidance from './forms-opportunities/guidance-handlers/guidance-high-form-views-low-conversions.js';
import highPageViewsLowFormNavGuidance from './forms-opportunities/guidance-handlers/guidance-high-page-views-low-form-nav.js';
import highPageViewsLowFormViewsGuidance from './forms-opportunities/guidance-handlers/guidance-high-page-views-low-form-views.js';
import highOrganicLowCtrGuidance from './experimentation-opportunities/guidance-high-organic-low-ctr-handler.js';
import paidConsentGuidance from './paid-cookie-consent/guidance-handler.js';
import noCTAAboveTheFoldGuidance from './no-cta-above-the-fold/guidance-handler.js';
import paidTrafficAnalysisGuidance from './paid-traffic-analysis/guidance-handler.js';
import imageAltText from './image-alt-text/handler.js';
import preflight from './preflight/handler.js';
import llmBlocked from './llm-blocked/handler.js';
import geoBrandPresence from './geo-brand-presence/handler.js';
import detectGeoBrandPresence from './geo-brand-presence/detect-geo-brand-presence-handler.js';
import { handleCategorizationResponseHandler } from './geo-brand-presence/categorization-response-handler.js';
import geoBrandPresenceDaily from './geo-brand-presence-daily/handler.js';
import detectGeoBrandPresenceDaily from './geo-brand-presence-daily/detect-geo-brand-presence-handler.js';
import formAccessibilityGuidance from './forms-opportunities/guidance-handlers/guidance-accessibility.js';
import detectFormDetails from './forms-opportunities/form-details-handler/detect-form-details.js';
import mystiqueDetectedFormAccessibilityOpportunity from './forms-opportunities/oppty-handlers/accessibility-handler.js';
import accessibilityRemediationGuidance from './accessibility/guidance-handlers/guidance-accessibility-remediation.js';
import triggerA11yCodefix from './accessibility/trigger-codefix-handler.js';
import accessibilityCodeFix from './common/codefix-response-handler.js';
import cdnLogsAnalysis from './cdn-analysis/handler.js';
import cdnLogsReport from './cdn-logs-report/handler.js';
import analyticsReport from './analytics-report/handler.js';
import pageIntent from './page-intent/handler.js';
import missingAltTextGuidance from './image-alt-text/guidance-missing-alt-text-handler.js';
import readabilityOpportunities from './readability/opportunities/handler.js';
import unifiedReadabilityGuidance from './readability/shared/unified-guidance-handler.js';
import llmoReferralTraffic from './llmo-referral-traffic/handler.js';
import llmErrorPages from './llm-error-pages/handler.js';
import llmErrorPagesGuidance from './llm-error-pages/guidance-handler.js';
import { paidTrafficAnalysisWeekly, paidTrafficAnalysisMonthly } from './paid-traffic-analysis/handler.js';
import pageTypeDetection from './page-type/handler.js';
import pageTypeGuidance from './page-type/guidance-handler.js';
import hreflang from './hreflang/handler.js';
import optimizationReportCallback from './optimization-report/handler.js';
import llmoCustomerAnalysis from './llmo-customer-analysis/handler.js';
import headings from './headings/handler.js';
import toc from './toc/handler.js';
import vulnerabilities from './vulnerabilities/handler.js';
import vulnerabilitiesCodeFix from './vulnerabilities-code-fix/handler.js';
import prerender from './prerender/handler.js';
import prerenderGuidance from './prerender/guidance-handler.js';
import productMetatags from './product-metatags/handler.js';
import commerceProductEnrichments from './commerce-product-enrichments/handler.js';
import { refreshGeoBrandPresenceSheetsHandler } from './geo-brand-presence/geo-brand-presence-refresh-handler.js';
import summarization from './summarization/handler.js';
import summarizationGuidance from './summarization/guidance-handler.js';
import accessibilityCodeFixHandler from './accessibility/auto-optimization-handlers/codefix-handler.js';
import permissions from './permissions/handler.js';
import permissionsRedundant from './permissions/handler.redundant.js';
import faqs from './faqs/handler.js';
import faqsGuidance from './faqs/guidance-handler.js';
import pageCitability from './page-citability/handler.js';
import healthCheck from './health-check/handler.js';
import wikipediaAnalysis from './wikipedia-analysis/handler.js';
import wikipediaAnalysisGuidance from './wikipedia-analysis/guidance-handler.js';
import frescopaDataGeneration from './frescopa-data-generation/handler.js';
import ptrSelector from './ptr-selector/handler.js';

const HANDLERS = {
  accessibility,
  'accessibility-desktop': accessibilityDesktop,
  'accessibility-mobile': accessibilityMobile,
  apex,
  cwv,
  'lhs-mobile': lhsMobile,
  'lhs-desktop': lhsDesktop,
  sitemap,
  'sitemap-product-coverage': sitemapProductCoverage,
  'redirect-chains': redirectChains,
  paid,
  'no-cta-above-the-fold': noCTAAboveTheFold,
  'paid-traffic-analysis-weekly': paidTrafficAnalysisWeekly,
  'paid-traffic-analysis-monthly': paidTrafficAnalysisMonthly,
  'page-type-detection': pageTypeDetection,
  canonical,
  'broken-backlinks': backlinks,
  'broken-internal-links': internalLinks,
  'experimentation-ess-daily': essExperimentationDaily,
  'experimentation-ess-all': essExperimentationAll,
  'experimentation-opportunities': experimentationOpportunities,
  'meta-tags': metaTags,
  costs,
  'structured-data': structuredData,
  'llm-blocked': llmBlocked,
  'forms-opportunities': formsOpportunities,
  'site-detection': siteDetection,
  'guidance:high-organic-low-ctr': highOrganicLowCtrGuidance,
  'guidance:broken-links': brokenLinksGuidance,
  'guidance:metatags': metatagsGuidance,
  'alt-text': imageAltText,
  'guidance:high-form-views-low-conversions':
    highFormViewsLowConversionsGuidance,
  'guidance:high-page-views-low-form-nav': highPageViewsLowFormNavGuidance,
  'guidance:high-page-views-low-form-views': highPageViewsLowFormViewsGuidance,
  'geo-brand-presence': geoBrandPresence,
  'geo-brand-presence-free': geoBrandPresence,
  'geo-brand-presence-paid': geoBrandPresence,
  // Splits of geo-brand-presence-free for staggered execution (max 40 sites each)
  ...Object.fromEntries(
    Array.from({ length: 18 }, (_, i) => [`geo-brand-presence-free-${i + 1}`, geoBrandPresence]),
  ),
  'category:geo-brand-presence': handleCategorizationResponseHandler,
  'detect:geo-brand-presence': detectGeoBrandPresence,
  'refresh:geo-brand-presence': detectGeoBrandPresence,
  'geo-brand-presence-daily': geoBrandPresenceDaily,
  'geo-brand-presence-trigger-refresh': refreshGeoBrandPresenceSheetsHandler,
  'detect:geo-brand-presence-daily': detectGeoBrandPresenceDaily,
  'refresh:geo-brand-presence-daily': detectGeoBrandPresenceDaily,
  'guidance:forms-a11y': formAccessibilityGuidance,
  'detect:forms-a11y': mystiqueDetectedFormAccessibilityOpportunity,
  'guidance:accessibility-remediation': accessibilityRemediationGuidance,
  'trigger:a11y-codefix': triggerA11yCodefix,
  'codefix:accessibility': accessibilityCodeFix,
  'guidance:paid-cookie-consent': paidConsentGuidance,
  'paid-keyword-optimizer': paidKeywordOptimizer,
  'ad-intent-mismatch': paidKeywordOptimizer,
  'guidance:paid-ad-intent-gap': paidKeywordOptimizerGuidance,
  'guidance:no-cta-above-the-fold': noCTAAboveTheFoldGuidance,
  'guidance:traffic-analysis': paidTrafficAnalysisGuidance,
  'detect:page-types': pageTypeGuidance,
  'guidance:missing-alt-text': missingAltTextGuidance,
  'guidance:readability': unifiedReadabilityGuidance, // unified for both preflight and opportunities
  readability: readabilityOpportunities, // for opportunities
  'guidance:structured-data-remediation': structuredDataGuidance,
  preflight,
  'cdn-logs-analysis': cdnLogsAnalysis,
  'cdn-logs-report': cdnLogsReport,
  'analytics-report': analyticsReport,
  'detect:form-details': detectFormDetails,
  'page-intent': pageIntent,
  'llmo-referral-traffic': llmoReferralTraffic,
  'llm-error-pages': llmErrorPages,
  'guidance:llm-error-pages': llmErrorPagesGuidance,
  'optimization-report-callback': optimizationReportCallback,
  'llmo-customer-analysis': llmoCustomerAnalysis,
  summarization,
  'guidance:summarization': summarizationGuidance,
  hreflang,
  headings,
  toc,
  prerender,
  'guidance:prerender': prerenderGuidance,
  'product-metatags': productMetatags,
  'commerce-product-enrichments': commerceProductEnrichments,
  'security-vulnerabilities': vulnerabilities,
  'codefix:security-vulnerabilities': vulnerabilitiesCodeFix,
  'codefix:form-accessibility': accessibilityCodeFixHandler,
  'security-permissions': permissions,
  'security-permissions-redundant': permissionsRedundant,
  faqs,
  'guidance:faqs': faqsGuidance,
  'page-citability': pageCitability,
  'health-check': healthCheck,
  'wikipedia-analysis': wikipediaAnalysis,
  'guidance:wikipedia-analysis': wikipediaAnalysisGuidance,
  'frescopa-data-generation': frescopaDataGeneration,
  'ptr-selector': ptrSelector,
  dummy: (message) => ok(message),
};

function getElapsedSeconds(startTime) {
  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  return elapsedSeconds.toFixed(2);
}

/**
 * This is the main function
 * @param {object} message the message object received from SQS
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(message, context) {
  const { log } = context;
  const {
    type, siteId, jobId,
  } = message;

  log.info(
    `Received ${type} audit request for siteId=${siteId}, jobId=${jobId || 'none'}`,
    message,
  );

  const handler = HANDLERS[type];
  if (!handler) {
    const msg = `no such audit type: ${type}`;
    log.error(msg);
    return notFound();
  }

  // If siteId, fetch the site and check if it requires validation
  if (siteId) {
    try {
      const { Site } = context.dataAccess;
      const site = await Site.findById(siteId);
      if (site) {
        // Set the requiresValidation flag on the site object
        const requiresValidation = await checkSiteRequiresValidation(site, context);
        site.requiresValidation = requiresValidation;
        context.site = site;
      }
    } catch (e) {
      log.warn(`Failed to fetch site ${siteId}: ${e.message}`);
    }
  }

  const startTime = process.hrtime();

  try {
    const result = await (typeof handler.run === 'function' ? handler.run(message, context) : handler(message, context));

    log.info(`${type} audit for ${siteId} completed in ${getElapsedSeconds(startTime)} seconds`);

    return result;
  } catch (e) {
    log.error(`${type} audit for ${siteId} failed after ${getElapsedSeconds(startTime)} seconds. `, e);
    return internalServerError();
  }
}

export const main = wrap(run)
  .with(dataAccess)
  .with(sqsEventAdapter)
  .with(logWrapper)
  .with(sqs)
  .with(s3Client)
  .with(secrets, { name: resolveSecretsName })
  .with(helixStatus);
