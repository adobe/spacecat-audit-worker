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
import { Audit } from '@adobe/spacecat-shared-data-access';

const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_CSP;
const scriptRegExp = /<script.*?(?:\/>|<\/script>)/gs;
const hasNonceRegExp = /<script[^>]*? nonce=/s;

async function determineSuggestionsForPage(url, context, site) {
  const { log } = context;

  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Fetching page '${url}' for CSP auto-suggest`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch page from ${url}`);
  }

  const responseBody = await response.text();

  if (!responseBody) {
    log.warn(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: no script page content found`);
    return null;
  }

  let suggestedBody = responseBody;
  const findings = [];
  const scriptTags = responseBody.matchAll(scriptRegExp);

  scriptTags.forEach((tag) => {
    const scriptContent = tag[0];

    // no suggestion if nonce is already present
    if (scriptContent.match(hasNonceRegExp)) {
      log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: script has nonce defined already: ${scriptContent}`);
      return;
    }

    // prepare finding
    const suggestedContent = scriptContent.replace(/<script/, '<script nonce="aem"');
    const lineNumber = responseBody.slice(0, tag.index).split('\n').length;

    findings.push({
      scriptContent,
      suggestedContent,
      lineNumber,
    });

    // replace in the body
    suggestedBody = suggestedBody.replace(scriptContent, suggestedContent);
  });

  if (findings.length === 0) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: no script tags without nonce found`);
    return null;
  }

  return {
    type: 'static-content',
    url: url.toString(),
    findings,
    suggestedBody,
  };
}

export async function cspAutoSuggest(auditUrl, csp, context, site) {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();

  if (!configuration.isHandlerEnabledForSite('security-csp-auto-suggest', site)) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] auto-suggest is disabled for site`);
    return csp;
  }

  // For now, auto-suggest works only for pages without any CSP
  if (csp.length !== 1 || csp[0].description !== 'No CSP found in enforcement mode') {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Complex CSP finding. Skipping CSP auto-suggest.`);
    return csp;
  }

  // Check head.html and 404.html in parallel
  const pageUrls = ['/head.html', '/404.html'];
  let autoSuggestError = false;
  const findings = [];

  // Add a finding for the CSP header - uto-suggest is only called if this is not properly set
  findings.push({
    type: 'csp-header',
  });

  const fetchPromises = pageUrls.map(async (url) => {
    try {
      const finding = await determineSuggestionsForPage(new URL(url, auditUrl), context, site);

      if (finding) {
        findings.push(finding);
      }
    } catch (error) {
      log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Error downloading page ${url}:`, error);
      autoSuggestError = true;
    }
  });

  await Promise.all(fetchPromises);

  if (autoSuggestError) {
    log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Error fetching one or more pages. Skipping CSP auto-suggest.`);
    return csp;
  }

  const result = [...csp];
  result[0].findings = findings;

  return result;
}
