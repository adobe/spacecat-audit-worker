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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import {
  internalServerError, noContent, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import {
  getRUMUrl,
} from '../support/utils.js';

/**
 * url param in run-query@v3/rum-dashboard works in a 'startsWith' fashion. url=domain.com returns
 * an empty result whereas url=www.domain.com/ returns the desired result. To catch the redirects
 * to subdomains we issue a GET call to the domain, then use the final url after redirects
 * @param url
 * @returns finalUrl {Promise<string>}
 */

function processRUMResponse(data) {
  return data
    .map((row) => ({
      experiment: row.experiment,
      p_value: row.p_value,
      variant: row.variant,
      variant_experimentations: row.variant_experimentations,
      variant_conversions: row.variant_conversions,
      variant_conversion_rate: row.variant_conversion_rate,
      time5: row.time5,
      time95: row.time95,
    }));
}
export default async function auditExperiments(message, context) {
  const { type, url: siteId, auditContext } = message;
  const { dataAccess, log, sqs } = context;
  const {
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;
  try {
    log.info(`Received audit request for siteId: ${siteId}`);
    const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
    if (!site) {
      return notFound('Site not found');
    }
    if (!site.isLive()) {
      log.info(`Site ${siteId} is not live`);
      return ok();
    }

    const rumAPIClient = RUMAPIClient.createFrom(context);
    const finalUrl = await getRUMUrl(site.getBaseURL());
    auditContext.finalUrl = finalUrl;
    const params = {
      url: finalUrl,
    };

    const data = await rumAPIClient.getExperimentationData(params);
    const auditResult = processRUMResponse(data);

    const auditData = {
      siteId: site.getId(),
      isLive: site.isLive(),
      auditedAt: new Date().toISOString(),
      auditType: type,
      auditResult: {
        result: auditResult,
        finalUrl: auditContext.finalUrl,
      },
      fullAuditRef: rumAPIClient.createExperimentationURL({ url: auditContext.finalUrl }),
    };
    await dataAccess.addAudit(auditData);
    await sqs.sendMessage(queueUrl, {
      url: site.getBaseURL(),
      type,
      auditContext,
      auditResult,
    });
    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    return noContent();
  } catch (e) {
    log.error(`Audit ${type}failed for ${siteId}`, e);
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
