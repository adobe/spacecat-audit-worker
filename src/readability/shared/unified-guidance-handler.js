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

import preflightGuidanceHandler from '../preflight/guidance-handler.js';
import opportunityGuidanceHandler from '../opportunities/guidance-handler.js';

/**
 * Determines whether this is a batch (opportunity) message by inspecting the payload.
 * A batch response always carries `data.s3ResultsPath`.
 */
function isBatchMessage(message) {
  return Boolean(message.data?.s3ResultsPath);
}

/**
 * Unified guidance handler for readability responses from Mystique.
 *
 * Routes incoming messages to the correct handler by inspecting the payload:
 * - If `data.s3ResultsPath` is present → S3-based batch opportunity handler
 * - Otherwise → inline single-item preflight handler
 *
 * The `mode` field is logged for observability but is NOT used for routing,
 * because Mystique may not echo it back in batch responses.
 *
 * @param {Object} message - The Mystique callback message
 * @param {Object} context - The audit context
 * @returns {Promise} HTTP response
 */
export default async function unifiedReadabilityGuidanceHandler(message, context) {
  const { log } = context;
  const mode = message.mode || 'unknown';

  log.info(`[unified-readability-guidance] Processing Mystique response (mode: ${mode})`);

  try {
    if (isBatchMessage(message)) {
      log.info('[unified-readability-guidance] Detected s3ResultsPath — routing to opportunity guidance handler');
      return await opportunityGuidanceHandler(message, context);
    }

    log.info('[unified-readability-guidance] Routing to preflight guidance handler');
    return await preflightGuidanceHandler(message, context);
  } catch (error) {
    log.error(`[unified-readability-guidance] Error processing Mystique response (mode: ${mode}): ${error.message}`, error);
    throw error;
  }
}
