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
import { hasText, isObject } from '@adobe/spacecat-shared-utils';
import BrandClient from '@adobe/spacecat-shared-brand-client';
import { Organization } from '@adobe/spacecat-shared-data-access';

const EXPIRY_IN_SECONDS = 25 * 60;

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
      expiresIn: EXPIRY_IN_SECONDS,
    });
  } catch (error) {
    log.error(`Error generating presigned URL for ${scrapedData.s3key}:`, error);
    return '';
  }
}

/**
 * Gets IMS config from the environment.
 * @returns {object} imsConfig - The IMS config.
 */
function getImsConfig(env, log) {
  const {
    BRAND_IMS_HOST: host,
    BRAND_IMS_CLIENT_ID: clientId,
    BRAND_IMS_CLIENT_CODE: clientCode,
    BRAND_IMS_CLIENT_SECRET: clientSecret,
  } = env;
  if (!hasText(host) || !hasText(clientId) || !hasText(clientCode) || !hasText(clientSecret)) {
    log.error('IMS Config not found in the environment');
  }
  return {
    host,
    clientId,
    clientCode,
    clientSecret,
  };
}

export default async function metatagsAutoSuggest(allTags, context, site, options = {
  forceAutoSuggest: false,
}) {
  const { s3Client, dataAccess, log } = context;
  const {
    detectedTags = {},
    extractedTags = {},
    healthyTags = {},
  } = allTags || {};
  const { forceAutoSuggest = false } = options;
  const { Configuration } = dataAccess;

  // Check if handler is enabled for site
  const configuration = await Configuration.findLatest();
  if (!configuration || (!forceAutoSuggest && !configuration.isHandlerEnabledForSite('meta-tags-auto-suggest', site))) {
    log.info('Metatags auto-suggest is disabled for site');
    return detectedTags;
  }

  // Validate required environment variables
  if (!context.env.GENVAR_HOST || !context.env.GENVAR_IMS_ORG_ID) {
    throw new Error('Metatags Auto-suggest failed: Missing Genvar endpoint or genvar ims orgId');
  }

  log.debug('Generating suggestions for Meta-tags using Genvar.');
  const tagsData = {};
  const endpoints = Object.keys(detectedTags);
  const presignedUrls = await Promise.all(
    endpoints.map(async (endpoint) => {
      const extractedTag = extractedTags[endpoint];
      if (extractedTag?.s3key) {
        try {
          return { endpoint, url: await getPresignedUrl(s3Client, log, extractedTag) };
        } catch (error) {
          log.error(`Error generating presigned URL for ${extractedTag.s3key}:`, error);
          return { endpoint, url: '' };
        }
      }
      return { endpoint, url: '' };
    }),
  );

  // Map results back to tagsData
  presignedUrls.forEach(({ endpoint, url }) => {
    tagsData[endpoint] = url;
  });

  log.debug('Generated presigned URLs');
  const requestBody = {
    healthyTags,
    detectedTags: tagsData,
    site: {
      baseUrl: site.getBaseURL(),
    },
  };

  let responseWithSuggestions;
  try {
    const imsConfig = getImsConfig(context.env, log);
    log.info(`IMS Config: ${JSON.stringify(imsConfig)}`);

    // Get brand guidelines if available
    const siteConfig = site.getConfig();
    if (siteConfig) {
      const brandConfig = siteConfig.getBrandConfig();
      if (brandConfig?.brandId) {
        const { brandId } = brandConfig;
        log.info(`Brand ID mapping for site: ${site.getId()} is ${brandId}`);
        const organizationId = site.getOrganizationId();
        if (organizationId) {
          const organization = await Organization.findById(organizationId);
          if (organization) {
            const imsOrgId = organization.getImsOrgId();
            if (imsOrgId) {
              log.info(`IMS Org ID for site: ${site.getId()} is ${imsOrgId}`);
              const brandClient = BrandClient.createFrom(context);
              const brandGuidelines = await brandClient.getBrandGuidelines(
                brandId,
                imsOrgId,
                imsConfig,
              );
              if (brandGuidelines) {
                log.info(`Found brand guidelines for site: ${site.getId()}`);
                log.info(`Brand Guidelines: ${JSON.stringify(brandGuidelines)}`);
              }
            }
          }
        }
      }
    }

    const genvarClient = GenvarClient.createFrom(context);
    const apiEndpoint = context.env.GENVAR_METATAGS_API_ENDPOINT
      || '/api/v1/web/aem-genai-variations-appbuilder/metatags';
    responseWithSuggestions = await genvarClient.generateSuggestions(
      JSON.stringify(requestBody),
      apiEndpoint,
    );

    if (!isObject(responseWithSuggestions)) {
      throw new Error(
        `Invalid response received from Genvar API: ${JSON.stringify(responseWithSuggestions)}`,
      );
    }
  } catch (err) {
    log.error('Error while generating AI suggestions using Genvar', err);
    throw err;
  }

  const updatedDetectedTags = { ...detectedTags };
  for (const [endpoint, tags] of Object.entries(responseWithSuggestions)) {
    if (updatedDetectedTags[endpoint]) {
      for (const tagName of ['title', 'description', 'h1']) {
        const { aiSuggestion, aiRationale } = tags[tagName] || {};
        if (updatedDetectedTags[endpoint][tagName] && aiSuggestion && aiRationale) {
          updatedDetectedTags[endpoint][tagName].aiSuggestion = aiSuggestion;
          updatedDetectedTags[endpoint][tagName].aiRationale = aiRationale;
        }
      }
    }
  }

  log.info('Generated AI suggestions for Meta-tags using Genvar.');
  return updatedDetectedTags;
}
