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

import { GenvarClient } from '@adobe/spacecat-shared-gpt-client';
import { isObject } from '@adobe/spacecat-shared-utils';
import { getPresignedUrl } from '../utils/getPresignedUrl.js';

const EXPIRY_IN_SECONDS = 25 * 60;

export default async function productMetatagsAutoSuggest(allTags, context, site, options = {
  forceAutoSuggest: false,
}) {
  const { s3Client, dataAccess, log } = context;
  const {
    detectedTags,
    extractedTags,
    healthyTags,
  } = allTags;
  const { forceAutoSuggest = false } = options;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  if (!forceAutoSuggest && !configuration.isHandlerEnabledForSite('product-metatags-auto-suggest', site)) {
    log.info('[PRODUCT-METATAGS] Product metatags auto-suggest is disabled for site');
    return detectedTags;
  }
  log.debug('[PRODUCT-METATAGS] Generating suggestions for Product-metatags using Genvar.');
  const tagsData = {};
  for (const endpoint of Object.keys(detectedTags)) {
    // eslint-disable-next-line no-await-in-loop
    tagsData[endpoint] = await getPresignedUrl({
      s3Client,
      bucket: process.env.S3_SCRAPER_BUCKET_NAME,
      key: extractedTags[endpoint].s3key,
      expiresIn: EXPIRY_IN_SECONDS,
      log,
    });
  }
  log.debug('[PRODUCT-METATAGS] Generated presigned URLs');
  const requestBody = {
    healthyTags,
    detectedTags: tagsData,
    site: {
      baseUrl: site.getBaseURL(),
    },
  };
  log.info('[PRODUCT-METATAGS] Sending request to Genvar client:', {
    detectedTagsCount: Object.keys(requestBody.detectedTags).length,
    detectedTagsEndpoints: Object.keys(requestBody.detectedTags),
    healthyTagsKeys: Object.keys(requestBody.healthyTags),
    siteBaseUrl: requestBody.site.baseUrl,
    requestBodyKeys: Object.keys(requestBody),
  });
  log.debug('[PRODUCT-METATAGS] Full request body to Genvar:', JSON.stringify(requestBody, null, 2));
  let responseWithSuggestions;
  try {
    const genvarClient = GenvarClient.createFrom(context);
    // Use the same metatags endpoint as regular metatags audit as a fallback
    responseWithSuggestions = await genvarClient.generateSuggestions(
      JSON.stringify(requestBody),
      context.env.GENVAR_PRODUCT_METATAGS_API_ENDPOINT || context.env.GENVAR_METATAGS_API_ENDPOINT || '/api/v1/web/aem-genai-variations-appbuilder/metatags',
    );
    if (!isObject(responseWithSuggestions)) {
      throw new Error(`Invalid response received from Genvar API: ${JSON.stringify(responseWithSuggestions)}`);
    }
  } catch (err) {
    log.error('[PRODUCT-METATAGS] Error while generating AI suggestions using Genvar for product metatags', err);
    throw err;
  }
  const updatedDetectedTags = {
    ...detectedTags,
  };
  for (const [endpoint, tags] of Object.entries(responseWithSuggestions)) {
    for (const tagName of ['title', 'description', 'h1']) {
      const tagIssueData = tags[tagName];
      if (updatedDetectedTags[endpoint]?.[tagName]
        && tagIssueData?.aiSuggestion && tagIssueData.aiRationale) {
        updatedDetectedTags[endpoint][tagName].aiSuggestion = tagIssueData.aiSuggestion;
        updatedDetectedTags[endpoint][tagName].aiRationale = tagIssueData.aiRationale;
      }
    }
  }
  log.info('[PRODUCT-METATAGS] Generated AI suggestions for Product-metatags using Genvar.');
  return updatedDetectedTags;
}
