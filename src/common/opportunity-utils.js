/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import GoogleClient from '@adobe/spacecat-shared-google-client';

/**
 * Checks if a site is connected to Google Search Console
 *
 * @param {string} auditUrl - The URL to check
 * @param {Object} context - The context object containing logger
 * @returns {Promise<boolean>} - True if connected to GSC, false otherwise
 */
export async function checkGoogleConnection(auditUrl, context) {
  const { log } = context;
  try {
    return !!await GoogleClient.createFrom(context, auditUrl);
  } catch (error) {
    log.error(`Failed to create Google client. Site was probably not onboarded to GSC yet. Error: ${error.message}`);
    return false;
  }
}
