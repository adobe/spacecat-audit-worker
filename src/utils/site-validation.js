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

import { SITES_REQUIRING_VALIDATION } from '../common/constants.js';

/**
 * Checks if a site requires suggestion validation before showing in UI
 * @param {Object} site - The site object
 * @returns {boolean} - True if site requires validation, false otherwise
 */
export function checkSiteRequiresValidation(site) {
  if (!site) {
    return false;
  }
  // Check if the site has the requiresValidation flag set directly
  if (typeof site.requiresValidation === 'boolean') {
    return site.requiresValidation;
  }
  // For backward compatibility, check if this is a paid customer that requires validation
  return SITES_REQUIRING_VALIDATION.includes(site.getId());
}
