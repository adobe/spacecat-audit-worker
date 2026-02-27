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

import { publishToAdminHlx } from '../utils/report-uploader.js';

const LLMO_ONBOARDING_PUBLISH_FILENAME = 'query-index';

/**
 * LLMO Onboarding Publish Handler
 *
 * Publishes query-index to admin.hlx.page.
 * Requires `siteId` and `auditContext.dataFolder` from the message.
 */
export default async function handler(message, context) {
  const { log } = context;
  const { siteId, auditContext = {} } = message;
  const { dataFolder } = auditContext;

  if (!siteId) {
    log.error('[LLMO Onboarding Publish] Missing required field: siteId');
    return;
  }

  if (!dataFolder) {
    log.error('[LLMO Onboarding Publish] Missing required field: auditContext.dataFolder', {
      siteId,
    });
    return;
  }

  // publishToAdminHlx already swallows/logs Helix errors by design.
  await publishToAdminHlx(LLMO_ONBOARDING_PUBLISH_FILENAME, dataFolder, log);
  log.info(`[LLMO Onboarding Publish] Publish attempt finished for site ${siteId} and folder ${dataFolder}`);
}
