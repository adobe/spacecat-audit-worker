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

/**
 * Categorization Callback Handler
 * ================================
 *
 * This handler processes callbacks from Mystique after categorization completes.
 * It receives the categorized AI prompts and triggers Step 2 (detection) by:
 * 1. Downloading categorized AI prompts from presigned URL
 * 2. Writing them to aggregates/ parquet for analytics
 * 3. Loading human prompts from LLMO config
 * 4. Combining AI + human prompts
 * 5. Sending detection messages to Mystique
 *
 * This is triggered by messages with type 'categorize:geo-brand-presence' sent
 * from Mystique back to SpaceCat after categorization completes (success or failure).
 */

import { notFound, ok, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { loadCategorizedPromptsAndSendDetection } from './handler.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Site } = dataAccess;
  const {
    auditId, siteId, data,
  } = message;

  log.info('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Received callback for auditId: %s, siteId: %s', auditId, siteId);

  // Check for error in categorization
  if (data?.error) {
    log.error('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Categorization failed for auditId: %s, siteId: %s, error: %s', auditId, siteId, data.error_message || 'Unknown error');
    // Return OK to acknowledge the message, but don't proceed to detection
    // The error has already been logged by Mystique
    return ok({ message: 'Categorization error acknowledged, detection skipped' });
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Site not found for auditId: %s, siteId: %s', auditId, siteId);
    return notFound();
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.error('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Audit not found for auditId: %s, siteId: %s', auditId, siteId);
    return notFound();
  }

  // Determine cadence from message or audit data
  const isDaily = message.data?.date || message.date;
  const brandPresenceCadence = isDaily ? 'daily' : 'weekly';

  log.info('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Processing callback for auditId: %s, siteId: %s, cadence: %s', auditId, siteId, brandPresenceCadence);

  try {
    // Call Step 2 - Load categorized prompts and send detection
    const result = await loadCategorizedPromptsAndSendDetection({
      ...context,
      site,
      audit,
      brandPresenceCadence,
      data,
      auditContext: {
        // Pass through week/year from message for detection messages
        calendarWeek: { year: message.year, week: message.week },
        ...(isDaily && { referenceDate: message.data?.date || message.date }),
      },
    });

    if (result.status === 'error') {
      log.error('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Failed to process callback for auditId: %s, siteId: %s, error: %s', auditId, siteId, result.message);
      return internalServerError(result.message);
    }

    log.info('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Successfully processed callback for auditId: %s, siteId: %s', auditId, siteId);
    return ok({ message: result.message });
  } catch (error) {
    log.error('GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Unexpected error processing callback for auditId: %s, siteId: %s', auditId, siteId, error);
    return internalServerError(`Failed to process categorization callback: ${error.message}`);
  }
}
