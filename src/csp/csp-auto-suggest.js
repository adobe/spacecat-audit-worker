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
import { createPatch } from 'diff';

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
  const problems = [];
  let $ = cheerioLoad(responseBody, { sourceCodeLocationInfo: true }, false);

  // check for script tags without nonce
  const scriptTags = $('script');
  let hasMissingNonce = false;

  scriptTags.each((index, element) => {
    const scriptContent = responseBody
      .substring(element.sourceCodeLocation.startOffset, element.sourceCodeLocation.endOffset);

    // no suggestion if nonce is already present
    if ($(element).attr('nonce')) {
      log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: script has nonce defined already: ${scriptContent}`);
      return;
    }

    hasMissingNonce = true;

    // prepare finding + replace in body
    const suggestedContent = scriptContent.replace(/<script/, '<script nonce="aem"');
    suggestedBody = suggestedBody.replace(scriptContent, suggestedContent);
  });

  if (hasMissingNonce) {
    problems.push('csp-nonce-missing');
  }

  // check for missing metadata header
  $ = cheerioLoad(suggestedBody, { sourceCodeLocationInfo: true }, false);
  const metaTags = $('meta[http-equiv="Content-Security-Policy"]');

  const suggestedCsp = 'script-src \'nonce-aem\' \'strict-dynamic\' \'unsafe-inline\' http: https:; base-uri \'self\'; object-src \'none\';';
  if (metaTags.length === 0) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: no CSP meta tag found`);
    problems.push('csp-meta-tag-missing');

    // insert before first meta tag (if available)
    const allMetaTags = $('meta');
    let suggestedContent = `<meta http-equiv="Content-Security-Policy" content="${suggestedCsp}" move-to-http-header="true">`;

    if (allMetaTags.length > 0) {
      const firstMetaTag = allMetaTags[0];

      const start1stMeta = firstMetaTag.sourceCodeLocation.startOffset;
      const lastLineBreak = suggestedBody.lastIndexOf('\n', start1stMeta);

      for (let i = lastLineBreak; i < start1stMeta - 1; i += 1) {
        suggestedContent = ` ${suggestedContent}`;
      }

      suggestedBody = `${suggestedBody.substring(0, lastLineBreak + 1)}${suggestedContent}\n${suggestedBody.substring(lastLineBreak + 1)}`;
    } else {
      // insert before title tag
      const allTitleTags = $('title');
      if (allTitleTags.length > 0) {
        const titleTag = allTitleTags[0];

        const startTitleTag = titleTag.sourceCodeLocation.startOffset;
        const lastLineBreak = suggestedBody.lastIndexOf('\n', startTitleTag);
        suggestedContent = `  ${suggestedContent}`;
        suggestedBody = `${suggestedBody.substring(0, lastLineBreak + 1)}${suggestedContent}\n${suggestedBody.substring(lastLineBreak + 1)}`;
      } else {
        log.warn(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: no place found to insert CSP meta tag`);
      }
    }
  } else {
    const metaTag = metaTags[0];

    if (!metaTag.attribs.content.includes('nonce-aem') || !metaTag.attribs.content.includes('strict-dynamic')) {
      log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: no enforcing CSP meta tag found`);
      problems.push('csp-meta-tag-non-enforcing');

      const metaContent = suggestedBody
        .substring(metaTag.sourceCodeLocation.startOffset, metaTag.sourceCodeLocation.endOffset);
      const currentCsp = metaTag.attribs.content;
      const suggestedContent = metaContent.replace(currentCsp, suggestedCsp);
      suggestedBody = suggestedBody.replace(metaContent, suggestedContent);
    } else if (!metaTag.attribs['move-to-http-header']) {
      log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: enforcing CSP meta tag not marked to be moved to header`);

      problems.push('csp-meta-tag-move-to-header');

      const metaContent = suggestedBody
        .substring(metaTag.sourceCodeLocation.startOffset, metaTag.sourceCodeLocation.endOffset);
      const suggestedContent = metaContent.replace(/<meta/, '<meta move-to-http-header="true"');
      suggestedBody = suggestedBody.replace(metaContent, suggestedContent);
    }
  }

  if (problems.length === 0) {
    log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] [Url: ${url}]: no CSP findings found`);
    return null;
  }

  // Create partial Git patch
  const patch = createPatch(page, responseBody, suggestedBody);

  return {
    url: url.toString(),
    page,
    problems,
    patch,
  };
}

function createGitPatch(findings) {
  // create combined git patch
  let gitPatch = '';
  findings.forEach((finding) => {
    if (gitPatch.length > 0) {
      gitPatch += '\n';
    }
    gitPatch += finding.patch;

    // eslint-disable-next-line no-param-reassign
    delete finding.patch;
  });
  return gitPatch;
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
  const pageUrls = ['head.html', '404.html'];
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
      log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Error downloading page ${pageUrl}:`, error);
      autoSuggestError = true;
    }
  });

  await Promise.all(fetchPromises);

  if (autoSuggestError) {
    log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}]: Error fetching one or more pages. Skipping CSP auto-suggest.`);
    return csp;
  }

  // Create combined git patch + PR description
  const patchContent = createGitPatch(findings);

  missingNonce.findings = findings;
  if (patchContent.length > 0) {
    missingNonce.patchContent = patchContent;
    missingNonce.isCodeChangeAvailable = true;
  }

  return result;
}
