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
 * Unified guidance handler for readability suggestions from Mystique.
 * Routes to appropriate handler based on the 'mode' parameter in the message data.
 *
 * This handler supports:
 * - mode: 'preflight' → Routes to preflight guidance handler (AsyncJob-based)
 * - mode: 'opportunity' → Routes to opportunity guidance handler (Audit/Opportunity-based)
 * - missing mode → Defaults to 'preflight' for backward compatibility
 *
 * @param {Object} message - The Mystique callback message
 * @param {Object} context - The audit context
 * @returns {Promise} HTTP response
 */
export default async function unifiedReadabilityGuidanceHandler(message, context) {
  const { log } = context;
  const { data } = message;

  // Extract mode from message data, default to 'preflight' for backward compatibility
  const mode = data?.mode || 'preflight';

  log.info(`[unified-readability-guidance] Processing Mystique response with mode: ${mode}`);

  try {
    if (mode === 'preflight') {
      log.info('[unified-readability-guidance] Routing to preflight guidance handler');
      return await preflightGuidanceHandler(message, context);
    } else if (mode === 'opportunity') {
      log.info('[unified-readability-guidance] Routing to opportunity guidance handler');
      return await opportunityGuidanceHandler(message, context);
    } else {
      // Unknown mode, default to preflight for safety and backward compatibility
      log.warn(`[unified-readability-guidance] Unknown mode: '${mode}', defaulting to preflight for safety`);
      return await preflightGuidanceHandler(message, context);
    }
  } catch (error) {
    log.error(`[unified-readability-guidance] Error processing Mystique response with mode '${mode}': ${error.message}`, error);
    throw error;
  }
}
