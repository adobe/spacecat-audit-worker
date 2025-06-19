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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_CSP;

function createOpportunityData() {
  return {
    runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
    origin: 'AUTOMATION',
    title: 'The Content Security Policy configuration is ineffective against Cross Site Scripting (XSS) attacks',
    description: 'Content Security Policy can help protect applications from Cross Site Scripting (XSS) attacks, but in order for it to be effective one needs to define a secure policy. The recommended CSP setup is "Strict CSP with (cached) nonce + strict-dynamic".',
    data: {
      howToFix: '**Warning:** This solution requires testing before deployment. Customer code and configurations vary, so please validate in a test branch first.  \nSee https://www.aem.live/docs/csp-strict-dynamic-cached-nonce for more details.',
      dataSources: [
        'Page',
      ],
      securityType: 'EDS-CSP',
      mainMetric: {
        name: null,
      },
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function cspOpportunityAndSuggestions(auditUrl, auditData, context, site) {
  const { dataAccess, log } = context;
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Classifying CSP suggestions for ${JSON.stringify(auditData)}`);

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

  /*
    all modern browsers support the `strict-dynamic` directive,
    so we don't need backward compatible suggestions
  */
  csp = csp.filter((item) => !item.description?.includes('backward compatible'));

  if (!csp.length) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] No CSP information found for ${site.getId()}`);
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    { siteId: auditData.siteId, id: auditData.auditId },
    context,
    createOpportunityData,
    AUDIT_TYPE,
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
    log,
  });

  return { ...auditData };
}
