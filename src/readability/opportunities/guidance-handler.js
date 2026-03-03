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

import { createHash } from 'crypto';
import {
  ok, notFound, badRequest, noContent, internalServerError,
} from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { syncSuggestions } from '../../utils/data-access.js';

/**
 * Enriches suggestion data with fields required for auto-optimize.
 */
function enrichSuggestionDataForAutoOptimize(data) {
  return {
    ...data,
    url: data.pageUrl,
    scrapedAt: data.scrapedAt ? new Date(data.scrapedAt).toISOString() : undefined,
    transformRules: {
      value: data.improvedText,
      op: 'replace',
      selector: data.selector,
      target: 'ai-bots',
      prerenderRequired: true,
    },
  };
}

/**
 * Downloads and parses the batch results JSON from S3.
 */
async function fetchBatchResults(s3Client, bucketName, s3ResultsPath, log) {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: s3ResultsPath,
  }));
  const body = await response.Body.transformToString();
  const results = JSON.parse(body);
  log.info(`[readability-opportunity guidance]: Fetched batch results from S3: ${s3ResultsPath} (type: ${Array.isArray(results) ? 'array' : typeof results}, count: ${Array.isArray(results) ? results.length : 'N/A'})`);
  return results;
}

/**
 * Deletes the response file from S3 after consuming it.
 */
async function deleteResponseFile(s3Client, bucketName, s3ResultsPath, log) {
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: s3ResultsPath,
    }));
    log.info(`[readability-opportunity guidance]: Deleted S3 response file: ${s3ResultsPath}`);
  } catch (error) {
    log.warn(`[readability-opportunity guidance]: Failed to delete S3 response file ${s3ResultsPath}: ${error.message}`);
  }
}

/**
 * Maps a single Mystique batch result item to the internal suggestion data format.
 * Batch result `data` dict uses snake_case field names from Mystique.
 * Returns null for failed items or items with empty improved text.
 */
function mapBatchResultToSuggestionData(item) {
  if (item.status !== 'success' || !item.data) {
    return null;
  }
  const { data } = item;
  if (!data.improved_paragraph || data.improved_paragraph.trim() === '') {
    return null;
  }
  return {
    pageUrl: data.page_url,
    selector: item.selector,
    originalText: data.original_paragraph,
    improvedText: data.improved_paragraph,
    originalFleschScore: data.current_flesch_score,
    improvedFleschScore: data.improved_flesch_score,
    readabilityImprovement: data.improved_flesch_score - data.current_flesch_score,
    seoRecommendation: data.seo_recommendation,
    aiRationale: data.ai_rationale,
    suggestionStatus: 'completed',
  };
}

export default async function handler(message, context) {
  const { log, dataAccess, s3Client } = context;
  const {
    Site, Opportunity,
  } = dataAccess;
  const {
    auditId, siteId, data,
  } = message;

  log.info(`[readability-opportunity guidance]: Received Mystique guidance for readability opportunities: ${JSON.stringify(message, null, 2)}`);

  log.info(`[readability-opportunity guidance]: Processing guidance for auditId: ${auditId}, siteId: ${siteId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[readability-opportunity guidance]: Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await dataAccess.Audit.findById(auditId);
  if (!audit) {
    log.error(`[readability-opportunity guidance]: Audit not found for auditId: ${auditId}`);
    return notFound('Audit not found');
  }
  log.info(`[readability-opportunity guidance]: Found audit with type: ${audit.getAuditType()}`);

  // Find the readability opportunity for this site
  const opportunities = await Opportunity.allBySiteId(siteId);
  const readabilityOpportunity = opportunities.find(
    (opp) => opp.getAuditId() === auditId,
  );

  if (!readabilityOpportunity) {
    log.error(
      `[readability-opportunity guidance]: No readability opportunity found for siteId: ${siteId}, auditId: ${auditId}`,
    );
    return notFound('Readability opportunity not found');
  }

  // New batch flow: read results from S3
  const { s3ResultsPath } = data || {};
  if (!s3ResultsPath) {
    log.warn('[readability-opportunity guidance]: No s3ResultsPath in message data');
    return badRequest('Missing s3ResultsPath in message data');
  }

  const bucketName = context.env.S3_MYSTIQUE_BUCKET_NAME;
  if (!bucketName) {
    log.error('[readability-opportunity guidance]: Missing S3_MYSTIQUE_BUCKET_NAME');
    return internalServerError('Missing S3_MYSTIQUE_BUCKET_NAME');
  }

  let batchResults;
  try {
    batchResults = await fetchBatchResults(s3Client, bucketName, s3ResultsPath, log);
  } catch (error) {
    log.error(`[readability-opportunity guidance]: Failed to fetch batch results from S3: ${error.message}`);
    return notFound('Failed to fetch batch results from S3');
  }

  if (!Array.isArray(batchResults)) {
    log.error(`[readability-opportunity guidance]: Expected batch results to be an array but got ${typeof batchResults}`);
    return badRequest('Invalid batch results format');
  }

  // Map batch results to suggestion data, filtering out failed items and empty improvements
  const mappedSuggestions = batchResults
    .map((item) => mapBatchResultToSuggestionData(item))
    .filter(Boolean);

  const failedCount = batchResults.filter((item) => item.status === 'failed').length;
  if (failedCount > 0) {
    log.warn(`[readability-opportunity guidance]: ${failedCount} items failed in batch results`);
  }

  if (mappedSuggestions.length === 0) {
    log.info('[readability-opportunity guidance]: No valid suggestions to process');
    return noContent();
  }

  log.info(`[readability-opportunity guidance]: Processing ${mappedSuggestions.length} suggestions from batch results`);

  const buildKey = (suggestionData) => {
    const textHash = createHash('sha256').update(suggestionData.originalText || '').digest('hex').slice(0, 12);
    return `${suggestionData.pageUrl}|${textHash}`;
  };

  await syncSuggestions({
    context,
    opportunity: readabilityOpportunity,
    newData: mappedSuggestions,
    buildKey,
    mapNewSuggestion: (suggestionData) => {
      const enrichedData = enrichSuggestionDataForAutoOptimize({
        ...suggestionData,
        mystiqueProcessingCompleted: new Date().toISOString(),
      });
      return {
        opportunityId: readabilityOpportunity.getId(),
        type: SuggestionModel.TYPES.CONTENT_UPDATE,
        rank: 10,
        data: enrichedData,
      };
    },
    mergeDataFunction: (existingData, newData) => {
      const merged = {
        ...existingData,
        improvedText: newData.improvedText,
        improvedFleschScore: newData.improvedFleschScore,
        readabilityImprovement: newData.readabilityImprovement,
        aiSuggestion: newData.seoRecommendation,
        aiRationale: newData.aiRationale,
        suggestionStatus: 'completed',
        mystiqueProcessingCompleted: new Date().toISOString(),
      };
      return enrichSuggestionDataForAutoOptimize(merged);
    },
  });

  // Delete the S3 response file only after syncSuggestions succeeds
  await deleteResponseFile(s3Client, bucketName, s3ResultsPath, log);

  log.info(`[readability-opportunity guidance]: Successfully processed readability suggestions with AI improvements for siteId: ${siteId}`);

  return ok();
}
