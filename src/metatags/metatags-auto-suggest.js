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

/**
 * Poll an endpoint for a job's status.
 * @param {string} genvarEndpoint - The Genvar endpoint to poll.
 * @param {string} jobId - The job ID to send in the request.
 * @param serviceToken Auth token to call Genvar API
 * @param orgId organization id
 * @param log Logger object
 * @param {number} delay - The delay between polls in milliseconds.
 * @returns {Promise<object>} - Resolves with the result field when the job is completed.
 * @throws {Error} - Throws an error if the job fails.
 */
async function pollJobStatus(
  genvarEndpoint,
  jobId,
  serviceToken,
  orgId,
  log,
  attempt = 0,
  delay = 5000,
) {
  try {
    if (attempt > 20) {
      throw new Error('Max attempts exhausted to poll Genvar for Metatags.');
    }
    const response = await axios.post(genvarEndpoint, {
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'X-Gw-Ims-Org-Id': orgId,
      },
      params: { jobId },
    });
    const { status, result } = response.data;
    log.info(`Genvar Poll API response: ${JSON.stringify(response.data)}`);
    // Handle different statuses
    if (status === 'failed') {
      throw new Error(`Job ${jobId} failed with error ${response.data.error}`);
    } else if (status === 'completed') {
      log.info('Job completed successfully.');
      return result;
    } else if (status === 'running') {
      log.info('Job is still running, polling again...');
      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
      return await pollJobStatus(genvarEndpoint, jobId, serviceToken, orgId, log, attempt + 1);
    } else {
      throw new Error(`Unknown metatags poll job status: ${status}`);
    }
  } catch (error) {
    log.error('Error polling job status:', error.message);
    throw error;
  }
}

export default async function metatagsAutoSuggest(context, detectedTags, extractedTags, baseUrl) {
  const { s3Client, log } = context;
  const genvarEndpoint = `${context.env.GENVAR_ENDPOINT}/web/aem-genai-variations-appbuilder/metatags`;
  const orgId = context.env.FIREFALL_IMS_ORG_ID;
  if (!genvarEndpoint) {
    log.error('Metatags Auto-suggest failed: Missing Genvar endpoint');
    throw new Error('Metatags Auto-suggest failed: Missing Genvar endpoint');
  }
  const imsClient = ImsClient.createFrom(context);
  const serviceToken = (await imsClient.getServiceAccessToken()).access_token;
  const requestBody = {};
  const tagsData = {};
  let count = 0; // temporary change to limit firefall api calls
  for (const [endpoint, tags] of Object.entries(detectedTags)) {
    if (count >= 2) {
      break;
    }
    count += 1;
    // eslint-disable-next-line no-await-in-loop
    const preSignedUrl = await getPresignedUrl(s3Client, log, extractedTags[endpoint]);
    tagsData[endpoint] = {
      ...tags,
      preSignedUrl,
    };
  }
  log.info('Generated presigned URLs');
  requestBody.site = { baseUrl };
  requestBody.detectedTags = tagsData;
  const config = {
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      'X-Gw-Ims-Org-Id': orgId,
    },
  };
  const response = await axios.post(genvarEndpoint, requestBody, config);
  log.info(`Genvar API response: ${JSON.stringify(response.data)}`);
  if (response.status < 200 || response.status >= 300 || !response.data?.jobId) {
    throw new Error(`Meta-tags auto suggest call failed: ${response.status} with ${response.statusText}
     and response body: ${JSON.stringify(response.data)}`);
  }
  const responseWithSuggestions = await pollJobStatus(
    genvarEndpoint,
    response.data.jobId,
    serviceToken,
    orgId,
    log,
  );
  for (const [endpoint, tags] of Object.entries(responseWithSuggestions.data)) {
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
