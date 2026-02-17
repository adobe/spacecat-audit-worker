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
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Enriches suggestion data with fields required for auto-optimize.
 */
function enrichSuggestionDataForAutoOptimize(data) {
  return {
    ...data,
    url: data.pageUrl,
    scrapedAt: new Date(data.scrapedAt).toISOString(),
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
  log.info(`[readability-opportunity guidance]: Fetched ${results.length} results from S3: ${s3ResultsPath}`);
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
 * Maps a single Mystique batch result item to the internal suggestion format.
 * Batch results use camelCase field names.
 */
function mapBatchResultToSuggestion(item, index) {
  if (item.status !== 'success' || !item.data) {
    return null;
  }
  const { data } = item;
  return {
    id: `readability-opportunity-${data.pageUrl || 'unknown'}-${index}`,
    pageUrl: data.pageUrl,
    originalText: data.originalParagraph,
    improvedText: data.improvedParagraph,
    selector: item.selector,
    originalFleschScore: data.currentFleschScore,
    improvedFleschScore: data.improvedFleschScore,
    seoRecommendation: data.seoRecommendation,
    aiRationale: data.aiRationale,
    type: 'READABILITY_IMPROVEMENT',
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
    log.warn('[readability-opportunity guidance]: No s3ResultsPath in message data, nothing to process');
    return ok();
  }

  const bucketName = context.env.S3_IMPORTER_BUCKET_NAME;
  if (!bucketName) {
    log.error('[readability-opportunity guidance]: Missing S3_IMPORTER_BUCKET_NAME');
    return ok();
  }

  let batchResults;
  try {
    batchResults = await fetchBatchResults(s3Client, bucketName, s3ResultsPath, log);
  } catch (error) {
    log.error(`[readability-opportunity guidance]: Failed to fetch batch results from S3: ${error.message}`);
    return ok();
  }

  // Delete the S3 response file after reading
  await deleteResponseFile(s3Client, bucketName, s3ResultsPath, log);

  // Map batch results to suggestions, filtering out failed items
  const mappedSuggestions = batchResults
    .map((item, index) => mapBatchResultToSuggestion(item, index))
    .filter(Boolean);

  const failedCount = batchResults.filter((item) => item.status === 'failed').length;
  if (failedCount > 0) {
    log.warn(`[readability-opportunity guidance]: ${failedCount} items failed in batch results`);
  }

  if (mappedSuggestions.length === 0) {
    log.info('[readability-opportunity guidance]: No valid suggestions to process');
    return ok();
  }

  log.info(`[readability-opportunity guidance]: Processing ${mappedSuggestions.length} suggestions from batch results`);

  // Update existing suggestions with AI improvements
  const existingSuggestions = await readabilityOpportunity.getSuggestions();

  const updateOperations = mappedSuggestions.map((mystiquesuggestion) => {
    // Match by selector first, fall back to text preview
    const matchingSuggestion = existingSuggestions.find(
      (existing) => {
        const existingData = existing.getData();
        if (mystiquesuggestion.selector && existingData?.selector === mystiquesuggestion.selector) {
          return true;
        }
        const mystiqueTextTruncated = mystiquesuggestion.originalText?.substring(0, 500);
        return existingData?.textPreview === mystiqueTextTruncated;
      },
    );

    if (matchingSuggestion) {
      return async () => {
        try {
          if (!mystiquesuggestion.improvedText || mystiquesuggestion.improvedText.trim() === '') {
            await matchingSuggestion.remove();
            log.warn(`[readability-opportunity guidance]: Removed suggestion ${matchingSuggestion.getId()} because Mystique 'improvedText' is empty`);
            return true;
          }

          const currentData = matchingSuggestion.getData();
          const updatedData = {
            ...currentData,
            improvedText: mystiquesuggestion.improvedText,
            improvedFleschScore: mystiquesuggestion.improvedFleschScore,
            readabilityImprovement: mystiquesuggestion.improvedFleschScore
              - mystiquesuggestion.originalFleschScore,
            aiSuggestion: mystiquesuggestion.seoRecommendation,
            aiRationale: mystiquesuggestion.aiRationale,
            suggestionStatus: 'completed',
            mystiqueProcessingCompleted: new Date().toISOString(),
          };

          const enrichedData = enrichSuggestionDataForAutoOptimize(updatedData);

          await matchingSuggestion.setData(enrichedData);
          await matchingSuggestion.save();

          log.info(`[readability-opportunity guidance]: Updated suggestion ${matchingSuggestion.getId()} with AI improvements`);
          return true;
        } catch (error) {
          log.error(`[readability-opportunity guidance]: Error updating suggestion ${matchingSuggestion.getId()}: ${error.message}`);
          return false;
        }
      };
    }

    log.warn(`[readability-opportunity guidance]: No matching suggestion found for text: ${mystiquesuggestion.originalText?.substring(0, 100)}...`);
    return null;
  }).filter(Boolean);

  const updateResults = await Promise.all(updateOperations.map((op) => op()));
  const updatedCount = updateResults.filter(Boolean).length;

  log.info(`[readability-opportunity guidance]: Successfully updated ${updatedCount} readability suggestions with AI improvements for siteId: ${siteId}`);

  return ok();
}
