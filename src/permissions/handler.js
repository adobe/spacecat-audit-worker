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

import { Opportunity as Oppty, Suggestion as SuggestionDataAccess }
  from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityProps } from './opportunity-data-mapper.js';
import { getImsOrgId, syncSuggestions } from '../utils/data-access.js';
import { mapVulnerabilityToSuggestion } from './suggestion-data-mapper.js';

const INTERVAL = 7; // days
const AUDIT_TYPE = 'security-permissions'; // Audit.AUDIT_TYPES.SECURITY_PERMISSIONS;

/**
 * Fetches permissions report for a given AEM Cloud Service site from the starfish API.
 *
 * @param {string} baseURL - The base URL of the site
 * @param {object} context - The context object of the audit
 * @param {object} site - The site object containing delivery configuration and details.
 * @return {Promise<Object>} A promise that resolves to the permissions report data.
 */
export async function fetchPermissionsReport(baseURL, context, site) {
  const { log, env, dataAccess } = context;

  // Retrieve site details
  const imsOrg = await getImsOrgId(site, dataAccess, log);
  const { programId, environmentId } = site.getDeliveryConfig();
  if (!programId || !environmentId) {
    throw new Error('Invalid delivery config for AEM_CS');
  }

  // Get service access-token
  const imsContext = {
    log, env,
  };
  const imsClient = ImsClient.createFrom(imsContext);
  const token = await imsClient.getServiceAccessToken();

  // Fetch vulnerability report
  try {
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      'x-api-key': env.IMS_CLIENT_ID,
      'x-gw-ims-org-id': imsOrg,
    };
    const resp = await fetch(
      `https://aem-trustcenter-dev.adobe.io/api/reports/${programId}/${environmentId}/permissions`,
      { headers },
    );
    const json = await resp.json();

    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] successfully fetched permissions report`);

    return json.data;
  } catch (error) {
    throw new Error('Failed to fetch permissions report');
  }
}

/**
 * Perform an audit to check if the environment has unsafe permissions.
 *
 * @async
 * @param {string} baseURL - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @param {Object} site - The site object
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function permissionsAuditRunner(baseURL, context, site) {
  const { log } = context;

  try {
    const vulnerabilityReport = await fetchPermissionsReport(baseURL, context, site);
    const compCount = vulnerabilityReport.summary.totalComponents;
    const vulnCount = vulnerabilityReport.summary.totalVulnerabilities;

    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] identified: ${vulnCount} vulnerabilities in ${compCount} components`);

    // Build and return audit result
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

/**
 * Creates opportunities and syncs suggestions.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results and suggestions.
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @param {Object} site - The site object
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export const opportunityAndSuggestionsStep = async (auditUrl, auditData, context, site) => {
  const { log, dataAccess } = context;
  const { Configuration, Suggestion } = dataAccess;

  // Check whether the audit is enabled for the site
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('security-permissions', site)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] audit is disabled for site`);
    return { status: 'complete' };
  }

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== 'aem_cs') {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping vulnerability opportunity as it is of delivery type ${site.getDeliveryType()}`);
    return { status: 'complete' };
  }

  const { vulnerabilityReport, success } = auditData.auditResult;

  if (!success) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping opportunity / suggestions generation`);
    return { status: 'complete' };
  }

  if (!isNonEmptyArray(vulnerabilityReport.vulnerableComponents)) {
    // No vulnerabilities found
    // Fetch opportunity
    const { Opportunity } = dataAccess;
    let opportunity;
    try {
      const opportunities = await Opportunity.allBySiteIdAndStatus(
        site.getId(),
        Oppty.STATUSES.NEW,
      );
      opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${site.getId()} failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
    }

    if (opportunity) {
      // No vulnerabilities found, update opportunity status to RESOLVED
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no vulnerabilities found, but found opportunity, updating status to RESOLVED`);
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
    auditUrl,
    { siteId: auditData.siteId, id: auditData.auditId },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    createOpportunityProps(auditData.auditResult.vulnerabilityReport),
  );

  if (!configuration.isHandlerEnabledForSite('security-permissions-auto-suggest', site)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] security-permissions-auto-suggest not configured, skipping suggestion creation`);
    return { status: 'complete' };
  }

  // As a buildKey we hash all the component details and add name and version for readability
  const buildKey = (data) => {
    const s = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < s.length; i += 1) {
      const code = s.charCodeAt(i);
      // eslint-disable-next-line no-bitwise
      hash = ((hash << 5) - hash) + code;
      // eslint-disable-next-line no-bitwise
      hash &= hash; // Convert to 32bit integer
    }
    return `${data.name}@${data.version}#${hash}`;
  };

  // Populate suggestions
  await syncSuggestions({
    opportunity,
    newData: vulnerabilityReport.vulnerableComponents,
    context,
    buildKey,
    mapNewSuggestion: (entry) => mapVulnerabilityToSuggestion(opportunity, entry),
    log,
  });

  return { status: 'complete' };
};

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(permissionsAuditRunner)
  .withPostProcessors([opportunityAndSuggestionsStep])
  .build();
