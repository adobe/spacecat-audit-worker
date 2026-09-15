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

// Shared caps for the gsc-search-analytics audit. `derive.js` uses these to BOUND its
// self-sourced output; `lib.js` uses the same values as the runtime ABORT cap. Keeping
// them in one place stops the derive bound and the runtime cap from drifting apart.
export const MAX_FIXED_URLS = 500;
export const MAX_DATE_GROUPS = 30;
