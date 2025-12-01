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
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { mapToPaidOpportunity, mapToPaidSuggestion, isLowSeverityGuidanceBody } from './guidance-opportunity-mapper.js';

function getGuidanceObj(guidance) {
  const body = guidance && guidance[0] && guidance[0].body;

  return {
    ...guidance[0],
    body,
  };
}

/**
 * Copies suggested screenshots from mystique bucket to scrapper bucket
 * @param {Object} context - The context object containing s3Client, env, and log
 * @param {string} jobId - The job ID for the temp folder path
 * @returns {Promise<void>}
 */
async function copySuggestedScreenshots(context, jobId) {
  const { s3Client, env, log } = context;

  if (!jobId) {
    log.warn('[paid-cookie-consent] No job ID provided, skipping suggested screenshots copy');
    return;
  }

  const mystiqueBucket = env.S3_MYSTIQUE_BUCKET_NAME;
  const scraperBucket = env.S3_SCRAPER_BUCKET_NAME;

  if (!mystiqueBucket || !scraperBucket) {
    log.warn('[paid-cookie-consent] Missing bucket configuration for suggested screenshots copy');
    return;
  }

  const suggestedScreenshots = [
    'mobile-suggested.png',
    'desktop-suggested.png',
  ];

  const copyPromises = suggestedScreenshots.map(async (screenshot) => {
    const sourceKey = `temp/consent-banner/${jobId}/${screenshot}`;
    const destinationKey = `temp/consent-banner/${jobId}/${screenshot}`;

    try {
      // Check if the file exists in mystique bucket
      await s3Client.send(new HeadObjectCommand({
        Bucket: mystiqueBucket,
        Key: sourceKey,
      }));

      // Copy the file to scrapper bucket
      await s3Client.send(new CopyObjectCommand({
        CopySource: `${mystiqueBucket}/${sourceKey}`,
        Bucket: scraperBucket,
        Key: destinationKey,
      }));

      log.debug(`[paid-cookie-consent] Successfully copied ${screenshot} from mystique to scrapper bucket`);
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        log.warn(`[paid-cookie-consent] Suggested screenshot ${screenshot} not found in mystique bucket, skipping`);
      } else {
        log.error(`[paid-cookie-consent] Error copying suggested screenshot ${screenshot}: ${error.message}`);
      }
    }
  });

  await Promise.all(copyPromises);
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance } = data;

  log.debug(`Message received for guidance:paid-cookie-consent handler site: ${siteId} url: ${url} message: ${JSON.stringify(message)}`);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }
  log.debug(`Fetched Audit ${JSON.stringify(message)}`);

  // Check for low severity and skip if so
  const guidanceParsed = getGuidanceObj(guidance);
  if (isLowSeverityGuidanceBody(guidanceParsed.body)) {
    log.info(`Skipping opportunity creation for site: ${siteId} page: ${url} audit: ${auditId} due to low issue severity: ${guidanceParsed}`);
    return ok();
  }

  const entity = mapToPaidOpportunity(siteId, url, audit, guidanceParsed);
  // Always create a new opportunity
  log.debug(`Creating new paid-cookie-consent opportunity for ${siteId} page: ${url}`);

  const opportunity = await Opportunity.create(entity);

  // Copy suggested screenshots from mystique bucket to scrapper bucket before creating suggestion
  const jobId = guidanceParsed?.metadata?.scrape_job_id;
  if (!jobId) {
    log.error('[paid-cookie-consent] No job ID found in guidance metadata, cannot process screenshots');
    return {
      status: 400,
      body: 'Job ID is required for paid cookie consent guidance processing',
    };
  }

  await copySuggestedScreenshots(context, jobId);

  // Create suggestion for the new opportunity first
  const suggestionData = await mapToPaidSuggestion(
    context,
    siteId,
    opportunity.getId(),
    url,
    guidanceParsed,
  );
  await Suggestion.create(suggestionData);
  log.debug(`Created suggestion for opportunity ${opportunity.getId()}`);

  // Only after suggestion is successfully created,
  // find and mark existing NEW system opportunities as IGNORED
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const existingMatches = existingOpportunities
    .filter((oppty) => oppty.getType() === 'generic-opportunity')
    .filter((oppty) => oppty.getData()?.page === url && oppty.getData().opportunityType === 'paid-cookie-consent')
    .filter((oppty) => oppty.getStatus() === 'NEW' && oppty.getUpdatedBy() === 'system')
    .filter((oppty) => oppty.getId() !== opportunity.getId()); // Exclude the newly created one

  if (existingMatches.length > 0) {
    log.debug(`Found ${existingMatches.length} existing NEW system opportunities for page ${url}. Marking them as IGNORED.`);
    await Promise.all(existingMatches.map(async (oldOppty) => {
      oldOppty.setStatus('IGNORED');
      await oldOppty.save();
      log.info(`Marked opportunity ${oldOppty.getId()} as IGNORED`);
    }));
  }

  log.debug(`paid-cookie-consent  opportunity succesfully added for site: ${siteId} page: ${url} audit: ${auditId}  opportunity: ${JSON.stringify(opportunity, null, 2)}`);

  return ok();
}
