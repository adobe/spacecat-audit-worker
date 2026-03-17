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

export const DEPLOY_STATUS = Object.freeze({
  PRE_ANALYSIS_SUBMITTED: 'pre_analysis_submitted',
  PRE_ANALYSIS_DONE: 'pre_analysis_done',
  DEPLOYED: 'deployed',
  POST_ANALYSIS_SUBMITTED: 'post_analysis_submitted',
  POST_ANALYSIS_DONE: 'post_analysis_done',
  FAILED: 'failed',
  DEPLOYED_POST_ANALYSIS_FAILED: 'deployed_post_analysis_failed',
});

export const DRS_EXPERIMENT_STATUS = Object.freeze({
  COMPLETED: 'COMPLETED',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
});

export const MAX_POLLING_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
