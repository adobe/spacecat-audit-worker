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

/* c8 ignore start */
export function getHourlyPartitionFilter(hourToProcess) {
  const year = hourToProcess.getUTCFullYear();
  const month = String(hourToProcess.getUTCMonth() + 1).padStart(2, '0');
  const day = String(hourToProcess.getUTCDate()).padStart(2, '0');
  const hour = String(hourToProcess.getUTCHours()).padStart(2, '0');

  return {
    year,
    month,
    day,
    hour,
    whereClause: `WHERE year = '${year}' AND month = '${month}' AND day = '${day}' AND hour = '${hour}'`,
    hourLabel: `${year}-${month}-${day}T${hour}:00:00Z`,
  };
}

export const AGENTIC_PATTERNS = {
  TYPE_CLASSIFICATION: 'agentic_type',
  DETECTION_CLAUSE: `(request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' OR
                     request_user_agent LIKE '%Anthropic%')`,
  COUNT_AGENTIC: 'COUNT(*)',
};
/* c8 ignore stop */
