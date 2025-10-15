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

import { Opportunity as Oppty } from '@adobe/spacecat-shared-data-access';
import {
  DELIVERY_TYPES,
  isNonEmptyArray,
} from '@adobe/spacecat-shared-utils';
import { createHash } from 'node:crypto';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import {
  createAdminOpportunityData, createAdminMetrics,
} from './opportunity-data-mapper.js';
import { mapAdminSuggestion } from './suggestion-data-mapper.js';
import { fetchPermissionsReport, markOpportunityAsFixed } from './common.js';
import { syncSuggestions } from '../utils/data-access.js';

const INTERVAL = 7; // days
const TOO_STRONG_AUDIT_TYPE = 'security-permissions'; // Audit.AUDIT_TYPES.SECURITY_PERMISSIONS;
const REDUNDANT_AUDIT_TYPE = 'security-permissions-redundant'; // Audit.AUDIT_TYPES.SECURITY_PERMISSIONS_REDUNDANT;

/**
 * @typedef {import('./permissions-report.d.ts').PermissionsReport} PermissionsReport
 */

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
export async function redundantAuditRunner(baseURL, context, site) {
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

    log.debug(`[${TOO_STRONG_AUDIT_TYPE}] [Site: ${site.getId()}] identified: ${allPermissionsCnt} jcr:all permissions, ${adminChecksCnt} admin checks`);

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
    log.debug(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] audit is disabled for site`);
    return { status: 'complete' };
  }

  const { success } = auditData.auditResult;
  if (!success) {
    log.debug(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping opportunity / suggestions generation`);
    return { status: 'complete' };
  }

  const generateSuggestions = configuration.isHandlerEnabledForSite('security-permissions-auto-suggest', site);
  if (!generateSuggestions) {
    log.info(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] security-permissions-auto-suggest not configured, skipping permission suggestion`);
    return { status: 'complete' };
  }

  const { permissionsReport } = auditData.auditResult;

  const { Opportunity } = dataAccess;
  // eslint-disable-next-line max-len
  const adminOpportunities = (await Opportunity.allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW))
    .filter((o) => o.getType() === REDUNDANT_AUDIT_TYPE);

  // Process admin opportunities
  // If no admin issues found, resolve existing admin opportunities
  if (!isNonEmptyArray(permissionsReport?.adminChecks)) {
    log.debug(`[${REDUNDANT_AUDIT_TYPE}] [Site: ${site.getId()}] no admin checks found, resolving existing admin opportunities (${adminOpportunities.length})`);
    await Promise.all(
      adminOpportunities.map((o) => markOpportunityAsFixed(REDUNDANT_AUDIT_TYPE, o, site, context)),
    );
    return { status: 'complete' };
  }
  const adminOpt = await convertToOpportunity(
    auditUrl,
    { siteId: auditData.siteId, id: auditData.auditId },
    context,
    createAdminOpportunityData,
    REDUNDANT_AUDIT_TYPE,
    createAdminMetrics(permissionsReport.adminChecks),
  );

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

  return { status: 'complete' };
};

export default new AuditBuilder()
  .withRunner(redundantAuditRunner)
  .withPostProcessors([redundantPermissionsOpportunityStep])
  .build();
