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

import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';

const EXPIRY_IN_DAYS = 7 * 24 * 60 * 60;

async function getPresignedUrl(s3Client, log, scrapedData, key) {
  try {
    log.info(`Generating presigned URL for ${key}`);
    const command = new GetObjectCommand({
      Bucket: process.env.S3_SCRAPER_BUCKET_NAME,
      Key: key,
    });
    return await getSignedUrl(s3Client, command, {
      expiresIn: EXPIRY_IN_DAYS,
    });
  } catch (error) {
    log.error(`Error generating presigned URL for ${key}:`, error);
    return '';
  }
}

export default async function metatagsAutoSuggest(context, detectedTags, extractedTags, baseUrl) {
  const { s3Client, log } = context;
  const genvarEndpoint = context.env.GENVAR_ENDPOINT;
  if (!genvarEndpoint) {
    log.error('Metatags Auto-suggest failed: Missing Genvar endpoint');
    throw new Error('Metatags Auto-suggest failed: Missing Genvar endpoint');
  }
  const imsClient = ImsClient.createFrom(context);
  const serviceToken = (await imsClient.getServiceAccessToken()).access_token;
  const requestBody = {};
  const tagsData = {};
  for (const [endpoint, tags] of Object.entries(detectedTags)) {
    // eslint-disable-next-line no-await-in-loop
    const preSignedUrl = await getPresignedUrl(s3Client, log, extractedTags[endpoint]);
    tagsData[endpoint] = {
      ...tags,
      preSignedUrl,
    };
  }
  requestBody.baseUrl = baseUrl;
  const response = await axios.get(genvarEndpoint, {
    Authorization: `Bearer ${serviceToken}`,
    'X-Gw-Ims-Org-Id': '908936ED5D35CC220A495CD4@AdobeOrg',
  });
  // Check for HTTP status errors
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Meta-tags auto suggest failed with HTTP Error: ${response.status} - ${response.statusText}`);
  }
  for (const [endpoint, tags] of Object.entries(response.data)) {
    ['title', 'description', 'h1'].forEach((tagName) => {
      const tagIssueData = tags[tagName];
      if (tagIssueData?.aiSuggestion && tagIssueData.aiRationale) {
        // eslint-disable-next-line no-param-reassign
        detectedTags[endpoint][tagName].aiSuggestion = tagIssueData.aiSuggestion;
        // eslint-disable-next-line no-param-reassign
        detectedTags[endpoint][tagName].aiRationale = tagIssueData.aiRationale;
      } else {
        log.warn(`AI suggestion or rationale not found for ${endpoint}`);
      }
    });
  }
}
