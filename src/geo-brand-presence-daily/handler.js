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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { keywordPromptsImportStep, sendToMystique } from '../geo-brand-presence/handler.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'keywordPromptsImportStep',
    (context) => keywordPromptsImportStep({ ...context, brandPresenceCadence: 'daily' }),
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'sendToMystiqueStep',
    (context) => sendToMystique({ ...context, brandPresenceCadence: 'daily' }),
  )
  .build();
