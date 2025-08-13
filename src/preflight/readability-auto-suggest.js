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

import rs from 'text-readability';
import { franc } from 'franc-min';

const TARGET_READABILITY_SCORE = 30;
const MIN_TEXT_LENGTH = 100;
const MYSTIQUE_BATCH_SIZE = 10;
const READABILITY_GUIDANCE_TYPE = 'guidance:readability';
const READABILITY_OBSERVATION = 'Content readability needs improvement';

function isEnglishContent(text) {
  const detectedLanguage = franc(text);
  return detectedLanguage === 'eng';
}

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function sendReadabilityOpportunityToMystique(
  auditUrl,
  readabilityIssues,
  siteId,
  auditId,
  context,
) {
  const { sqs, env, log } = context;
  if (!sqs || !env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.error('[readability-auto-suggest]: Missing required dependencies for Mystique integration');
    throw new Error('Missing required dependencies for Mystique integration');
  }

  try {
    const issueBatches = chunkArray(readabilityIssues, MYSTIQUE_BATCH_SIZE);
    log.info(
      `[readability-auto-suggest]: Sending ${readabilityIssues.length} readability issues to Mystique in ${issueBatches.length} batch(es)`,
    );

    // Process all batches in parallel to avoid await in loop
    await Promise.all(
      issueBatches.map(async (batch, batchIndex) => {
        const messagePromises = batch.map(async (issue) => {
          const originalText = issue.textContent;
          const currentScore = rs.fleschReadingEase(originalText);
          const mystiqueMessage = {
            type: READABILITY_GUIDANCE_TYPE,
            siteId,
            auditId,
            deliveryType: context.site.getDeliveryType(),
            time: new Date().toISOString(),
            url: auditUrl,
            observation: READABILITY_OBSERVATION,
            data: {
              original_paragraph: originalText,
              target_flesch_score: TARGET_READABILITY_SCORE,
              current_flesch_score: currentScore,
              issue_id: issue.id || `readability-${Date.now()}-${Math.random()}`,
            },
          };
          await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
          log.debug(
            `[readability-auto-suggest]: Sent readability issue to Mystique: ${JSON.stringify(mystiqueMessage)}`,
          );
        });
        await Promise.all(messagePromises);
        log.info(
          `[readability-auto-suggest]: Batch ${batchIndex + 1}/${issueBatches.length} sent to Mystique with ${batch.length} issues`,
        );
      }),
    );
    log.info(`[readability-auto-suggest]: All ${issueBatches.length} batches sent to Mystique successfully`);
  } catch (error) {
    log.error('[readability-auto-suggest]: Error sending readability opportunities to Mystique:', error);
    throw error;
  }
}

export default async function readabilityAutoSuggest(
  context,
  site,
  readabilityIssues,
  options = { forceAutoSuggest: false },
) {
  const { dataAccess, log } = context;
  const { forceAutoSuggest = false } = options;

  const configuration = await dataAccess.Configuration.findLatest();
  if (!forceAutoSuggest && !configuration.isHandlerEnabledForSite('readability-auto-suggest', site)) {
    log.debug('Readability auto-suggest is not enabled for this site');
    return readabilityIssues;
  }

  log.debug('Generating suggestions for Readability using Mystique.');

  if (!readabilityIssues || readabilityIssues.length === 0) {
    log.info('No readability issues to process');
    return readabilityIssues;
  }

  // Filter issues that need improvement
  const issuesToImprove = readabilityIssues.filter((issue) => {
    if (issue.check !== 'poor-readability') {
      return false;
    }

    const originalText = issue.textContent;
    if (!originalText || originalText.length < MIN_TEXT_LENGTH) {
      return false;
    }

    // Check if content is in English
    if (!isEnglishContent(originalText)) {
      log.debug(`Skipping non-English content for readability improvement: ${originalText.substring(0, 50)}...`);
      return false;
    }

    // Calculate current readability score
    const currentScore = rs.fleschReadingEase(originalText);

    // If already above target, no need for improvement
    if (currentScore >= TARGET_READABILITY_SCORE) {
      log.debug(`Content already meets readability target (${currentScore} >= ${TARGET_READABILITY_SCORE})`);
      return false;
    }

    return true;
  });

  if (issuesToImprove.length === 0) {
    log.info('No readability issues need improvement');
    return readabilityIssues;
  }

  try {
    await sendReadabilityOpportunityToMystique(
      context.auditUrl || site.getBaseURL(),
      issuesToImprove,
      site.getId(),
      context.audit.getId(),
      context,
    );

    log.info(`Sent ${issuesToImprove.length} readability opportunities to Mystique for improvement`);

    // Return the original issues - Mystique will process them asynchronously
    // The improved suggestions will be received via the Mystique response handler
    return readabilityIssues;
  } catch (error) {
    log.error('Error sending readability opportunities to Mystique:', error);
    return readabilityIssues;
  }
}
