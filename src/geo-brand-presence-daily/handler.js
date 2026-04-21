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

import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { loadPromptsAndSendDetection } from '../geo-brand-presence/handler.js';

// Daily geo-brand-presence audit flow:
// STEP 0: Load AI + human prompts, upload to S3, send unified detection message to Mystique
// STEP 1: Receive categorization status (handled by message handler in index.js)

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'loadPromptsAndSendDetectionStep',
    (context) => loadPromptsAndSendDetection({ ...context, brandPresenceCadence: 'daily' }),
  )
  .build();
