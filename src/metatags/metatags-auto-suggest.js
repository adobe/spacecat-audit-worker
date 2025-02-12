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

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GenvarClient } from '@adobe/spacecat-shared-gpt-client';
import { isObject } from '@adobe/spacecat-shared-utils';

const EXPIRY_IN_DAYS = 60 * 60;

/**
 * Returns the pre-signed url for a AWS S3 object with a defined expiry.
 * This url will be consumed by Genvar API to access the scraped content.
 * Pre-signed URl format: https://{bucket}.s3.{region}.amazonaws.com/{object-path}?{query-params}
 * @param s3Client
 * @param log
 * @param scrapedData
 * @returns {Promise<string>} Presigned url
 */
async function getPresignedUrl(s3Client, log, scrapedData) {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_SCRAPER_BUCKET_NAME,
      Key: scrapedData.s3key,
    });
    return await getSignedUrl(s3Client, command, {
      expiresIn: EXPIRY_IN_DAYS,
    });
  } catch (error) {
    log.error(`Error generating presigned URL for ${scrapedData.s3key}:`, error);
    return '';
  }
}

export default async function metatagsAutoSuggest(allTags, context, site) {
  const { s3Client, dataAccess, log } = context;
  log.info('Processing Meta-tags auto-suggest');
  const {
    detectedTags,
    extractedTags,
    healthyTags,
  } = allTags;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('meta-tags-auto-suggest', site)) {
    log.info('Metatags auto-suggest is disabled for site');
    return detectedTags;
  }
  log.info('Generating suggestions for Meta-tags using Genvar.');
  const tagsData = {};
  for (const [endpoint, tags] of Object.entries(detectedTags)) {
    // eslint-disable-next-line no-await-in-loop
    const preSignedUrl = await getPresignedUrl(s3Client, log, extractedTags[endpoint]);
    tagsData[endpoint] = {
      ...tags,
      preSignedUrl,
    };
  }
  log.info('Generated presigned URLs');
  const requestBody = {
    healthyTags,
    detectedTags,
    site: {
      baseUrl: site.getBaseURL(),
    },
  };
  let responseWithSuggestions;
  try {
    const genvarClient = GenvarClient.createFrom(context);
    responseWithSuggestions = await genvarClient.generateSuggestions(
      requestBody,
      context.env.GENVAR_METATAGS_API_ENDPOINT || '/api/v1/web/aem-genai-variations-appbuilder/metatags',
    );
    if (!isObject(responseWithSuggestions)) {
      throw new Error(`Invalid response received from Genvar API: ${JSON.stringify(responseWithSuggestions)}`);
    }
  } catch (err) {
    log.error('Error while generating AI suggestions using Genvar', err);
    throw err;
  }
  const updatedDetectedTags = {
    ...detectedTags,
  };
  for (const [endpoint, tags] of Object.entries(responseWithSuggestions)) {
    for (const tagName of ['title', 'description', 'h1']) {
      const tagIssueData = tags[tagName];
      if (tagIssueData?.aiSuggestion && tagIssueData.aiRationale) {
        updatedDetectedTags[endpoint][tagName].aiSuggestion = tagIssueData.aiSuggestion;
        updatedDetectedTags[endpoint][tagName].aiRationale = tagIssueData.aiRationale;
      }
    }
  }
  log.info('Generated AI suggestions for Meta-tags using Genvar.');
  return updatedDetectedTags;
}
