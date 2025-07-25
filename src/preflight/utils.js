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
import { AsyncJob, Site } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray, isValidUrl } from '@adobe/spacecat-shared-utils';

export async function saveIntermediateResults(context, result, auditName) {
  const {
    site, jobId, normalizedStep, dataAccess, log,
  } = context;
  const { AsyncJob: AsyncJobEntity } = dataAccess;
  try {
    const jobEntity = await AsyncJobEntity.findById(jobId);
    jobEntity.setStatus(AsyncJob.Status.IN_PROGRESS);
    jobEntity.setResultType(AsyncJob.ResultType.INLINE);
    jobEntity.setResult(result);
    await jobEntity.save();
    log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${normalizedStep}. ${auditName}: Intermediate results saved successfully`);
  } catch (error) {
    // ignore any intermediate errors
    log.warn(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${normalizedStep}. ${auditName}: Failed to save intermediate results: ${error.message}`);
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
