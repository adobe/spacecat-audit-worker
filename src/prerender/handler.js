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

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { detectBotBlocker } from '@adobe/spacecat-shared-utils';
import { subDays } from 'date-fns';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { getTopAgenticLiveUrlsFromAthena, getPreferredBaseUrl } from '../utils/agentic-urls.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './utils/html-comparator.js';
import { isPaidLLMOCustomer, mergeAndGetUniqueHtmlUrls, toPathname } from './utils/utils.js';
import {
  CONTENT_GAIN_THRESHOLD,
  DAILY_BATCH_SIZE,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
  MODE_AI_ONLY,
  MYSTIQUE_BATCH_SIZE,
  DOMAIN_WIDE_URL_SHORTLIST_LIMIT,
  DOMAIN_WIDE_MAX_PROMPTS,
} from './utils/constants.js';