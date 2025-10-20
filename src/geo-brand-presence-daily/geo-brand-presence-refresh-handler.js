/* c8 ignore start */
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

/* eslint-disable header/header */

import { refreshGeoBrandPresenceSheetsHandler } from '../geo-brand-presence/geo-brand-presence-refresh-handler.js';

/**
 * Daily version of the geo brand presence refresh handler
 * Sends refresh:geo-brand-presence-daily messages to Mystique
 */
export async function refreshGeoBrandPresenceSheetsHandlerDaily(message, context) {
  // Inject daily cadence into context
  const dailyContext = {
    ...context,
    brandPresenceCadence: 'daily',
  };

  // Call the base handler with the enhanced context
  return refreshGeoBrandPresenceSheetsHandler(message, dailyContext);
}
