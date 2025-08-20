/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  composeAuditURL,
  isArray,
  prependSchema,
} from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import {
  ERROR_CODES,
  filterValidUrls,
  getSitemapUrls,
} from './common.js';
import { getUrlWithoutPath } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const auditType = Audit.AUDIT_TYPES.SITEMAP;

const TRACKED_STATUS_CODES = Object.freeze([301, 302, 404]);

/**
 * Main sitemap discovery and validation function
 */
export async function findSitemap(inputUrl) {
  // Extract and validate pages from sitemaps
  const siteMapUrlsResult = await getSitemapUrls(inputUrl);
  if (!siteMapUrlsResult.success) return siteMapUrlsResult;
  const extractedPaths = siteMapUrlsResult.details?.extractedPaths || {};
  const filteredSitemapUrls = siteMapUrlsResult.details?.filteredSitemapUrls || [];
  const notOkPagesFromSitemap = {};

  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    for (const sitemapUrl of Object.keys(extractedPaths)) {
      const urlsToCheck = extractedPaths[sitemapUrl];

      if (urlsToCheck?.length) {
        // eslint-disable-next-line no-await-in-loop
        const existingPages = await filterValidUrls(urlsToCheck);

        // Collect issues for tracked status codes only
        if (existingPages.notOk?.length > 0) {
          const trackedIssues = existingPages.notOk
            .filter((issue) => TRACKED_STATUS_CODES.includes(issue.statusCode));
          if (trackedIssues.length > 0) {
            notOkPagesFromSitemap[sitemapUrl] = trackedIssues;
          }
        }

        // Keep sitemap if it has valid URLs or acceptable redirects
        const hasValidUrls = existingPages.ok.length > 0
          || existingPages.notOk.some((issue) => [301, 302].includes(issue.statusCode));

        if (!hasValidUrls) {
          delete extractedPaths[sitemapUrl];
        } else {
          extractedPaths[sitemapUrl] = existingPages.ok;
        }
      }
    }
  }

  // Return final result
  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    return {
      success: true,
      reasons: [{ value: 'Sitemaps found and checked.' }],
      url: inputUrl,
      details: { issues: notOkPagesFromSitemap },
    };
  }

  return {
    success: false,
    reasons: [{
      value: filteredSitemapUrls[0],
      error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
    }],
    url: inputUrl,
    details: { issues: notOkPagesFromSitemap },
  };
}

/**
 * Main audit runner function
 */
export async function sitemapAuditRunner(baseURL, context) {
  const { log } = context;
  const startTime = process.hrtime();

  log.info(`Starting sitemap audit for ${baseURL}`);

  const auditResult = await findSitemap(baseURL);

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Sitemap audit for ${baseURL} completed in ${formattedElapsed} seconds`);

  return {
    fullAuditRef: baseURL,
    auditResult,
    url: baseURL,
  };
}

export function getSitemapsWithIssues(auditData) {
  return Object.keys(auditData?.auditResult?.details?.issues ?? {});
}

/**
 * Extracts pages with issues for suggestion generation
 */
export function getPagesWithIssues(auditData) {
  const sitemapsWithPagesWithIssues = getSitemapsWithIssues(auditData);

  return sitemapsWithPagesWithIssues.flatMap((sitemapUrl) => {
    const issues = auditData.auditResult.details.issues[sitemapUrl];

    if (!isArray(issues)) {
      return [];
    }

    return issues.map((page) => ({
      type: 'url',
      sitemapUrl,
      pageUrl: page.url,
      statusCode: page.statusCode ?? 0,
      ...(page.urlsSuggested && { urlsSuggested: page.urlsSuggested }),
    }));
  });
}

/**
 * Generates suggestions based on audit results
 */
export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const { success, reasons } = auditData.auditResult;

  const response = success
    ? []
    : reasons.map(({ error }) => ({ type: 'error', error }));

  const pagesWithIssues = getPagesWithIssues(auditData);
  const suggestions = [...response, ...pagesWithIssues]
    .filter(Boolean)
    .map((issue) => ({
      ...issue,
      recommendedAction: issue.urlsSuggested
        ? `use this url instead: ${issue.urlsSuggested}`
        : 'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
    }));

  log.info(`Generated ${suggestions.length} suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  if (auditData.auditResult.success === false) {
    log.info('Sitemap audit failed, skipping opportunity and suggestions creation');
    return { ...auditData };
  }

  if (!auditData.suggestions?.length) {
    log.info('No sitemap issues found, skipping opportunity creation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (data) => (data.type === 'url' ? `${data.sitemapUrl}|${data.pageUrl}` : data.error);

  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    context,
    buildKey,
    mapNewSuggestion: (issue) => ({
      opportunityId: opportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: 0,
      data: issue,
    }),
    log,
  });

  return { ...auditData };
}

export default new AuditBuilder()
  .withRunner(sitemapAuditRunner)
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => getUrlWithoutPath(prependSchema(url))))
  .withPostProcessors([generateSuggestions, opportunityAndSuggestions])
  .build();
