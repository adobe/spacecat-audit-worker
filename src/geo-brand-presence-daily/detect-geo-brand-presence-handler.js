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

import { isoCalendarWeek } from '@adobe/spacecat-shared-utils';
import baseHandler from '../geo-brand-presence/detect-geo-brand-presence-handler.js';

/**
 * Daily version of the geo brand presence handler
 * Extends the base handler with daily-specific path logic
 */
export default async function handler(message, context) {
  // Extract daily-specific information from the data object
  // Calculate week number from the date field since Mystique preserves date reliably
  let weekNumber = '01'; // fallback
  if (message.data?.date) {
    const date = new Date(message.data.date);
    const { week } = isoCalendarWeek(date);
    weekNumber = String(week).padStart(2, '0');
  }

  // Create a modified context with daily-specific path logic
  const dailyContext = {
    ...context,
    // Override the path construction for daily processing
    getOutputLocation: (site) => `${site.getConfig().getLlmoDataFolder()}/brand-presence/w${weekNumber}`,
  };

  // Call the base handler with modified context
  return baseHandler(message, dailyContext);
}
