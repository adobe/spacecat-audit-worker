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

import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import SeoChecks from './seo-checks.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getIssueRanking, removeTrailingSlash, syncMetatagsSuggestions } from './opportunityHandler.js';
import { DESCRIPTION, H1, TITLE } from './constants.js';
import { opportunityData } from './opportunityDataMapper.js';

const AUDIT_TYPE = 'meta-tags';

export async function fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.scrapeResult?.tags || typeof object.scrapeResult.tags !== 'object') {
    log.error(`No Scraped tags found in S3 ${key} object`);
    return null;
  }
  const pageUrl = key.slice(prefix.length - 1).replace('/scrape.json', ''); // Remove the prefix and scrape.json suffix
  return {
    [pageUrl]: {
      title: object.scrapeResult.tags.title,
      description: object.scrapeResult.tags.description,
      h1: object.scrapeResult.tags.h1 || [],
    },
  };
}

export async function auditMetaTagsRunner(baseURL, context, site) {
  const { log, s3Client } = context;
  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;
  const scrapedObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log);
  const extractedTags = {};
  const pageMetadataResults = await Promise.all(scrapedObjectKeys.map(
    (key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log),
  ));
  pageMetadataResults.forEach((pageMetadata) => {
    if (pageMetadata) {
      Object.assign(extractedTags, pageMetadata);
    }
  });
  const extractedTagsCount = Object.entries(extractedTags).length;
  if (extractedTagsCount === 0) {
    log.error(`Failed to extract tags from scraped content for bucket ${bucketName} and prefix ${prefix}`);
  }
  log.info(`Performing SEO checks for ${extractedTagsCount} tags`);
  // Perform SEO checks
  const seoChecks = new SeoChecks(log);
  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    seoChecks.performChecks(pageUrl || '/', pageTags);
  }
  seoChecks.finalChecks();
  const detectedTags = seoChecks.getDetectedTags();

  const auditResult = {
    detectedTags,
    sourceS3Folder: `${bucketName}/${prefix}`,
    fullAuditRef: 'na',
    finalUrl: baseURL,
  };

  return {
    auditResult,
    fullAuditRef: baseURL,
  };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    opportunityData,
    AUDIT_TYPE,
  );
  const { log } = context;
  const { detectedTags } = auditData.auditResult;
  const suggestions = [];
  // Generate suggestions data to be inserted in meta-tags opportunity suggestions
  Object.keys(detectedTags)
    .forEach((endpoint) => {
      [TITLE, DESCRIPTION, H1].forEach((tag) => {
        if (detectedTags[endpoint]?.[tag]?.issue) {
          suggestions.push({
            ...detectedTags[endpoint][tag],
            tagName: tag,
            url: removeTrailingSlash(auditData.auditResult.finalUrl) + endpoint,
            rank: getIssueRanking(tag, detectedTags[endpoint][tag].issue),
          });
        }
      });
    });

  const buildKey = (data) => `${data.url}|${data.issue}|${data.tagContent}`;

  // Sync the suggestions from new audit with old ones
  await syncMetatagsSuggestions({
    opportunity,
    newData: suggestions,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: 'METADATA_UPDATE',
      rank: suggestion.rank,
      data: { ...suggestion },
    }),
    log,
  });
  log.info(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and meta-tags audit type.`);
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditMetaTagsRunner)
  .withPostProcessors([opportunityAndSuggestions])
  .build();
