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

import { isNonEmptyArray, isValidUrl } from '@adobe/spacecat-shared-utils';
import { Audit, AsyncJob } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopPersister } from '../common/index.js';
import { canonicalCheck } from '../canonical/handler.js';
import { metatagsAutoDetect } from '../metatags/handler.js';
import metatagsAutoSuggest from '../metatags/metatags-auto-suggest.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export function validPages(urls) {
  return (
    isNonEmptyArray(urls)
    && urls.every((page) => isValidUrl(page.url))
  );
}

export async function scrapePages(context) {
  const { site, job } = context;
  const siteId = site.getId();

  const jobMetadata = job.getMetadata();
  const { urls } = jobMetadata.payload;

  if (!validPages(urls)) {
    throw new Error(`[preflight-audit] site: ${siteId}. Invalid pages provided for scraping`);
  }

  return {
    urls,
    siteId,
    type: 'preflight',
    options: {
      enableAuthentication: true,
    },
  };
}

export const preflightAudit = async (context) => {
  const {
    site, job, log,
  } = context;

  const jobMetadata = job.getMetadata();
  const { urls } = jobMetadata.payload;

  if (!validPages(urls)) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Invalid pages provided`);
  }

  if (job.getStatus() !== AsyncJob.status.IN_PROGRESS) {
    throw new Error(`[preflight-audit] site: ${site.getId()}. Job not in progress for jobId: ${job.getId()}. Status: ${job.getStatus()}`);
  }

  const result = {
    audits: [],
  };
  // canonical audit
  result.audits.push({
    name: 'canonical',
    type: 'seo',
    opportunities: [],
  });
  for (const url of urls) {
    // eslint-disable-next-line no-await-in-loop
    const canonical = await canonicalCheck(site.getBaseURL(), url, log);
    if (canonical) {
      result.audits[0].opportunities.push({
        url,
        canonical,
      });
    }
  }
  // metatags
  result.audits.push({
    name: 'metatags',
    type: 'seo',
    opportunities: [],
  });

  const {
    seoChecks, detectedTags, extractedTags,
  } = await metatagsAutoDetect(site, urls, context);

  const allTags = {
    detectedTags,
    healthyTags: seoChecks.getFewHealthyTags(),
    extractedTags,
  };
  const updatedDetectedTags = await metatagsAutoSuggest(allTags, context, site);
  for (const url of urls) {
    const { url: pageUrl } = url;
    const tags = updatedDetectedTags[pageUrl];
    if (tags) {
      result.audits[1].opportunities.push({
        url: pageUrl,
        tags,
      });
    }
  }

  // internal-links
  result.audits.push({
    name: 'internal-links',
    type: 'seo',
    opportunities: [],
  });

  // specific for preflight
  // bad links...

  job.setStatus(AsyncJob.status.COMPLETED);
  job.setResultType(AsyncJob.ResultType.INLINE);
  job.setResult(result);
  job.setEndedAt(new Date().toISOString());
  await job.save();

  log.info(`[preflight-audit] site: ${site.getId()}. Preflight audit completed for jobId: ${job.getId()}`);
  log.info(JSON.stringify(result));
};

export default new AuditBuilder()
  .withPersister(noopPersister)
  .addStep('scrape-pages', scrapePages, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('preflight-audit', preflightAudit)
  .withAsyncJob()
  .build();
