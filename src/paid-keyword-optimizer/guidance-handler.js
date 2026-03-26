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
import { createPaidLogger } from '../paid/paid-log.js';

const GUIDANCE_TYPE = 'ad-intent-mismatch';

/**
 * Handler for ad intent mismatch guidance responses from mystique.
 * TEMPORARY: Short-circuited to prevent opportunity/suggestion creation during E2E testing.
 * Will be restored by feat/ad-intent-mismatch-v3 PR.
 * @param {Object} message - Message from mystique
 * @param {Object} context - Execution context
 * @returns {Promise<Response>} HTTP response
 */
export default async function handler(message, context) {
  const { log } = context;
  const { siteId, data } = message;
  const guidanceBody = data?.guidance?.[0]?.body;
  const url = guidanceBody?.url || data?.url;
  const paidLog = createPaidLogger(log, GUIDANCE_TYPE);

  paidLog.received(siteId, url, message.auditId);
  log.info(`[ad-intent-mismatch] [guidance] Short-circuited for site ${siteId}, url ${url} — opportunity creation disabled`);
  return ok();
}
