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
import { resolveSecretsName, sqsEventAdapter } from '@adobe/spacecat-shared-utils';
import { internalServerError, notFound, ok } from '@adobe/spacecat-shared-http-utils';

import sqs from './support/sqs.js';
import s3Client from './support/s3-client.js';
import accessibility from './accessibility/handler.js';
import apex from './apex/handler.js';
import cwv from './cwv/handler.js';
import lhsDesktop from './lhs/handler-desktop.js';
import lhsMobile from './lhs/handler-mobile.js';
import notfound from './notfound/handler.js';
import sitemap from './sitemap/handler.js';
import paid from './paid/handler.js';
import canonical from './canonical/handler.js';
import backlinks from './backlinks/handler.js';
import internalLinks from './internal-links/handler.js';
import experimentation from './experimentation/handler.js';
import conversion from './conversion/handler.js';
import essExperimentationDaily from './experimentation-ess/daily.js';
import essExperimentationAll from './experimentation-ess/all.js';
import experimentationOpportunities from './experimentation-opportunities/handler.js';
import formsOpportunities from './forms-opportunities/handler.js';
import metaTags from './metatags/handler.js';
import costs from './costs/handler.js';
import structuredData from './structured-data/handler.js';
import siteDetection from './site-detection/handler.js';
import highFormViewsLowConversionsGuidance from './forms-opportunities/guidance-handlers/guidance-high-form-views-low-conversions.js';
import highPageViewsLowFormNavGuidance from './forms-opportunities/guidance-handlers/guidance-high-page-views-low-form-nav.js';
import highPageViewsLowFormViewsGuidance from './forms-opportunities/guidance-handlers/guidance-high-page-views-low-form-views.js';
import highOrganicLowCtrGuidance from './experimentation-opportunities/guidance-high-organic-low-ctr-handler.js';
import paidConsentGuidance from './paid/guidance-handler.js';
import imageAltText from './image-alt-text/handler.js';
import preflight from './preflight/handler.js';
import { suggestionsInternalLinksHandler } from './internal-links/suggestions-internal-links-handler.js';
import geoBrandPresence from './geo-brand-presence/handler.js';
import guidanceGeoBrandPresence from './geo-brand-presence/guidance-geo-brand-presence-handler.js';
import formAccessibilityGuidance from './forms-opportunities/guidance-handlers/guidance-accessibility.js';
import mystiqueDetectedFormAccessibilityOpportunity from './forms-opportunities/oppty-handlers/accessibility-handler.js';
import accessibilityRemediationGuidance from './accessibility/guidance-handlers/guidance-accessibility-remediation.js';
import cdnAnalysis from './cdn-analysis/handler.js';
import cdnLogsReport from './cdn-logs-report/handler.js';
import analyticsReport from './analytics-report/handler.js';
import detectPageIntent from './page-intent/handler.detect.js';
import llmoReferralTraffic from './llmo-referral-traffic/handler.js';

const HANDLERS = {
  accessibility,
  apex,
  cwv,
  'lhs-mobile': lhsMobile,
  'lhs-desktop': lhsDesktop,
  404: notfound,
  sitemap,
  paid,
  canonical,
  'broken-backlinks': backlinks,
  'broken-internal-links': internalLinks,
  experimentation,
  conversion,
  'experimentation-ess-daily': essExperimentationDaily,
  'experimentation-ess-all': essExperimentationAll,
  'experimentation-opportunities': experimentationOpportunities,
  'meta-tags': metaTags,
  costs,
  'structured-data': structuredData,
  'forms-opportunities': formsOpportunities,
  'site-detection': siteDetection,
  'guidance:high-organic-low-ctr': highOrganicLowCtrGuidance, // ref
  'suggestions:internal-links': suggestionsInternalLinksHandler,
  'alt-text': imageAltText,
  'guidance:high-form-views-low-conversions': highFormViewsLowConversionsGuidance,
  'guidance:high-page-views-low-form-nav': highPageViewsLowFormNavGuidance,
  'guidance:high-page-views-low-form-views': highPageViewsLowFormViewsGuidance,
  'geo-brand-presence': geoBrandPresence,
  'guidance:geo-brand-presence': guidanceGeoBrandPresence,
  'guidance:forms-a11y': formAccessibilityGuidance,
  'detect:forms-a11y': mystiqueDetectedFormAccessibilityOpportunity,
  'guidance:accessibility-remediation': accessibilityRemediationGuidance,
  'guidance:paid-cookie-consent': paidConsentGuidance,
  preflight,
  'cdn-analysis': cdnAnalysis,
  'cdn-logs-report': cdnLogsReport,
  'analytics-report': analyticsReport,
  'detect:page-intent': detectPageIntent,
  'llmo-referral-traffic': llmoReferralTraffic,
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
  const { type, siteId } = message;

  log.info(`Received ${type} audit request for: ${siteId}`);
  log.info(`Message ${JSON.stringify(message)}`);

  const handler = HANDLERS[type];
  if (!handler) {
    const msg = `no such audit type: ${type}`;
    log.error(msg);
    return notFound();
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
  .with(sqs)
  .with(s3Client)
  .with(secrets, { name: resolveSecretsName })
  .with(helixStatus);
