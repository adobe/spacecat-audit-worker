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

/**
 * True when a TOC suggestion is still open (not FIXED/OUTDATED/SKIPPED), not already
 * deployed at the CDN edge, and therefore still eligible to send/receive Impact Engine
 * prompts. Shared by the outbound (sendTocGuidanceRequestToMystique) and inbound
 * (guidance-handler) eligibility checks so the two stay in sync.
 * @param {Object} suggestion - Suggestion entity
 * @param {Object} Suggestion - The Suggestion data-access collection (for STATUSES)
 * @returns {boolean} True if the suggestion is non-terminal and not edge-deployed
 */
export function isEligibleTocSuggestion(suggestion, Suggestion) {
  const status = suggestion.getStatus();
  return status !== Suggestion.STATUSES.FIXED
    && status !== Suggestion.STATUSES.OUTDATED
    && status !== Suggestion.STATUSES.SKIPPED
    && !suggestion.getData()?.edgeDeployed;
}
