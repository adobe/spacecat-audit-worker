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
 * TEMPORARY diagnostic (LLMO-6709) — NOT part of the production data path.
 *
 * The production loader (`offsite-brand-presence-semrush.js`) authenticates to the
 * Semrush-backed api-service routes as a registered S2S consumer:
 *   dedicated SEMRUSH_S2S_* IMS client -> POST /auth/s2s/login -> customer-scoped
 *   session token -> domain-urls.
 * That requires the dedicated consumer's client id/secret, which we are still trying to
 * pin down. This module answers a narrower operational question WITHOUT those credentials:
 * using only the worker's EXISTING default IMS client, does api-service already grant this
 * worker access — and via which path?
 *
 * It runs three probes back-to-back and emits one structured Splunk log line per step (event
 * `data_acquisition_bp_semrush_auth_probe`, distinct `probe`/`step`/`status` fields), so each
 * outcome is independently greppable:
 *   - `login_existing_ims`: mint an IMS token from the worker's existing default client, POST
 *     it to /auth/s2s/login, and (if a session token comes back) call domain-urls with it.
 *   - `direct_ims`: call domain-urls with the raw existing IMS bearer, no login exchange
 *     (this exercises api-service's IMS path, not the S2S path).
 *   - `apikey_direct`: call domain-urls with the scoped `x-api-key` (`SPACECAT_API_KEY`, the
 *     credential `brand-resolver.js` already uses against /v2/orgs/...). Independent of IMS —
 *     if the route accepts it, that's access with zero new registration.
 *
 * It is best-effort and side-effect-free: it NEVER throws to the caller and NEVER influences
 * the audit result — it only writes logs. Remove this file (and its handler call site) once
 * the S2S credential question is settled.
 */

import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { resolveBrandResultForSite } from './brand-resolver.js';
import { getDateWindowForPreviousWeeks } from './offsite-brand-presence-postgrest.js';
import { getImsOrgId } from './data-access.js';
import {
  buildDomainUrlsUrl,
  LLMO_API_DEFAULT_BASE_URL,
  S2S_LOGIN_DEFAULT_PATH,
  PAGE_SIZE,
} from './offsite-brand-presence-semrush.js';
import {
  createOffsiteLogger, errorField, AUDIT, OUTCOME, PEER,
} from './offsite-logging.js';

const PROBE_EVENT = 'data_acquisition_bp_semrush_auth_probe';
const FETCH_TIMEOUT_MS = 10_000;
const BODY_SNIPPET_MAX = 500;

/**
 * Reads a response body as a short diagnostic snippet. Never throws.
 *
 * @param {Response} response
 * @returns {Promise<string>} the body (capped), or '' if empty/unreadable.
 */
async function readBodySnippet(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, BODY_SNIPPET_MAX) : '';
  } catch {
    return '';
  }
}

/**
 * Calls the domain-urls endpoint with the given auth headers and logs the outcome under a
 * `probe`/`step=domain_urls` line. `authHeaders` is the credential to test (e.g.
 * `{ Authorization: 'Bearer ...' }` or `{ 'x-api-key': '...' }`); `Accept` is added here.
 * Returns nothing — this is telemetry only.
 */
async function probeDomainUrls({
  olog, probe, authHeaders, url,
}) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(url, {
      headers: { ...authHeaders, Accept: 'application/json' },
      timeout: FETCH_TIMEOUT_MS,
    });
  } catch (error) {
    olog.warn(PROBE_EVENT, `Auth probe [${probe}] domain-urls request failed (network)`, {
      peer: PEER.SEMRUSH, direction: 'inbound', probe, step: 'domain_urls', reason: 'fetch_failed', durationMs: Date.now() - startedAt, outcome: OUTCOME.DEGRADED, ...errorField(error),
    });
    return;
  }
  const { status } = response;
  const durationMs = Date.now() - startedAt;
  if (response.ok) {
    olog.success(PROBE_EVENT, `Auth probe [${probe}] domain-urls: HTTP ${status} (authorized)`, {
      peer: PEER.SEMRUSH, direction: 'inbound', probe, step: 'domain_urls', status, authorized: true, durationMs,
    });
    return;
  }
  const responseBody = await readBodySnippet(response);
  olog.warn(PROBE_EVENT, `Auth probe [${probe}] domain-urls: HTTP ${status} (not authorized)`, {
    peer: PEER.SEMRUSH, direction: 'inbound', probe, step: 'domain_urls', status, authorized: false, responseBody, durationMs, outcome: OUTCOME.DEGRADED,
  });
}

/**
 * Probe A — exchange the worker's existing IMS token for a customer-scoped session token via
 * /auth/s2s/login, then (if it succeeds) call domain-urls with that session token. Logs the
 * login status and whether a session token came back; a successful login proves the worker's
 * existing IMS identity is a registered S2S consumer for this org.
 */
async function probeLoginExistingIms({
  olog, loginUrl, imsAuthorization, imsOrgId, domainUrlsUrl,
}) {
  const probe = 'login_existing_ims';
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(loginUrl, {
      method: 'POST',
      headers: { Authorization: imsAuthorization, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ imsOrgId }),
      timeout: FETCH_TIMEOUT_MS,
    });
  } catch (error) {
    olog.warn(PROBE_EVENT, `Auth probe [${probe}] login request failed (network)`, {
      peer: PEER.SEMRUSH, direction: 'inbound', probe, step: 'login', reason: 'fetch_failed', durationMs: Date.now() - startedAt, outcome: OUTCOME.DEGRADED, ...errorField(error),
    });
    return;
  }
  const { status } = response;
  const durationMs = Date.now() - startedAt;
  if (!response.ok) {
    const responseBody = await readBodySnippet(response);
    olog.warn(PROBE_EVENT, `Auth probe [${probe}] login: HTTP ${status} (rejected — existing IMS identity is likely not a registered S2S consumer)`, {
      peer: PEER.SEMRUSH, direction: 'inbound', probe, step: 'login', status, authorized: false, responseBody, durationMs, outcome: OUTCOME.DEGRADED,
    });
    return;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const sessionToken = body?.sessionToken;
  if (!sessionToken) {
    olog.warn(PROBE_EVENT, `Auth probe [${probe}] login: HTTP ${status} but no sessionToken in the response body`, {
      peer: PEER.SEMRUSH, direction: 'inbound', probe, step: 'login', status, authorized: false, hasSessionToken: false, durationMs, outcome: OUTCOME.DEGRADED,
    });
    return;
  }
  olog.success(PROBE_EVENT, `Auth probe [${probe}] login: HTTP ${status} — sessionToken received (existing IMS identity IS a registered S2S consumer)`, {
    peer: PEER.SEMRUSH, direction: 'inbound', probe, step: 'login', status, authorized: true, hasSessionToken: true, durationMs,
  });
  await probeDomainUrls({
    olog, probe, authHeaders: { Authorization: `Bearer ${sessionToken}` }, url: domainUrlsUrl,
  });
}

/**
 * Runs the two S2S auth diagnostics (see the module header) for one site, using ONLY the
 * worker's existing default IMS client. Best-effort telemetry: never throws, never affects
 * the audit.
 *
 * @param {object} params
 * @param {object} params.site - Site model.
 * @param {Array<{week:number, year:number}>} params.previousWeeks
 * @param {object} params.context - Lambda context (env, log, dataAccess).
 * @param {string} [params.imsOrgId] - Customer IMS org id, if the caller already resolved it.
 * @returns {Promise<void>}
 */
export async function runSemrushAuthProbes({
  site, previousWeeks, context, imsOrgId: providedImsOrgId,
}) {
  const { log, env } = context;
  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE, siteId: site?.getId?.() });
  try {
    const spaceCatId = site?.getOrganizationId?.();
    const { brand } = await resolveBrandResultForSite(context, site);
    const imsOrgId = providedImsOrgId || await getImsOrgId(site, context.dataAccess || {}, log);
    const dateWindow = getDateWindowForPreviousWeeks(previousWeeks);
    if (!spaceCatId || !brand?.brandId || !imsOrgId || !dateWindow) {
      olog.warn(PROBE_EVENT, 'Auth probe skipped — missing prerequisites (org id / brand / imsOrgId / date window)', {
        peer: PEER.SEMRUSH,
        direction: 'inbound',
        hasOrgId: Boolean(spaceCatId),
        hasBrand: Boolean(brand?.brandId),
        hasImsOrgId: Boolean(imsOrgId),
        hasDateWindow: Boolean(dateWindow),
        reason: 'probe_prerequisites_missing',
        outcome: OUTCOME.SKIP,
      });
      return;
    }

    const baseUrl = env?.LLMO_API_BASE_URL || LLMO_API_DEFAULT_BASE_URL;
    const loginUrl = env?.LLMO_S2S_LOGIN_URL || `${baseUrl}${S2S_LOGIN_DEFAULT_PATH}`;
    const domainUrlsUrl = buildDomainUrlsUrl({
      baseUrl,
      spaceCatId,
      brandId: brand.brandId,
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      pageSize: PAGE_SIZE,
    });

    olog.start(PROBE_EVENT, 'Starting Semrush S2S auth probes (existing IMS client)', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, imsClientId: env?.IMS_CLIENT_ID, baseUrl,
    });

    // Probes A + B use an IMS token minted from the worker's EXISTING default IMS client (v2
    // authorization_code — the grant the default client is provisioned for). `imsClientId` is
    // logged (identifier, not a secret) to answer "which client id did we authenticate as".
    // A mint failure only skips A + B; Probe C (x-api-key) is independent and still runs.
    let imsAuthorization;
    try {
      const imsClient = ImsClient.createFrom(context);
      const token = await imsClient.getServiceAccessToken();
      if (!token?.access_token) {
        throw new Error('IMS token response missing access_token');
      }
      imsAuthorization = `Bearer ${token.access_token}`;
    } catch (error) {
      olog.warn(PROBE_EVENT, 'Auth probe could not mint an IMS token from the existing default client', {
        peer: PEER.SEMRUSH, direction: 'inbound', step: 'ims_mint', imsClientId: env?.IMS_CLIENT_ID, reason: 'ims_mint_failed', outcome: OUTCOME.DEGRADED, ...errorField(error),
      });
    }

    // Probe A, then Probe B — sequentially, so each result is clearly attributable.
    if (imsAuthorization) {
      await probeLoginExistingIms({
        olog, loginUrl, imsAuthorization, imsOrgId, domainUrlsUrl,
      });
      await probeDomainUrls({
        olog, probe: 'direct_ims', authHeaders: { Authorization: imsAuthorization }, url: domainUrlsUrl,
      });
    }

    // Probe C — the scoped api key (`SPACECAT_API_KEY`, the credential `brand-resolver.js`
    // already uses against /v2/orgs/...). Independent of IMS; needs no login. If the route
    // accepts it, this is access with zero new registration.
    const apiKey = env?.SPACECAT_API_KEY;
    if (apiKey) {
      await probeDomainUrls({
        olog, probe: 'apikey_direct', authHeaders: { 'x-api-key': apiKey }, url: domainUrlsUrl,
      });
    } else {
      olog.warn(PROBE_EVENT, 'Auth probe [apikey_direct] skipped — SPACECAT_API_KEY not configured', {
        peer: PEER.SEMRUSH, direction: 'inbound', probe: 'apikey_direct', step: 'domain_urls', reason: 'apikey_not_configured', outcome: OUTCOME.SKIP,
      });
    }
  } catch (error) {
    // A diagnostic must never affect the audit — swallow everything.
    olog.warn(PROBE_EVENT, 'Auth probe crashed (swallowed — audit unaffected)', {
      peer: PEER.SEMRUSH, direction: 'inbound', reason: 'probe_crashed', outcome: OUTCOME.DEGRADED, ...errorField(error),
    });
  }
}
