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
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';

const AUDIT_TYPE = Audit.AUDIT_TYPES.SECURITY_CSP;

async function determineSuggestionsForPage(url, page, context, site) {
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
  const $ = cheerioLoad(responseBody, { sourceCodeLocationInfo: true }, false);

  const scriptTags = $('script');

  scriptTags.each((index, element) => {
    const scriptContent = responseBody
      .substring(element.sourceCodeLocation.startOffset, element.sourceCodeLocation.endOffset);

    // no suggestion if nonce is already present
    if ($(element).attr('nonce')) {
      log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: script has nonce defined already: ${scriptContent}`);
      return;
    }

    // prepare finding
    const suggestedContent = scriptContent.replace(/<script/, '<script nonce="aem"');
    const lineNumber = element.sourceCodeLocation.startLine;

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
    page,
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
  const result = [...csp];
  let missingNonce = null;

  result.some((item) => {
    if (item.description && (item.description.includes('nonces') || item.description === 'No CSP found in enforcement mode')) {
      missingNonce = item;
      return true;
    }

    return false;
  });

  if (!missingNonce) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: No nonce-related finding. Skipping CSP auto-suggest.`);
    return csp;
  }

  // Check head.html and 404.html in parallel
  const pageUrls = ['/head.html', '/404.html'];
  let autoSuggestError = false;
  const findings = [];

  const fetchPromises = pageUrls.map(async (pageUrl) => {
    try {
      const fullUrl = new URL(pageUrl, auditUrl);
      const finding = await determineSuggestionsForPage(fullUrl, pageUrl, context, site);

      if (finding) {
        findings.push(finding);
      }
    } catch (error) {
      log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Error downloading page ${pageUrl}`, error);
      autoSuggestError = true;
    }
  });

  await Promise.all(fetchPromises);

  if (autoSuggestError) {
    log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Error fetching one or more pages. Skipping CSP auto-suggest.`);
    return csp;
  }

  // Add a finding for the CSP header - auto-suggest is only called if this is not properly set
  findings.push({
    type: 'csp-header',
  });

  missingNonce.findings = findings;
  return result;
}
