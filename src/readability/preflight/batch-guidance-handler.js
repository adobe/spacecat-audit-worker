/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  ok, notFound, badRequest, internalServerError,
} from '@adobe/spacecat-shared-http-utils';
import { AsyncJob } from '@adobe/spacecat-shared-data-access';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Preflight batch guidance handler.
 *
 * Consumes a single batched Mystique readability response (one SQS message carrying
 * `data.s3ResultsPath`) and applies all suggestions to the preflight AsyncJob in one shot,
 * then marks the job COMPLETED. This replaces the legacy per-paragraph flow where the job
 * only completed once N inline callbacks had each been counted — the failure mode where one
 * slow paragraph hung the whole run (SITES-49801).
 *
 * Routing to this handler is decided by the unified guidance handler: a batched response
 * (`s3ResultsPath`) whose `auditId` resolves to an AsyncJob is a preflight batch.
 */

/**
 * Maps one Mystique batch-result item to the internal preflight suggestion shape.
 * Returns null for failed items or empty improvements (non-excluded), so callers can tell
 * "no suggestion" from "excluded".
 */
function mapResultItemToSuggestion(item) {
  if (item.status !== 'success' || !item.data) {
    return null;
  }
  const { data } = item;
  if (data.should_exclude) {
    if (!data.original_paragraph || String(data.original_paragraph).trim() === '') {
      return null;
    }
    return {
      pageUrl: data.page_url,
      selector: item.selector,
      originalText: data.original_paragraph,
      shouldExclude: true,
      exclusionReason: data.exclusion_reason,
    };
  }
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
    seoRecommendation: data.seo_recommendation,
    aiRationale: data.ai_rationale,
  };
}

/**
 * Applies a matched suggestion to a readability opportunity, mirroring the field shape the
 * inline preflight guidance handler produces so the API/UI render is identical.
 */
function applySuggestionToOpportunity(opportunity, suggestion) {
  if (!suggestion) {
    return {
      ...opportunity,
      suggestionStatus: 'error',
      suggestionMessage: 'AI suggestion could not be generated for this item.',
      mystiqueProcessingCompleted: new Date().toISOString(),
    };
  }
  if (suggestion.shouldExclude) {
    return {
      ...opportunity,
      suggestionStatus: 'excluded',
      suggestionMessage: suggestion.exclusionReason
        ? `Excluded from AI readability improvement: ${suggestion.exclusionReason}`
        : 'Excluded from AI readability improvement.',
      exclusionReason: suggestion.exclusionReason,
      shouldExclude: true,
      mystiqueProcessingCompleted: new Date().toISOString(),
    };
  }
  const originalScore = suggestion.originalFleschScore ?? opportunity.fleschReadingEase;
  const improvement = Math.round((suggestion.improvedFleschScore - originalScore) * 100) / 100;
  return {
    ...opportunity,
    suggestionStatus: 'completed',
    suggestionMessage: 'AI-powered readability improvement generated successfully.',
    improvedFleschScore: Math.round(suggestion.improvedFleschScore * 100) / 100,
    readabilityImprovement: improvement,
    aiSuggestion: suggestion.improvedText,
    aiRationale: suggestion.aiRationale,
    mystiqueProcessingCompleted: new Date().toISOString(),
  };
}

/**
 * Reconstructs readability opportunities from suggestions when the job result carries no
 * opportunities (e.g. cleared during async processing). Ordered by the identify-time mapping
 * when available.
 */
function reconstructOpportunities(suggestions, originalOrderMapping) {
  const ordered = [...suggestions];
  if (Array.isArray(originalOrderMapping)) {
    ordered.sort((a, b) => {
      const ai = originalOrderMapping.find((m) => m.textContent === a.originalText)?.originalIndex
        ?? Number.MAX_SAFE_INTEGER;
      const bi = originalOrderMapping.find((m) => m.textContent === b.originalText)?.originalIndex
        ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }
  return ordered.map((suggestion) => applySuggestionToOpportunity({
    check: 'poor-readability',
    issue: `Text element is difficult to read: "${(suggestion.originalText || '').substring(0, 100)}..."`.replace(/\n/g, ' '),
    seoImpact: 'Moderate',
    fleschReadingEase: suggestion.originalFleschScore || 0,
    textContent: suggestion.originalText,
    seoRecommendation: 'Improve readability by using shorter sentences, simpler words, and clearer structure',
    ...(suggestion.selector ? { selector: suggestion.selector } : {}),
  }, suggestion));
}

async function fetchBatchResults(s3Client, bucketName, s3ResultsPath) {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: s3ResultsPath,
  }));
  const body = await response.Body.transformToString();
  return JSON.parse(body);
}

async function deleteResultsFile(s3Client, bucketName, s3ResultsPath, log) {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: s3ResultsPath }));
    log.info(`[readability-preflight-batch guidance]: Deleted S3 results file: ${s3ResultsPath}`);
  } catch (error) {
    log.warn(`[readability-preflight-batch guidance]: Failed to delete S3 results file ${s3ResultsPath}: ${error.message}`);
  }
}

export default async function handler(message, context) {
  const { log, dataAccess, s3Client } = context;
  const { AsyncJob: AsyncJobEntity } = dataAccess;
  const { auditId, siteId, data } = message;

  log.info(`[readability-preflight-batch guidance]: Received batched Mystique response for jobId: ${auditId}, siteId: ${siteId}`);

  const s3ResultsPath = data?.s3ResultsPath;
  if (!s3ResultsPath) {
    log.warn('[readability-preflight-batch guidance]: No s3ResultsPath in message data');
    return badRequest('Missing s3ResultsPath in message data');
  }

  const bucketName = context.env?.S3_MYSTIQUE_BUCKET_NAME;
  if (!bucketName) {
    log.error('[readability-preflight-batch guidance]: Missing S3_MYSTIQUE_BUCKET_NAME');
    return internalServerError('Missing S3_MYSTIQUE_BUCKET_NAME');
  }

  const asyncJob = await AsyncJobEntity.findById(auditId);
  if (!asyncJob) {
    log.error(`[readability-preflight-batch guidance]: AsyncJob not found for jobId: ${auditId}`);
    return notFound('AsyncJob not found');
  }

  // Idempotency: a redelivered response for an already-completed job is a no-op. Still clean
  // up the S3 file so it doesn't linger.
  if (asyncJob.getStatus() === AsyncJob.Status.COMPLETED) {
    log.info(`[readability-preflight-batch guidance]: Job ${auditId} already COMPLETED; skipping`);
    await deleteResultsFile(s3Client, bucketName, s3ResultsPath, log);
    return ok();
  }

  let batchResults;
  try {
    batchResults = await fetchBatchResults(s3Client, bucketName, s3ResultsPath);
  } catch (error) {
    // Leave the job as-is so SQS can redeliver and retry the fetch.
    log.error(`[readability-preflight-batch guidance]: Failed to fetch batch results from S3: ${error.message}`);
    return internalServerError('Failed to fetch batch results from S3');
  }

  if (!Array.isArray(batchResults)) {
    log.error(`[readability-preflight-batch guidance]: Expected batch results array, got ${typeof batchResults}`);
    return badRequest('Invalid batch results format');
  }

  const suggestions = batchResults.map(mapResultItemToSuggestion).filter(Boolean);
  const failedCount = batchResults.filter((item) => item.status !== 'success').length;
  log.info(`[readability-preflight-batch guidance]: ${suggestions.length} suggestions, ${failedCount} failed, of ${batchResults.length} items for job ${auditId}`);

  const jobMetadata = asyncJob.getMetadata() || {};
  const readabilityMetadata = jobMetadata.payload?.readabilityMetadata || {};
  const { originalOrderMapping } = readabilityMetadata;

  const findSuggestion = (textContent) => suggestions.find((s) => s.originalText === textContent);

  const currentResult = asyncJob.getResult() || [];
  const updatedResult = currentResult.map((pageResult) => {
    if (!pageResult.audits) {
      return pageResult;
    }
    const audits = pageResult.audits.map((auditItem) => {
      if (auditItem.name !== 'readability') {
        return auditItem;
      }
      const hasOpportunities = Array.isArray(auditItem.opportunities)
        && auditItem.opportunities.length > 0;
      const opportunities = hasOpportunities
        ? auditItem.opportunities.map(
          (opp) => applySuggestionToOpportunity(opp, findSuggestion(opp.textContent)),
        )
        : reconstructOpportunities(suggestions, originalOrderMapping);
      return { ...auditItem, opportunities };
    });
    return { ...pageResult, audits };
  });

  // Reload before writing to avoid a stale updatedAt conflict (mirrors the inline handler),
  // then complete the job in a single terminal update.
  const freshJob = await AsyncJobEntity.findById(auditId);
  if (freshJob.getStatus() === AsyncJob.Status.COMPLETED) {
    log.info(`[readability-preflight-batch guidance]: Job ${auditId} completed concurrently; skipping write`);
    await deleteResultsFile(s3Client, bucketName, s3ResultsPath, log);
    return ok();
  }
  freshJob.setResult(updatedResult);
  freshJob.setStatus(AsyncJob.Status.COMPLETED);
  freshJob.setEndedAt(new Date().toISOString());
  await freshJob.save();
  log.info(`[readability-preflight-batch guidance]: Completed AsyncJob ${auditId} with ${suggestions.length} readability suggestions`);

  await deleteResultsFile(s3Client, bucketName, s3ResultsPath, log);

  return ok();
}
