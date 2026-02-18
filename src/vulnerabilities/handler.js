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

import { Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import {
  DELIVERY_TYPES, hasText, isNonEmptyArray, tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { createHash } from 'node:crypto';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityProps } from './opportunity-data-mapper.js';
import { getImsOrgId, syncSuggestions } from '../utils/data-access.js';
import { mapVulnerabilityToSuggestion } from './suggestion-data-mapper.js';
import { noopUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 1; // days
const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_VULNERABILITIES;

/**
 * Fetches vulnerability report for a given AEM Cloud Service site from the starfish API.
 *
 * @param {string} baseURL - The base URL of the site
 * @param {object} context - The context object of the audit
 * @param {object} site - The site object containing delivery configuration and details.
 * @return {Promise<VulnerabilityReport>} A promise that resolves to the vulnerability report data.
 */
export async function fetchVulnerabilityReport(baseURL, context, site) {
  const { log, env, dataAccess } = context;

  // Retrieve site details
  const imsOrg = await getImsOrgId(site, dataAccess, log);
  if (!hasText(imsOrg)) {
    throw new Error('Missing IMS org');
  } else if (imsOrg === 'default') {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] site is configured with default IMS org`);
  }
  const { programId, environmentId } = site.getDeliveryConfig();
  if (!hasText(programId) || !hasText(environmentId)) {
    throw new Error('Invalid delivery config for AEM_CS');
  }

  // Get service access-token
  let token;
  try {
    const imsContext = {
      log,
      env: {
        IMS_HOST: env.IMS_HOST,
        IMS_CLIENT_ID: env.IMS_CLIENT_ID,
        IMS_CLIENT_CODE: env.IMS_CLIENT_CODE,
        IMS_CLIENT_SECRET: env.IMS_CLIENT_SECRET,
      },
    };
    const imsClient = ImsClient.createFrom(imsContext);
    token = await imsClient.getServiceAccessToken();
  } catch (e) {
    throw new Error(`Failed to retrieve IMS token: ${e.message}`);
  }

  // Fetch vulnerability report
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'x-api-key': env.IMS_CLIENT_ID,
    'x-gw-ims-org-id': imsOrg,
  };
  let resp;
  try {
    resp = await fetch(`${env.STARFISH_API_BASE_URL}/reports/${programId}/${environmentId}/vulnerabilities`, { headers });
  } catch (error) {
    throw new Error('Failed to fetch vulnerability report');
  }
  if (resp.status === 404) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] vulnerability report not found`);
    return null;
  }
  if (!resp.ok) {
    const json = await resp.json();
    throw new Error(`Failed to fetch vulnerability report (${resp.status}): ${json?.error}`);
  }
  const json = await resp.json();
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] successfully fetched vulnerability report`);
  return json.data;
}

/**
 * Perform an audit to check if the environment has vulnerable dependencies.
 *
 * @async
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function vulnerabilityAuditRunner(context) {
  const { finalUrl, site, log } = context;
  const baseURL = finalUrl;

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== DELIVERY_TYPES.AEM_CS) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping vulnerability audit as site is of delivery type ${site.getDeliveryType()}`);
    return {
      auditResult: {
        finalUrl: baseURL,
        error: `Unsupported delivery type ${site.getDeliveryType()}`,
        success: false,
      },
      fullAuditRef: baseURL,
    };
  }

  try {
    const vulnerabilityReport = await fetchVulnerabilityReport(baseURL, context, site);
    if (!vulnerabilityReport) {
      const errorMessage = `[${AUDIT_TYPE}] [Site: ${site.getId()}] fetch successful, but report was empty / null`;
      log.debug(errorMessage);
      return {
        auditResult: {
          finalUrl: baseURL,
          error: errorMessage,
          success: false,
        },
        fullAuditRef: baseURL,
      };
    }

    const compCount = vulnerabilityReport.summary.totalComponents;
    const vulnCount = vulnerabilityReport.summary.totalVulnerabilities;

    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] identified: ${vulnCount} vulnerabilities in ${compCount} components`);

    return {
      auditResult: {
        finalUrl: baseURL,
        vulnerabilityReport,
        fullAuditRef: baseURL,
        auditContext: { interval: INTERVAL },
        success: true,
      },
      fullAuditRef: baseURL,
    };
  } catch (error) {
    const errorMessage = `[${AUDIT_TYPE}] [Site: ${site.getId()}] audit failed with error: ${error.message}`;
    log.error(errorMessage);
    return {
      auditResult: {
        finalUrl: baseURL,
        error: errorMessage,
        success: false,
      },
      fullAuditRef: baseURL,
    };
  }
}

export async function extractCodeBucket(context) {
  const { site } = context;
  const result = await vulnerabilityAuditRunner(context);

  // we explicitly do not fail here if the import worker failed,
  // but instead delegate that to the next step

  return {
    type: 'code',
    allowCache: false,
    siteId: site.getId(),
    auditResult: result.auditResult,
    fullAuditRef: result.fullAuditRef,
  };
}

export const extractCodeInfo = (data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  // Navigate the nested structure
  const { importResults } = data;
  if (!Array.isArray(importResults) || importResults.length === 0) {
    return null;
  }

  const firstImportResult = importResults[0];
  if (!firstImportResult || typeof firstImportResult !== 'object') {
    return null;
  }

  const results = firstImportResult.result;
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const codeInfo = results[0];
  return (
    codeInfo
    && typeof codeInfo === 'object'
    && typeof codeInfo.codeBucket === 'string'
    && codeInfo.codeBucket.trim() !== ''
    && typeof codeInfo.codePath === 'string'
    && codeInfo.codePath.trim() !== ''
  ) ? codeInfo : null;
};

/**
 * Creates opportunities and syncs suggestions.
 *
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export const opportunityAndSuggestionsStep = async (context) => {
  const {
    site, data, audit, log, sqs, env, finalUrl, dataAccess,
  } = context;
  const { Configuration, Suggestion } = dataAccess;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    throw new Error('Audit failed, skipping suggestions generation');
  }

  const { vulnerabilityReport } = auditResult;

  if (!isNonEmptyArray(vulnerabilityReport.vulnerableComponents)) {
    // No vulnerabilities found
    // Fetch opportunity
    let opportunity;
    try {
      const opportunities = await site.getOpportunitiesByStatus(Oppty.STATUSES.NEW);
      opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${site.getId()} failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
    }

    if (opportunity) {
      // No vulnerabilities found, update opportunity status to RESOLVED
      log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no vulnerabilities found, but found opportunity, updating status to RESOLVED`);
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);

      // We also need to update all suggestions inside this opportunity
      // Get all suggestions for this opportunity
      const suggestions = await opportunity.getSuggestions();

      // If there are suggestions, update their status to outdated
      if (isNonEmptyArray(suggestions)) {
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.FIXED);
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }

    return { status: 'complete' };
  }

  // Update opportunity
  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    createOpportunityProps(auditResult.vulnerabilityReport),
  );

  // As a buildKey we hash all the component details and add name and version for readability
  const buildKey = (item) => {
    const s = JSON.stringify(item);
    const hash = createHash('sha256').update(s).digest('hex').slice(0, 8);
    return `${item.name}@${item.version}#${hash}`;
  };

  // Populate suggestions
  await syncSuggestions({
    opportunity,
    newData: vulnerabilityReport.vulnerableComponents,
    context,
    buildKey,
    mapNewSuggestion:
        (entry) => mapVulnerabilityToSuggestion(opportunity, entry),
    log,
  });

  const configuration = await Configuration.findLatest();
  const generateSuggestions = configuration.isHandlerEnabledForSite('security-vulnerabilities-auto-suggest', site);
  if (!generateSuggestions) {
    log.debug(
      `[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping code generation with mystique, because 
      'security-vulnerabilities-auto-suggest' not configured.`,
    );
    return { status: 'complete' };
  }

  const codeInfo = extractCodeInfo(data);
  if (!codeInfo) {
    log.debug(
      `[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping code generation with mystique, because
      import worker could not get code.`,
    );
    return { status: 'complete' };
  }

  const refreshedOpportunity = await dataAccess.Opportunity.findById?.(opportunity.getId());
  const suggestions = await (refreshedOpportunity || opportunity).getSuggestions();
  const newSuggestions = suggestions.filter((s) => [
    SuggestionDataAccess.STATUSES.NEW,
    SuggestionDataAccess.STATUSES.PENDING_VALIDATION,
  ].includes(s.getStatus()));
  const suggestionIds = newSuggestions.map((s) => s.getId());
  const message = {
    type: 'codefix:security-vulnerabilities',
    siteId: site.getId(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      opportunityId: opportunity.getId(),
      suggestionIds,
      codeBucket: codeInfo.codeBucket,
      codePath: codeInfo.codePath,
    },
  };

  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] sending message to Mystique for code fix generation: ${JSON.stringify(message)}`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  return { status: 'complete' };
};

export default new AuditBuilder()
// Note the import worker MUST trigger the next step regardless if code repo is configured
  .withUrlResolver(noopUrlResolver)
  .addStep('import-from-starfish', extractCodeBucket, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('generate-suggestion-data', opportunityAndSuggestionsStep)
  .build();
