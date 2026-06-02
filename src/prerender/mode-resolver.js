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

import { MODE_AI_ONLY } from './utils/constants.js';

/**
 * Parses the audit mode from the SQS message data field.
 * Returns null if data is absent, unparseable, or has no mode field.
 *
 * @param {string|Object|null} data
 * @returns {string|null}
 */
function getModeFromData(data) {
  if (!data) {
    return null;
  }
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return parsed.mode || null;
  } catch {
    return null;
  }
}

/**
 * Resolves which execution mode applies for the current audit step.
 * Exactly one flag is true. Priority: ai-only > csv > slack > normal.
 *
 * @param {Object} context - Handler context (data + auditContext)
 * @returns {{ isAiOnly: boolean, isCsv: boolean, isSlack: boolean, isNormal: boolean }}
 */
export function resolveMode(context) {
  const { data, auditContext } = context;

  const isAiOnly = getModeFromData(data) === MODE_AI_ONLY;
  const isCsv = !isAiOnly
    && Array.isArray(auditContext?.urls)
    && auditContext.urls.length > 0;
  const isSlack = !isAiOnly && !isCsv && !!(auditContext?.slackContext?.channelId);
  const isNormal = !isAiOnly && !isCsv && !isSlack;

  return {
    isAiOnly, isCsv, isSlack, isNormal,
  };
}
