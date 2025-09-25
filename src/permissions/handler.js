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

import { Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import {
  createTooStrongOpportunityData,
  createTooStrongMetrics, createAdminOpportunityData, createAdminMetrics,
} from './opportunity-data-mapper.js';
import { getImsOrgId, syncSuggestions } from '../utils/data-access.js';
import { mapAdminSuggestion, mapTooStrongSuggestion } from './suggestion-data-mapper.js';

const INTERVAL = 7; // days
const AUDIT_TYPE = 'security-permissions'; // Audit.AUDIT_TYPES.SECURITY_PERMISSIONS;
const OPT_TOO_STRONG_SUFFIX = '-ACL-ALL';
const OPT_ADMIN_SUFFIX = '-ACL-ADMIN';

/**
 * @typedef {import('./permissions-report.d.ts').PermissionsReport} PermissionsReport
 */

/**
 * Fetches permissions report for a given AEM Cloud Service site from the starfish API.
 *
 * @param {string} baseURL - The base URL of the site
 * @param {object} context - The context object of the audit
 * @param {object} site - The site object containing delivery configuration and details.
 * @return {Promise<PermissionsReport>} A promise that resolves to the permissions report data.
 */
export async function fetchPermissionsReport(baseURL, context, site) {
  const { log, env, dataAccess } = context;

  // Retrieve site detailsd
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

  // Fetch permissions report
  try {
    const headers = {
      Authorization: `Bearer ${token.access_token}`, 'x-api-key': env.IMS_CLIENT_ID, 'x-gw-ims-org-id': imsOrg,
    };
    const resp = await fetch(`https://aem-trustcenter-dev.adobe.io/api/reports/${programId}/${environmentId}/permissions`, { headers });
    if (!resp.ok) {
      throw new Error(`Failed to fetch permissions report: HTTP ${resp.status}`);
    }
    const json = await resp.json();
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] successfully fetched permissions report`);

    return json.data;
  } catch (error) {
    throw new Error(`Failed to fetch permissions report ${error.message}`);
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
    const permissionsReport = await fetchPermissionsReport(baseURL, context, site);
    const allPermissionsCnt = permissionsReport?.allPermissions?.length || 0;
    const adminChecksCnt = permissionsReport?.adminChecks?.length || 0;

    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] identified: ${allPermissionsCnt} jcr:all permissions, ${adminChecksCnt} admin checks`);

    // Build and return audit result
    return {
      auditResult: {
        finalUrl: baseURL,
        permissionsReport,
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
        finalUrl: baseURL, error: errorMessage, success: false,
      },
      fullAuditRef: baseURL,
    };
  }
}

async function resolveOpportunity(opportunity, site, context) {
  const { log, dataContext } = context;
  const { Suggestion } = dataContext;

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no permissions issues found, but found opportunity, updating status to RESOLVED`);
  opportunity.setStatus(Oppty.STATUSES.RESOLVED);

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
  const { Configuration } = dataAccess;

  // Check whether the audit is enabled for the site
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('security-permissions', site)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] audit is disabled for site`);
    return { status: 'complete' };
  }

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== 'aem_cs') {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping opportunity as it is of delivery type ${site.getDeliveryType()}`);
    return { status: 'complete' };
  }

  const { permissionReport, success } = auditData.auditResult;

  if (!success) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping opportunity / suggestions generation`);
    return { status: 'complete' };
  }

  const { Opportunity } = dataAccess;
  const opportunities = (await Opportunity.allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW))
    .filter((o) => o.getType() === AUDIT_TYPE);

  // Process too strong opportunities
  const isTooStrongOppty = (o) => o.getData().securityType?.endsWith(OPT_TOO_STRONG_SUFFIX);
  const strongOpportunities = opportunities.filter(isTooStrongOppty);

  // If no too strong permissions issues found, resolve existing opportunities
  if (!isNonEmptyArray(permissionReport?.allPermissions)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no jcr:all permissions found, resolving existing opportunities (${strongOpportunities.length})`);
    await Promise.all(opportunities.map((o) => resolveOpportunity(o, site, context)));
  } else {
    const tooStrongOpt = await convertToOpportunity(
      auditUrl,
      { siteId: auditData.siteId, id: auditData.auditId },
      context,
      createTooStrongOpportunityData,
      AUDIT_TYPE,
      createTooStrongMetrics(permissionReport.allPermissions),
    );

    // Flatten allPermission arrays by path and principal
    const flattenedPermissions = permissionReport.allPermissions
      .flatMap(({ path, details }) => details.map(({ principal }) => ({ path, principal })));

    const buildTooStrongSuggestionKey = (data) => {
      const s = JSON.stringify(data);
      let hash = 0;
      for (let i = 0; i < s.length; i += 1) {
        const code = s.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        hash = ((hash << 5) - hash) + code;
        // eslint-disable-next-line no-bitwise
        hash &= hash; // Convert to 32bit integer
      }
      return `${data.path}@${data.principal}#${hash}`;
    };

    await syncSuggestions({
      context,
      opportunity: tooStrongOpt,
      newData: flattenedPermissions,
      buildKey: buildTooStrongSuggestionKey,
      mapNewSuggestion: (entry) => mapTooStrongSuggestion(tooStrongOpt, entry),
    });

    tooStrongOpt.setUpdatedBy('system');
    await tooStrongOpt.save();
  }

  // Process admin opportunities
  const isAdminOppty = (o) => o.getData().securityType?.endsWith(OPT_ADMIN_SUFFIX);
  const adminOpportunities = opportunities.filter(isAdminOppty);

  // If no admin issues found, resolve existing admin opportunities
  if (!isNonEmptyArray(permissionReport?.adminChecks)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no admin checks found, resolving existing admin opportunities (${adminOpportunities.length})`);
    await Promise.all(adminOpportunities.map((o) => resolveOpportunity(o, site, context)));
  } else {
    const adminOpt = await convertToOpportunity(
      auditUrl,
      { siteId: auditData.siteId, id: auditData.auditId },
      context,
      createAdminOpportunityData,
      AUDIT_TYPE,
      createAdminMetrics(permissionReport.adminChecks),
    );

    // Flatten adminChecks arrays by principal and path and privileges
    const flattenedPermissions = permissionReport.adminChecks
      // eslint-disable-next-line max-len
      .flatMap(({ principal, details }) => details.map((d) => ({ principal, path: d.path, privileges: d.privileges })));

    const buildAdminSuggestionKey = (data) => {
      const s = JSON.stringify(data);
      let hash = 0;
      for (let i = 0; i < s.length; i += 1) {
        const code = s.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        hash = ((hash << 5) - hash) + code;
        // eslint-disable-next-line no-bitwise
        hash &= hash; // Convert to 32bit integer
      }
      return `${data.principal}@${data.path}#${hash}`;
    };

    await syncSuggestions({
      context,
      opportunity: adminOpt,
      newData: flattenedPermissions,
      buildKey: buildAdminSuggestionKey,
      mapNewSuggestion: (entry) => mapAdminSuggestion(adminOpt, entry),
    });

    adminOpt.setUpdatedBy('system');
    await adminOpt.save();
  }

  return { status: 'complete' };
};

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(permissionsAuditRunner)
  .withPostProcessors([opportunityAndSuggestionsStep])
  .build();
