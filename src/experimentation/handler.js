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
import URI from 'urijs';
import { hasText } from '@adobe/spacecat-shared-utils';
import RUMAPIClient, { createExperimentationURL } from '@adobe/spacecat-shared-rum-api-client-v1';
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMUrl } from '../support/utils.js';

function processRUMResponse(data) {
  return data
    .map((row) => ({
      experiment: row.experiment,
      p_value: row.p_value,
      variant: row.variant,
      variant_experimentation_events: row.variant_experimentation_events,
      variant_conversion_events: row.variant_conversion_events,
      variant_experimentations: row.variant_experimentations,
      variant_conversions: row.variant_conversions,
      variant_conversion_rate: row.variant_conversion_rate,
      time5: row.time5,
      time95: row.time95,
    }));
}

export function hasNonWWWSubdomain(baseUrl) {
  try {
    const uri = new URI(baseUrl);
    return hasText(uri.domain()) && hasText(uri.subdomain()) && uri.subdomain() !== 'www';
  } catch {
    throw new Error(`Cannot parse baseURL: ${baseUrl}`);
  }
}

async function processAudit(baseURL, context) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  let finalUrl = await getRUMUrl(baseURL);
  let params = {
    url: finalUrl,
  };

  let data = await rumAPIClient.getExperimentationData(params);
  if (data.length === 0 && !hasNonWWWSubdomain(baseURL) && !finalUrl.toLowerCase().startsWith('www')) {
    finalUrl = `www.${finalUrl}`;
    params = {
      url: finalUrl,
    };
    data = await rumAPIClient.getExperimentationData(params);
  }
  return {
    auditResult: processRUMResponse(data),
    fullAuditRef: createExperimentationURL({ url: finalUrl }),
  };
}

export async function experimentationAuditRunner(baseURL, context) {
  const { log } = context;
  log.info(`Received Experimentation audit request for ${baseURL}`);
  const startTime = process.hrtime();

  const auditData = await processAudit(
    baseURL,
    context,
  );

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Experimentation Audit completed in ${formattedElapsed} seconds for ${baseURL}`);
  return auditData;
}

export default new AuditBuilder()
  .withRunner(experimentationAuditRunner)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
