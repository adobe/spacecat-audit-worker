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
 * Canonical "good" CWV thresholds used by the audit worker.
 *
 * These are duplicated in other repos today, but within this package they should
 * flow through this shared module rather than being redefined per file.
 */
export const CWV_GOOD_THRESHOLDS = {
  lcp: 2500,
  cls: 0.1,
  inp: 200,
};
