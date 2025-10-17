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

import {
  ok, badRequest, notFound, internalServerError,
} from '@adobe/spacecat-shared-http-utils';
import {
  processCodeFixUpdates,
  CodeFixValidationError,
  CodeFixNotFoundError,
  CodeFixConfigurationError,
} from './codefix-handler.js';

/**
 * Common handler for processing code fix responses from Mystique/Importer
 *
 * This handler receives code fix results and updates suggestions with the generated fixes.
 * It's used by all code fix workflows (accessibility, forms, etc.)
 *
 * Expected message format:
 * {
 *   "siteId": "<site-id>",
 *   "type": "codefix:*",  // e.g., "codefix:accessibility", "codefix:forms"
 *   "data": {
 *     "opportunityId": "<uuid>",
 *     "updates": [
 *       {
 *         "url": "<page url>",
 *         "source": "<source>", // optional
 *         "type": ["rule-id-1", "rule-id-2"]  // Array of fix types/rule IDs
 *       }
 *     ]
 *   }
 * }
 *
 * @param {Object} message - The SQS message
 * @param {Object} context - The context object containing dataAccess, log, s3Client, etc.
 * @returns {Promise<Response>} - HTTP response
 */
export default async function codeFixResponseHandler(message, context) {
  const { log } = context;
  const { siteId, type, data } = message;

  if (!data) {
    log.error(`[CodeFixResponseHandler] No data provided in message for type: ${type}`);
    return badRequest('No data provided in message');
  }

  const { opportunityId, updates } = data;

  log.info(`[CodeFixResponseHandler] Processing code fix response for type: ${type}, siteId: ${siteId}, opportunityId: ${opportunityId}`);

  try {
    const totalUpdated = await processCodeFixUpdates(siteId, opportunityId, updates, context);
    log.info(`[CodeFixResponseHandler] Successfully updated ${totalUpdated} suggestions for ${type}`);
    return ok();
  } catch (error) {
    if (error instanceof CodeFixValidationError) {
      log.error(`[CodeFixResponseHandler] Validation error for ${type}: ${error.message}`);
      return badRequest(error.message);
    }
    if (error instanceof CodeFixNotFoundError) {
      log.error(`[CodeFixResponseHandler] Not found for ${type}: ${error.message}`);
      return notFound(error.message);
    }
    if (error instanceof CodeFixConfigurationError) {
      log.error(`[CodeFixResponseHandler] Configuration error for ${type}: ${error.message}`);
      return internalServerError(error.message);
    }
    log.error(`[CodeFixResponseHandler] Unexpected error for ${type}: ${error.message}`, error);
    return internalServerError(error.message);
  }
}
