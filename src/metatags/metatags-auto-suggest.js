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
import { TAG_LENGTHS } from './constants.js';

const EXPIRY_IN_SECONDS = 25 * 60;
const TAG_NAMES = ['title', 'description', 'h1'];

/**
 * Returns true when an AI suggestion's length falls in the range that clears the metatags
 * length audit (no issue emitted). Mirrors seo-checks.checkForTagsLength, which only treats a
 * tag as healthy when idealMinLength <= length <= idealMaxLength. A tag without an
 * idealMinLength (h1) has no lower bound beyond being non-empty. Shipping a suggestion outside
 * this range makes the next audit run re-flag it (SITES-42023).
 * @param {string} tagName - title, description or h1.
 * @param {string} suggestion - The AI-generated suggestion text.
 * @returns {boolean} Whether the suggestion length would clear the audit.
 */
export function isSuggestionLengthValid(tagName, suggestion) {
  const limits = TAG_LENGTHS[tagName];
  /* c8 ignore next - defensive: only known tag names (title/description/h1) reach here */
  if (!limits) return true;
  const length = suggestion?.length ?? 0;
  const min = limits.idealMinLength ?? 1;
  const max = limits.idealMaxLength;
  return length >= min && length <= max;
}

/**
 * Calls Genvar once and validates the response shape.
 * @throws when the response is not an object.
 */
async function generateGenvarSuggestions(context, requestBody) {
  const genvarClient = GenvarClient.createFrom(context);
  const response = await genvarClient.generateSuggestions(
    JSON.stringify(requestBody),
    context.env.GENVAR_METATAGS_API_ENDPOINT || '/api/v1/web/aem-genai-variations-appbuilder/metatags',
  );
  if (!isObject(response)) {
    throw new Error(`Invalid response received from Genvar API: ${JSON.stringify(response)}`);
  }
  return response;
}

export default async function metatagsAutoSuggest(allTags, context, site, options = {
  forceAutoSuggest: false,
}) {
  const { s3Client, log } = context;
  const {
    detectedTags,
    extractedTags,
    healthyTags,
  } = allTags;
  const { forceAutoSuggest = false } = options;
  if (!forceAutoSuggest) {
    log.info('Metatags auto-suggest is disabled for site');
    return detectedTags;
  }
  log.debug('Generating suggestions for Meta-tags using Genvar.');
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
    responseWithSuggestions = await generateGenvarSuggestions(context, requestBody);
  } catch (err) {
    log.error('Error while generating AI suggestions using Genvar', err);
    throw err;
  }

  const updatedDetectedTags = {
    ...detectedTags,
  };
  for (const [endpoint, tags] of Object.entries(responseWithSuggestions)) {
    for (const tagName of TAG_NAMES) {
      const tagIssueData = tags[tagName];
      if (updatedDetectedTags[endpoint]?.[tagName]
        && tagIssueData?.aiSuggestion && tagIssueData.aiRationale) {
        // Genvar runs at temperature 0, so re-requesting returns the same text — retrying here
        // cannot help. When a suggestion is outside the audit's ideal length range we surface it
        // for Splunk visibility but still ship the best-effort suggestion. The durable fix is the
        // Genvar service's own regenerate-with-feedback loop (SITES-42023).
        if (!isSuggestionLengthValid(tagName, tagIssueData.aiSuggestion)) {
          log.warn(`Genvar meta-tag suggestion for ${tagName} on ${endpoint} is outside the recommended length range (${tagIssueData.aiSuggestion.length} chars); shipping best-effort suggestion. See SITES-42023.`);
        }
        updatedDetectedTags[endpoint][tagName].aiSuggestion = tagIssueData.aiSuggestion;
        updatedDetectedTags[endpoint][tagName].aiRationale = tagIssueData.aiRationale;
      }
    }
  }
  // Remove entries from updatedDetectedTags which don't have aiSuggestion for any of the tags
  // For duplicate tags, if any one instance lacks AI suggestion, remove all instances
  // to maintain consistency (can't have a "duplicate" with just one page)
  const tagsToRemove = {};

  for (const endpoint of Object.keys(updatedDetectedTags)) {
    const tags = updatedDetectedTags[endpoint];
    for (const tagName of ['title', 'description', 'h1']) {
      if (tags[tagName] && !tags[tagName].aiSuggestion) {
        const isDuplicate = tags[tagName].issue?.includes('Duplicate');
        const { tagContent } = tags[tagName];

        if (isDuplicate && tagContent) {
          // Track duplicates by their content so we can remove all instances
          tagsToRemove[tagName] ??= new Set();
          tagsToRemove[tagName].add(tagContent);
        } else {
          // Non-duplicate tags can be removed individually
          log.info(`Removing ${tagName} tag from ${endpoint} as it doesn't have aiSuggestion.`);
          delete updatedDetectedTags[endpoint][tagName];
        }
      }
    }
  }

  // Remove all instances of duplicate tags that lack AI suggestions
  for (const tagName of ['title', 'description', 'h1']) {
    if (tagsToRemove[tagName]) {
      for (const endpoint of Object.keys(updatedDetectedTags)) {
        const tags = updatedDetectedTags[endpoint];
        if (tags[tagName] && tagsToRemove[tagName].has(tags[tagName].tagContent)) {
          log.debug(`Removing ${tagName} tag from ${endpoint} (duplicate group without complete AI suggestions).`);
          delete updatedDetectedTags[endpoint][tagName];
        }
      }
    }
  }

  log.debug('Generated AI suggestions for Meta-tags using Genvar.');
  return updatedDetectedTags;
}
