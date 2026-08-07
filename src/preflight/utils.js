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
    log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${auditName}: Intermediate results saved successfully`);
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

/**
 * Builds a logfmt-style `key=value` suffix for a per-audit completion log line, so Splunk's
 * automatic field extraction picks up `audit`/`status`/`duration_ms`/`error` without any
 * SPL-side regex. Appended to the existing `[preflight-audit] site: ..., job: ...` message,
 * never replacing it.
 * @param {{ audit: string, status: 'ok'|'fail', durationMs: number, error?: string }} params
 * @returns {string} A leading-space-prefixed suffix, e.g.
 *   ` audit=canonical status=ok duration_ms=120`
 */
export function formatStructuredAuditLog({
  audit, status, durationMs, error,
}) {
  const parts = [`audit=${audit}`, `status=${status}`, `duration_ms=${durationMs}`];
  if (status === 'fail' && error) {
    // Collapse newlines/CRs to spaces BEFORE quoting: a raw newline inside the quoted value
    // would split the log entry into two lines and corrupt Splunk's per-line field extraction
    // (error messages from stack traces / multi-line assertions commonly contain them).
    const escaped = String(error)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 500);
    parts.push(`error="${escaped}"`);
  }
  return ` ${parts.join(' ')}`;
}
