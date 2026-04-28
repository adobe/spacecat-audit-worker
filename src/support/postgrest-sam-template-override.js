/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Values captured at cold start from the Lambda/SAM template environment, before Vault
 * overwrites process.env on the first request.
 */
const SAM_TEMPLATE_POSTGREST = {
  DATA_SERVICE_PROVIDER: process.env.DATA_SERVICE_PROVIDER,
  POSTGREST_URL: process.env.POSTGREST_URL,
  POSTGREST_SCHEMA: process.env.POSTGREST_SCHEMA,
  POSTGREST_API_KEY: process.env.POSTGREST_API_KEY,
};

const KEYS = Object.keys(SAM_TEMPLATE_POSTGREST);

/**
 * Returns a printable string for the URL. Used for logging statements.
 * @param {string | undefined} url
 * @returns {string}
 */
function safeUrlHost(url) {
  if (!url) {
    return '(empty)';
  }
  try {
    return new URL(url).host;
  } catch {
    return '(invalid URL)';
  }
}

/**
 * After spacecat-shared-vault-secrets merges Vault into `context.env` and `process.env`,
 * PostgREST settings from Vault often point at VPC-only values (e.g. `http://data-svc.internal`).
 * For SAM local / Docker Desktop, set `POSTGREST_URL` (and `POSTGREST_API_KEY`) in your local
 * environment, and set `POSTGREST_USE_SAM_TEMPLATE=true` so these local template values are used.
 *
 * @param {Function} fn - Next handler in the wrap chain
 * @returns {Function} Wrapped handler
 */
export default function postgrestSamTemplateOverride(fn) {
  return async (request, context) => {
    const { log } = context;
    const diag = process.env.POSTGREST_LOG_EFFECTIVE_URL === 'true';

    // if we are using our local values, ensure the POSTGREST_URL is set to the override value
    if (process.env.POSTGREST_USE_SAM_TEMPLATE === 'true') {
      if (diag && log?.info) {
        log.info(
          `[postgrest-env] snapshot at import: POSTGREST_URL host=${safeUrlHost(SAM_TEMPLATE_POSTGREST.POSTGREST_URL)} `
          + `POSTGREST_URL_OVERRIDE host=${safeUrlHost(process.env.POSTGREST_URL_OVERRIDE)} `
          + `after-vault host=${safeUrlHost(process.env.POSTGREST_URL)}`,
        );
      }

      for (const key of KEYS) {
        let value = SAM_TEMPLATE_POSTGREST[key];
        if (key === 'POSTGREST_URL' && (value === undefined || value === '')) {
          value = process.env.POSTGREST_URL_OVERRIDE;
        }
        if (value !== undefined && value !== '') {
          context.env[key] = value;
          process.env[key] = value;
        }
      }

      if (diag && log?.info) {
        log.info(
          `[postgrest-env] effective POSTGREST_URL host=${safeUrlHost(context.env.POSTGREST_URL)} `
          + '(set POSTGREST_LOG_EFFECTIVE_URL=false to hide)',
        );
      }
    }
    return fn(request, context);
  };
}
