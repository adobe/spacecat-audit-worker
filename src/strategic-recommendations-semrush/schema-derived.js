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
 * Validator inputs derived from the row contract
 * `shared-semrush-row.schema.v1.json`.
 *
 * These are INLINED as constants rather than read from the JSON at runtime. The
 * vendored JSON is a `wsk.static` asset, and reading it via an
 * `import.meta.url`-relative path threw `ENOENT` under `validateBundle` (the
 * bundled module resolves next to `dist/`, not to the source tree where the
 * asset lands) — i.e. the Lambda failed at cold start, not just in CI. Inlining
 * removes the module-eval-time disk dependency entirely.
 *
 * The drift chain is preserved without a runtime read:
 *  - inlined constants == vendored JSON  -> asserted by `schema-checksum.test.js`
 *  - vendored JSON == DRS authoritative  -> asserted by `schema-checksum.test.js`
 * So a contract change must touch the JSON (changing its sha) AND these
 * constants in the same commit, or a test fails.
 */

// schema.required
export const REQUIRED_FIELDS = [
  'tag',
  'strategy',
  'strategy_reasoning',
  'topic_id',
  'topic',
  'volume',
  'adobe_mentions',
  'prompt',
];

// schema.properties.tag.enum
export const TAG_VALUES = ['Hidden Win', 'Coverage Gap', 'Strategic Blindspot'];

// schema.properties.deleted.enum — includes '' and null; the validator treats
// null/undefined as the active default and accepts the string markers, so the
// full enum is exposed.
export const DELETED_VALUES = ['', 'ignored', 'added', null];

// schema.properties[*].maxLength — only the fields that declare one. Kept in the
// drift-guard chain by schema-checksum.test.js (asserted == the vendored JSON).
export const MAX_LENGTHS = {
  strategy: 200,
  strategy_reasoning: 2000,
  topic: 300,
  competitor_1: 200,
  competitor_2: 200,
  competitor_3: 200,
  category: 120,
  prompt: 600,
  prompt_id: 128,
};

/* ------------------------------------------------------------------------- *
 * Auxiliary sheets: shared-citation-row + shared-persona-row.
 *
 * These two contracts are derived from the brand's published prompt-suggestions
 * workbook. Unlike Semrush: `tag` is free-form (no enum), and `strategy` /
 * `strategy_reasoning` are `required` (the key is always present) but MAY be the
 * empty string — the product rule is "if data is unavailable, leave it empty",
 * not drop the row. Only `prompt` carries `minLength: 1`. All three constant
 * groups are pinned to the vendored JSON by schema-checksum.test.js.
 * ------------------------------------------------------------------------- */

// schema.required — identical for both auxiliary schemas.
export const AUX_REQUIRED_FIELDS = ['tag', 'strategy', 'strategy_reasoning', 'prompt'];

// schema.properties.deleted.enum — identical for both auxiliary schemas.
export const AUX_DELETED_VALUES = ['', 'ignored', 'added', null];

// shared-citation-row.schema.v1.json — properties[*].maxLength.
export const CITATION_MAX_LENGTHS = {
  tag: 120,
  strategy: 200,
  strategy_reasoning: 2000,
  prompt: 600,
  topic: 300,
  category: 120,
  region: 120,
  intent: 120,
  type: 120,
  source_url: 2048,
  prompt_reasoning: 2000,
};

// shared-persona-row.schema.v1.json — properties[*].maxLength (no source_url).
export const PERSONA_MAX_LENGTHS = {
  tag: 120,
  strategy: 200,
  strategy_reasoning: 2000,
  prompt: 600,
  topic: 300,
  category: 120,
  region: 120,
  intent: 120,
  type: 120,
  prompt_reasoning: 2000,
};
