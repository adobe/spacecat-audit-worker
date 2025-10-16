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
  createTooStrongOpportunityData,
  createTooStrongMetrics,
} from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';
import { mapTooStrongSuggestion } from './suggestion-data-mapper.js';
import { fetchPermissionsReport, markOpportunityAsFixed } from './common.js';

const INTERVAL = 7; // days
const AUDIT_TYPE = 'security-permissions'; // Audit.AUDIT_TYPES.SECURITY_PERMISSIONS;

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
export async function permissionsAuditRunner(baseURL, context, site) {
  const { log } = context;

  // This opportunity is only relevant for aem_cs delivery-type at the moment
  if (site.getDeliveryType() !== DELIVERY_TYPES.AEM_CS) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping permissions audit as site is of delivery type ${site.getDeliveryType()}`);
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

    if (permissionsReport == null) {
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Found no permissions report`);
      return {
        auditResult: {
          finalUrl: baseURL,
          error: 'Permission report not found',
          success: false,
        },
        fullAuditRef: baseURL,
      };
    }

    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] identified: ${allPermissionsCnt} jcr:all permissions, ${adminChecksCnt} admin checks`);

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
    const errorMessage = `[${AUDIT_TYPE}] [Site: ${site.getId()}] permissions audit failed with error: ${error.message}`;
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
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] audit is disabled for site`);
    return { status: 'complete' };
  }

  const { success } = auditData.auditResult;
  if (!success) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping opportunity / suggestions generation`);
    return { status: 'complete' };
  }

  const { permissionsReport } = auditData.auditResult;

  const { Opportunity } = dataAccess;
  // Process too strong opportunities
  // eslint-disable-next-line max-len
  const strongOpportunities = (await Opportunity.allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW))
    .filter((o) => o.getType() === AUDIT_TYPE);

  // If no too strong permissions issues found in the report, resolve existing opportunities
  if (!isNonEmptyArray(permissionsReport?.allPermissions)) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no jcr:all permissions found, resolving existing opportunities (${strongOpportunities.length})`);
    await Promise.all(strongOpportunities.map(
      (o) => markOpportunityAsFixed(AUDIT_TYPE, o, site, context),
    ));
    return { status: 'complete' };
  }

  // eslint-disable-next-line max-len
  const tooStrongOpt = strongOpportunities.length > 0 ? strongOpportunities[0] : await convertToOpportunity(
    auditUrl,
    { siteId: auditData.siteId, id: auditData.auditId },
    context,
    createTooStrongOpportunityData,
    AUDIT_TYPE,
    createTooStrongMetrics(permissionsReport.allPermissions),
  );

  // Flatten allPermission arrays by path and principal
  const flattenedPermissions = permissionsReport.allPermissions
    // eslint-disable-next-line max-len
    .flatMap(({ path, details }) => details.map((d) => ({ path, permissions: d.acl, ...d })));

  const buildTooStrongSuggestionKey = (data) => {
    const s = JSON.stringify(data.permissions);
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

  return { status: 'complete' };
};

export default new AuditBuilder()
  .withRunner(permissionsAuditRunner)
  .withPostProcessors([tooStrongOpportunityStep])
  .build();
