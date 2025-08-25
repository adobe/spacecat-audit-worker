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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { handleAccessibilityRemediationGuidance } from '../utils/generate-individual-opportunities.js';

export default async function handler(message, context) {
  const { log } = context;
  log.info(`Message received in accessibility remediation guidance handler: ${JSON.stringify(message, null, 2)}`);

  try {
    const result = await handleAccessibilityRemediationGuidance(message, context);

    if (!result.success) {
      log.error(`[A11yIndividual][A11yProcessingError] Failed to process guidance: ${result.error}`);
      return ok(); // Still return ok to avoid retries
    }

    log.info('Successfully processed accessibility remediation guidance');
    return ok();
  } catch (error) {
    log.error(`[A11yIndividual][A11yProcessingError] Error processing accessibility remediation guidance: ${error.message}`);
    return ok(); // Return ok to avoid retries
  }
}
