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
import { Site } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray, isValidUrl } from '@adobe/spacecat-shared-utils';

export async function saveIntermediateResults(context, result, auditName) {
  const {
    site, job, step, dataAccess, log,
  } = context;
  const { AsyncJob } = dataAccess;

  try {
    const jobEntity = await AsyncJob.findById(job.getId());
    jobEntity.setResult(result);
    await jobEntity.save();
    log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${auditName}: Intermediate results saved successfully`); // remove? ~60k in last 7d
  } catch (error) {
    log.warn(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${auditName}: Failed to save intermediate results: ${error.message}`);
  }
}

export function isValidUrls(urls) {
  return (
    isNonEmptyArray(urls)
    && urls.every((url) => isValidUrl(url))
  );
}

export function getPrefixedPageAuthToken(site, token, options) {
  if (site.getDeliveryType() === Site.DELIVERY_TYPES.AEM_CS && options.promiseToken) {
    return `Bearer ${token}`;
  } else {
    return `token ${token}`;
  }
}
