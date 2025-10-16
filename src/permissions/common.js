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

import {
  hasText, isNonEmptyArray,
  tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { Opportunity as Oppty } from '@adobe/spacecat-shared-data-access/src/models/opportunity/index.js';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access/src/models/suggestion/index.js';
import { getImsOrgId } from '../utils/data-access.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_PERMISSIONS;

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
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] site is configured with default IMS org`);
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
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'x-api-key': env.IMS_CLIENT_ID,
    'x-gw-ims-org-id': imsOrg,
  };
  let resp;
  try {
    resp = await fetch(
      `${env.STARFISH_API_BASE_URL}/reports/${programId}/${environmentId}/permissions`,
      { headers },
    );
  } catch (error) {
    throw new Error(`Failed to fetch permissions report ${error.message}`);
  }
  if (resp.status === 404) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] permissions report not found`);
    return null;
  }
  if (!resp.ok) {
    throw new Error(`Failed to fetch permissions report: HTTP ${resp.status}`);
  }
  const json = await resp.json();
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] successfully fetched permissions report`);
  return json.data;
}

/**
 * Given an opportunity where permissions issues were found, mark it as fixed

 * @param auditType the audit type
 * @param opportunity the opportunity to mark as fixed
 * @param site the site
 * @param context the context
 * @returns {Promise<void>}
 */
export async function markOpportunityAsFixed(auditType, opportunity, site, context) {
  const { log, dataAccess } = context;
  const { Suggestion } = dataAccess;

  log.debug(`[${auditType}] [Site: ${site.getId()}] no permissions issues found, but found opportunity, updating status to RESOLVED`);
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
