/*
 * Copyright 2024 Adobe. All rights reserved.
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
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { cspAutoSuggest } from './csp-auto-suggest.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_CSP;

function createOpportunityData(props) {
  return {
    runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
    origin: 'AUTOMATION',
    title: 'The Content Security Policy configuration is ineffective against Cross Site Scripting (XSS) attacks',
    description: 'Content Security Policy can help protect applications from Cross Site Scripting (XSS) attacks, but in order for it to be effective one needs to define a secure policy. The recommended CSP setup is "Strict CSP with (cached) nonce + strict-dynamic".',
    data: {
      securityScoreImpact: 10,
      howToFix: '### ⚠ **Warning**\nThis solution requires testing before deployment. Customer code and configurations vary, so please validate in a test branch first.\nSee https://www.aem.live/docs/csp-strict-dynamic-cached-nonce for more details.',
      dataSources: [
        'Page',
      ],
      securityType: 'EDS-CSP',
      mainMetric: {
        name: null,
      },
      ...props,
    },
    tags: [
      'CSP',
      'Security',
    ],
  };
}

function flattenCSP(csp) {
  return csp.flatMap((item) => {
    if (item.subItems?.items) {
      return item.subItems.items.map((subitem) => ({ severity: item.severity, ...subitem }));
    }
    return item;
  });
}

/**
 * Checks for an existing opportunity instance and markes all suggestions as completed.
 *
 * @param {Object} auditData - The audit data containing the audit result and additional details.
 * @param {Object} context - The context object containing the data access and logger objects.
 * @param {string} auditType - The type of the audit.
 * @returns {Promise<void>} No result.
 * @throws {Error} If fetching or creating the opportunity fails.
 */
export async function resolveOpportunity(auditData, context, auditType) {
  const { dataAccess, log } = context;
  const { Opportunity, Suggestion } = dataAccess;
  let opportunity;

  // Check for existing opportunity
  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(
      auditData.siteId,
      Oppty.STATUSES.NEW,
    );
    opportunity = opportunities.find((oppty) => oppty.getType() === auditType);
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  if (!opportunity) {
    return;
  }

  // Mark all suggestions as completed
  try {
    opportunity.setStatus(Oppty.STATUSES.RESOLVED);
    await opportunity.save();

    const existingSuggestions = await opportunity.getSuggestions();
    const existingOutdatedSuggestions = existingSuggestions
      .filter((existing) => ![
        SuggestionDataAccess.STATUSES.OUTDATED,
        SuggestionDataAccess.STATUSES.FIXED,
        SuggestionDataAccess.STATUSES.ERROR,
        SuggestionDataAccess.STATUSES.SKIPPED,
      ].includes(existing.getStatus()));
    if (isNonEmptyArray(existingOutdatedSuggestions)) {
      await Suggestion.bulkUpdateStatus(
        existingOutdatedSuggestions,
        SuggestionDataAccess.STATUSES.OUTDATED,
      );
    }
  } catch (e) {
    log.error(`Failed to resolve suggestions for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
    throw new Error(`Failed to resolve suggestions for siteId ${auditData.siteId}: ${e.message}`);
  }
}

// eslint-disable-next-line no-unused-vars
export async function cspOpportunityAndSuggestions(auditUrl, auditData, context, site) {
  const { dataAccess, log } = context;
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Classifying CSP suggestions for ${JSON.stringify(auditData)}`);

  if (auditData.auditResult.success === false) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping suggestions generation`);
    return { ...auditData };
  }

  // this opportunity is only relevant for aem_edge delivery type at the moment
  if (site.getDeliveryType() !== 'aem_edge') {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] skipping CSP opportunity as it is of delivery type ${site.getDeliveryType()}`);
    return { ...auditData };
  }

  // Check whether the audit is enabled for the site
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('security-csp', site)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] audit is disabled for site`);
    return { ...auditData };
  }

  let { csp } = auditData.auditResult;

  // flatten the subitems
  csp = flattenCSP(csp);
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] CSP information from lighthouse report: ${JSON.stringify(csp)}`);

  csp.forEach((item) => {
    if (item.description && item.description.includes('nonces or hashes')) {
      // eslint-disable-next-line no-param-reassign
      item.description = item.description.replace(/nonces or hashes/g, 'nonces').trim();
    }
  });

  if (!csp.length) {
    await resolveOpportunity(
      { siteId: auditData.siteId, id: auditData.auditId },
      context,
      AUDIT_TYPE,
    );
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No CSP information found for ${site.getId()}`);
    return { ...auditData };
  }

  // CSP auto-suggestion
  csp = await cspAutoSuggest(auditUrl, csp, context, site);

  // determine dynamic opportunity properties, used when creating + updating the opportunity
  const props = {
    mainMetric: {
      name: csp.length === 1 ? 'Issue' : 'Issues',
      value: csp.length,
    },
  };

  const opportunity = await convertToOpportunity(
    auditUrl,
    { siteId: auditData.siteId, id: auditData.auditId },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    props,
  );

  const buildKey = (data) => data.description.toLowerCase().replace(/[^a-z0-9]/g, '');

  await syncSuggestions({
    opportunity,
    newData: csp,
    context,
    buildKey,
    mapNewSuggestion: (data) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: 0,
      data: {
        severity: data.severity,
        directive: data.directive,
        description: data.description,
      },
    }),
  });

  return { ...auditData };
}
