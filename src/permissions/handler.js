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
import { DELIVERY_TYPES, hasText, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { createHash } from 'node:crypto';
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
const TOO_STRONG_AUDIT_TYPE = 'security-permissions'; // Audit.AUDIT_TYPES.SECURITY_PERMISSIONS;
const REDUNDANT_AUDIT_TYPE = 'security-permissions-redundant'; // Audit.AUDIT_TYPES.SECURITY_PERMISSIONS_REDUNDANT;

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

  // Retrieve IMS org information
  const imsOrg = await getImsOrgId(site, dataAccess, log);
  if (!hasText(imsOrg)) {
    throw new Error('Missing IMS org');
  } else if (imsOrg === 'default') {
    log.debug(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] site is configured with default IMS org`);
  }

  const { programId, environmentId } = site.getDeliveryConfig();
  if (!programId || !environmentId) {
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

  // Fetch permissions report
  let resp;
  try {
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      'x-api-key': env.IMS_CLIENT_ID,
      'x-gw-ims-org-id': imsOrg,
    };
    resp = await fetch(
      `${env.STARFISH_API_BASE_URL}/reports/${programId}/${environmentId}/permissions`,
      { headers },
    );
  } catch (error) {
    throw new Error(`Failed to fetch permissions report ${error.message}`);
  }

  if (!resp.ok) {
    if (resp.status === 404) {
      log.debug(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] permissions report not found`);
      return null;
    }
    throw new Error(`Failed to fetch permissions report: HTTP ${resp.status}`);
  }

  log.debug(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] successfully fetched permissions report`);
  const json = await resp.json();
  return json.data;
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

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== DELIVERY_TYPES.AEM_CS) {
    log.debug(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] skipping permissions audit as site is of delivery type ${site.getDeliveryType()}`);
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
    const permissionsReport = await fetchPermissionsReport(baseURL, context, site);
    const allPermissionsCnt = permissionsReport?.allPermissions?.length || 0;
    const adminChecksCnt = permissionsReport?.adminChecks?.length || 0;

    log.info(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] identified: ${allPermissionsCnt} jcr:all permissions, ${adminChecksCnt} admin checks`);

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
    const errorMessage = `[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] permissions audit failed with error: ${error.message}`;
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

async function markOpportunityAsFixed(auditType, opportunity, site, context) {
  const { log, dataContext } = context;
  const { Suggestion } = dataContext;

  log.info(`[${auditType}] [Site: ${site.getId()}] no permissions issues found, but found opportunity, updating status to RESOLVED`);
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
 * Creates opportunities and syncs suggestions for security-permissions audit type.
 *
 * This step focuses on identifying "too strong" permissions issues (e.g., jcr:all permissions)
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results and suggestions.
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @param {Object} site - The site object
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export const tooStrongOpportunityStep = async (auditUrl, auditData, context, site) => {
  const { log, dataAccess } = context;
  const { Configuration } = dataAccess;

  // Check whether the audit is enabled for the site
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('security-permissions', site)) {
    log.info(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] audit is disabled for site`);
    return { status: 'complete' };
  }

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== 'aem_cs') {
    log.debug(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] skipping opportunity as it is of delivery type ${site.getDeliveryType()}`);
    return { status: 'complete' };
  }

  const { permissionsReport, success } = auditData.auditResult;

  if (!success) {
    log.info(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping opportunity / suggestions generation`);
    return { status: 'complete' };
  }

  const { Opportunity } = dataAccess;
  // Process too strong opportunities
  // eslint-disable-next-line max-len
  const strongOpportunities = (await Opportunity.allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW))
    .filter((o) => o.getType() === TOO_STRONG_AUDIT_TYPE);

  // If no too strong permissions issues found in the report, resolve existing opportunities
  if (!isNonEmptyArray(permissionsReport?.allPermissions)) {
    log.info(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] no jcr:all permissions found, resolving existing opportunities (${strongOpportunities.length})`);
    await Promise.all(strongOpportunities.map(
      (o) => markOpportunityAsFixed(TOO_STRONG_AUDIT_TYPE, o, site, context),
    ));
    return { status: 'complete' };
  } else {
    const tooStrongOpt = await convertToOpportunity(
      auditUrl,
      { siteId: auditData.siteId, id: auditData.auditId },
      context,
      createTooStrongOpportunityData,
      TOO_STRONG_AUDIT_TYPE,
      createTooStrongMetrics(permissionsReport.allPermissions),
    );

    // Flatten allPermission arrays by path and principal
    const flattenedPermissions = permissionsReport.allPermissions
      // eslint-disable-next-line max-len
      .flatMap(({ path, details }) => details.map(() => ({ path, ...details })));

    const buildTooStrongSuggestionKey = (data) => {
      const s = JSON.stringify(data);
      const hash = createHash('sha256').update(s).digest('hex').slice(0, 8);
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

  return { status: 'complete' };
};

/**
 * Creates opportunities and syncs suggestions.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results and suggestions.
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @param {Object} site - The site object
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export const redundantPermissionsOpportunityStep = async (auditUrl, auditData, context, site) => {
  const { log, dataAccess } = context;
  const { Configuration } = dataAccess;

  // Check whether the audit is enabled for the site
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('security-permissions', site)) {
    log.info(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] audit is disabled for site`);
    return { status: 'complete' };
  }

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== 'aem_cs') {
    log.debug(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] skipping opportunity as it is of delivery type ${site.getDeliveryType()}`);
    return { status: 'complete' };
  }

  const { permissionsReport, success } = auditData.auditResult;

  if (!success) {
    log.info(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping opportunity / suggestions generation`);
    return { status: 'complete' };
  }

  const { Opportunity } = dataAccess;
  // eslint-disable-next-line max-len
  const adminOpportunities = (await Opportunity.allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW))
    .filter((o) => o.getType() === REDUNDANT_AUDIT_TYPE);

  // Process admin opportunities
  // If no admin issues found, resolve existing admin opportunities
  if (!isNonEmptyArray(permissionsReport?.adminChecks)) {
    log.info(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] no admin checks found, resolving existing admin opportunities (${adminOpportunities.length})`);
    await Promise.all(
      adminOpportunities.map((o) => markOpportunityAsFixed(REDUNDANT_AUDIT_TYPE, o, site, context)),
    );
    return { status: 'complete' };
  } else {
    const adminOpt = await convertToOpportunity(
      auditUrl,
      { siteId: auditData.siteId, id: auditData.auditId },
      context,
      createAdminOpportunityData,
      REDUNDANT_AUDIT_TYPE,
      createAdminMetrics(permissionsReport.adminChecks),
    );

    const generateSuggestions = configuration.isHandlerEnabledForSite('security-permissions-auto-suggest', site);
    if (!generateSuggestions) {
      log.debug(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] security-permissions-auto-suggest not configured, skipping version recommendations`);
      return { status: 'complete' };
    }

    // Flatten adminChecks arrays by principal and path and privileges
    const flattenedPermissions = permissionsReport.adminChecks
      // eslint-disable-next-line max-len
      .flatMap(({ principal, details }) => details.map((d) => ({ principal, path: d.path, ...d })));

    const buildAdminSuggestionKey = (data) => {
      const s = JSON.stringify(data);
      const hash = createHash('sha256').update(s).digest('hex').slice(0, 8);
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
  .withPostProcessors([tooStrongOpportunityStep, redundantPermissionsOpportunityStep])
  .build();
