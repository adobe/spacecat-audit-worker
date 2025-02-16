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

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
export default async function sendUrlsForScraping(auditUrl, auditData, context, site) {
  const { log, sqs } = context;

  log.info(`Debug log 3 ${JSON.stringify(auditData, null, 2)}`);

  // Get accumulated opportunities from previous processors
  const formOpportunities = Array.isArray(auditData.formOpportunities)
    ? auditData.formOpportunities
    : [];

  if (formOpportunities.length === 0) {
    log.info('No form opportunities to process for scraping');
  }

  if (formOpportunities.length > 0) {
    const uniqueUrls = new Set();
    formOpportunities.forEach((opptyData) => {
      if (opptyData.type === 'high-page-views-low-form-ctr') {
        uniqueUrls.add(opptyData.data.cta.url);
      } else {
        uniqueUrls.add(opptyData.data.form);
      }
    });

    log.info(`Triggering scrape for [${JSON.stringify(uniqueUrls, null, 2)}]`);
    if (uniqueUrls.size > 0) {
      await sqs.sendMessage(process.env.SCRAPING_JOBS_QUEUE_URL, {
        processingType: 'form',
        jobId: site.getId(),
        urls: uniqueUrls,
      });
    }
  }
}
