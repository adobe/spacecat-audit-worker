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
 * Loads enum/required values directly from the vendored schema JSON so the
 * validator can never drift from the contract within this repo. (The vendored
 * copy itself is kept in sync with the authoritative DRS copy by the
 * checksum-drift test.)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const schemaPath = fileURLToPath(new URL('./shared-semrush-row.schema.v1.json', import.meta.url));

export const SCHEMA = JSON.parse(readFileSync(schemaPath, 'utf8'));
export const REQUIRED_FIELDS = SCHEMA.required;
export const TAG_VALUES = SCHEMA.properties.tag.enum;
// The `deleted` enum includes null; the validator treats null/undefined as the
// active default and accepts the string markers, so expose the full enum.
export const DELETED_VALUES = SCHEMA.properties.deleted.enum;
